// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import App from '../../App';
import {Editor as NoteEditor} from '../../editor/Editor';
import type {Editor as TiptapEditor} from '@tiptap/core';
import * as db from '../../lib/db';
import { noteCache } from '../../lib/noteCache';
import { titleStore } from '../../lib/titleStore';
import { readActiveNoteSnapshot } from '../../lib/storage';
import { copyToClipboard } from '../../lib/clipboard';
import { downloadFile } from '../../lib/utils';

const state = vi.hoisted(() => ({ palette: null as any, editor: null as any, search: null as any, live: null as TiptapEditor | null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ isFocused: () => Promise.resolve(true), onFocusChanged: () => Promise.resolve(() => {}), setFocus: () => Promise.resolve(), listen: () => Promise.resolve(() => {}) }) }));
vi.mock('../../lib/theme', () => ({ initTheme: vi.fn() }));
vi.mock('../../lib/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/utils', async (original) => ({ ...await original<typeof import('../../lib/utils')>(), downloadFile: vi.fn() }));
vi.mock('../TitleBar', () => ({ TitleBar: (p: any) => <button onClick={p.onOpenCommandPalette}>palette</button> }));
vi.mock('../NoteEditor', () => ({ NoteEditor: (p: any) => { state.editor = p; return <NoteEditor {...p} onEditorReady={e=>{state.live=e}}/>; } }));
vi.mock('../BottomToolbar',()=>({BottomToolbar:()=>null}));
vi.mock('../DocumentTickSlider',()=>({DocumentTickSlider:()=>null}));
vi.mock('../SmoothCaret',()=>({SmoothCaret:()=>null}));
vi.mock('../../editor/FloatingCodeBlockToolbar',()=>({FloatingCodeBlockToolbar:()=>null}));
vi.mock('../WindowResizeHandles', () => ({ WindowResizeHandles: () => null }));
vi.mock('../CommandPalette', () => ({ CommandPalette: (p: any) => { state.palette = p; return <div />; } }));
vi.mock('../SmartSearch', () => ({ SmartSearch: (p: any) => { state.search = p; return null; }, clearCachedRecentSearchResults: vi.fn() }));
vi.mock('../ShortcutsModal', () => ({ ShortcutsModal: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const version = '2026-01-02T00:00:00Z';
const summary = (id: string) => ({ id, title: id, preview: id, created_at: version, updated_at: version, is_pinned: false });
const doc = (title: string, body = '') => JSON.stringify({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }, { type: 'paragraph', content: body ? [{ type: 'text', text: body }] : [] }] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

describe('Remaining App data-integrity and command regressions', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => {
    localStorage.clear(); noteCache.clear(); titleStore.reset(); state.palette = null; state.editor = null; state.search = null;
    vi.mocked(copyToClipboard).mockClear(); vi.mocked(downloadFile).mockClear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.spyOn(db, 'getRecentNotes').mockResolvedValue([summary('a'), summary('b')]);
    vi.spyOn(db, 'getNote').mockImplementation(async id => ({ ...summary(id), content: doc(id, 'old body') }));
    vi.spyOn(db, 'flushEditorNow').mockResolvedValue(); vi.spyOn(db, 'flushSaveQueue').mockResolvedValue();
    vi.spyOn(db, 'setAlwaysOnTop').mockResolvedValue();
    vi.spyOn(db, 'registerExitFlushHandler').mockReturnValue(undefined); vi.spyOn(db, 'registerPanelHideHandler').mockReturnValue(undefined);
    vi.spyOn(db, 'createNote').mockResolvedValue({ ...summary('copy'), content: doc('') });
    vi.spyOn(db, 'updateNote').mockResolvedValue(version);
    vi.spyOn(db, 'deleteNote').mockResolvedValue();
    window.confirm = vi.fn().mockReturnValue(true);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); noteCache.clear(); localStorage.clear(); });
  const mount = async () => { await act(async () => root.render(<App />)); };


  it('hands off a real live editor without replacing typing during catch-up recovery',async()=>{
    await mount();const original=state.live;
    const updates=[deferred<string>(),deferred<string>()];let n=0;
    vi.mocked(db.updateNote).mockImplementation(async()=>n<2?updates[n++].promise:version);
    let operation!:Promise<string>;
    await act(async()=>{operation=state.editor.onRecoverOrphan(JSON.stringify(state.live!.getJSON()),'a')});
    act(()=>state.live!.commands.insertContentAt(state.live!.state.doc.content.size-1,' first new'));
    await act(async()=>updates[0].resolve(version));
    act(()=>state.live!.commands.insertContentAt(state.live!.state.doc.content.size-1,' LAST TYPING'));
    await act(async()=>{updates[1].resolve(version);await operation});
    expect(state.live).toBe(original);expect(state.live!.getText()).toContain('LAST TYPING');
    expect(readActiveNoteSnapshot()?.content).toContain('LAST TYPING');expect(state.editor.noteId).toBe('copy');
    expect(vi.mocked(db.updateNote).mock.calls.some(c=>c[0]==='copy'&&c[2].includes('LAST TYPING'))).toBe(true);
  });
  it('saves target edits whose debounce fires while the original recovery save is still pending',async()=>{
    vi.useFakeTimers();await mount();const recents=deferred<db.NoteSummary[]>();
    vi.mocked(db.getRecentNotes).mockReturnValue(recents.promise);
    vi.mocked(db.updateNote).mockImplementation(async id=>{if(id==='a')throw new Error('NOTE_NOT_FOUND');return version});
    act(()=>state.live!.commands.insertContentAt(state.live!.state.doc.content.size-1,' before recovery'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(400)});
    expect(state.editor.noteId).toBe('copy');
    act(()=>state.live!.commands.insertContentAt(state.live!.state.doc.content.size-1,' after handoff'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(400)});
    await act(async()=>{recents.resolve([summary('copy')]);await Promise.resolve()});
    expect(vi.mocked(db.updateNote).mock.calls.some(c=>c[0]==='copy'&&c[2].includes('after handoff'))).toBe(true);
    expect(readActiveNoteSnapshot()).toMatchObject({id:'copy',unsaved:false});
    expect(readActiveNoteSnapshot()?.content).toContain('after handoff');
  });

  it('rolls back a superseded pending switch to its actual source history',async()=>{
    await mount();await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('b',summary('b')));
    // Finish B first, then supersede two pending targets while the real editor retains B.
    vi.mocked(db.getNote).mockImplementation(async id=>id==='c'||id==='d'?new Promise(()=>{}):({...summary(id),content:doc(id)}));
    await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('c',summary('c')));
    await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('d',summary('d')));
    await act(async()=>state.editor.onSwitchFailed('b',new Error('Note could not be loaded')));
    await act(async()=>host.querySelector('button')!.click());
    await act(async()=>state.palette.onGoBack());expect(state.editor.noteId).toBe('a');
  });

});
