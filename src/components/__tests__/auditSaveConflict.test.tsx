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
import { copyToClipboard } from '../../lib/clipboard';
import { downloadFile } from '../../lib/utils';

const state = vi.hoisted(() => ({ palette: null as any, editor: null as any, search: null as any, live: null as TiptapEditor | null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ isFocused: () => Promise.resolve(true), onFocusChanged: () => Promise.resolve(() => {}), setFocus: () => Promise.resolve(), listen: () => Promise.resolve(() => {}) }) }));
vi.mock('../../lib/theme', () => ({ initTheme: vi.fn() }));
vi.mock('../../lib/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/utils', async (original) => ({ ...await original<typeof import('../../lib/utils')>(), downloadFile: vi.fn() }));
vi.mock('../TitleBar', () => ({ TitleBar: (p: any) => <button onClick={p.onOpenSaveConflict}>Not saved</button> }));
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

describe('Audit save-conflict recovery regressions', () => {
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



  it('copies the entire emergency recovery document rather than its preview (B01)', async () => {
    vi.useFakeTimers();
    const body = 'precious paragraph '.repeat(20) + 'END OF UNSAVED CONTENT';
    vi.mocked(db.getNote).mockImplementation(async id => ({ ...summary(id), content: doc(id, body) }));
    await mount();
    await act(async () => host.querySelector('button')!.click());
    const copyButton = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Copy text'))!;
    await act(async () => copyButton.click());
    const copied = vi.mocked(copyToClipboard).mock.calls[0][0];
    expect(copied).toContain(body);
    expect(copied).not.toContain('…');
  });

  it('persists new edits after discarding a failed save from its badge (B02)', async () => {
    vi.useFakeTimers();
    await mount();
    act(() => state.live!.commands.insertContentAt(state.live!.state.doc.content.size - 1, ' DISCARD THIS'));
    await act(async () => host.querySelector('button')!.click());
    const discardButton = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Discard'))!;
    await act(async () => discardButton.click());
    vi.mocked(db.updateNote).mockClear();
    act(() => state.live!.commands.insertContentAt(state.live!.state.doc.content.size - 1, ' NEW EDIT AFTER DISCARD'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vi.mocked(db.updateNote).mock.calls.some(c => c[2].includes('NEW EDIT AFTER DISCARD'))).toBe(true);
  });
  it('ignores repeated Discard clicks so a late response cannot erase new edits', async () => {
    vi.useFakeTimers(); await mount();
    let resolveFirst!: (value: any) => void;
    let resolveSecond: ((value: any) => void) | undefined;
    vi.mocked(db.getNote).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    await act(async () => host.querySelector('button')!.click());
    const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Discard'))!;
    await act(async () => { button.click(); button.click(); });
    await act(async () => resolveFirst({ ...summary('a'), content: doc('a', 'old body') }));
    act(() => state.live!.commands.insertContentAt(state.live!.state.doc.content.size - 1, ' NEW PRECIOUS TEXT'));
    await act(async () => resolveSecond?.({ ...summary('a'), content: doc('a', 'old body') }));
    expect(state.live!.getText()).toContain('NEW PRECIOUS TEXT');
    vi.mocked(db.updateNote).mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vi.mocked(db.updateNote).mock.calls.some(call => call[2].includes('NEW PRECIOUS TEXT'))).toBe(true);
  });

});
