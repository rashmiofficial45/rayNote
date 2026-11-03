// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import App from '../../App';
import * as db from '../../lib/db';
import { noteCache } from '../../lib/noteCache';
import { titleStore } from '../../lib/titleStore';
import { readActiveNoteSnapshot, writeActiveNoteSnapshot } from '../../lib/storage';
import { copyToClipboard } from '../../lib/clipboard';
import { downloadFile } from '../../lib/utils';

const state = vi.hoisted(() => ({ palette: null as any, editor: null as any, search: null as any }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ isFocused: () => Promise.resolve(true), onFocusChanged: () => Promise.resolve(() => {}), setFocus: () => Promise.resolve() }) }));
vi.mock('../../lib/theme', () => ({ initTheme: vi.fn() }));
vi.mock('../../lib/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/utils', async (original) => ({ ...await original<typeof import('../../lib/utils')>(), downloadFile: vi.fn() }));
vi.mock('../TitleBar', () => ({ TitleBar: (p: any) => <button onClick={p.onOpenCommandPalette}>palette</button> }));
vi.mock('../NoteEditor', () => ({ NoteEditor: (p: any) => { state.editor = p; return <div data-note={p.noteId} />; } }));
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
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); noteCache.clear(); localStorage.clear(); });
  const mount = async () => { await act(async () => root.render(<App />)); };
  const palette = async () => { await act(async () => host.querySelector('button')!.click()); };

  it('finishes an interrupted recovery write before releasing its source snapshot (B04)', async () => {
    const precious = doc('Recovered title', 'precious unsaved body');
    writeActiveNoteSnapshot({ id: 'missing', content: precious, baseUpdatedAt: version, unsaved: true });
    localStorage.setItem('notefast_recovered_note_id', JSON.stringify({ sourceId: 'missing', recoveredId: 'replacement' }));
    vi.mocked(db.getRecentNotes).mockResolvedValue([]);
    vi.mocked(db.getNote).mockImplementation(async id => id === 'replacement' ? { ...summary('replacement'), content: doc('') } : null);
    await mount();
    expect(db.updateNote).toHaveBeenCalledWith('replacement', expect.any(String), precious);
    expect(readActiveNoteSnapshot()?.content).toContain('precious unsaved body');
    expect(state.editor.noteId).toBe('replacement');
  });

  it('keeps the library locked until every requested deletion settles (B05)', async () => {
    await mount(); await palette();
    vi.spyOn(db, 'getAllNotes').mockResolvedValue([summary('a'), summary('b')]);
    const delayed = deferred<void>();
    vi.mocked(db.deleteNote).mockImplementation(id => id === 'a' ? Promise.reject(new Error('disk error')) : delayed.promise);
    let operation!: Promise<void>;
    await act(async () => { operation = state.palette.onPromptClearAllNotes(); });
    expect(host.querySelector('.app-shell')?.hasAttribute('inert')).toBe(true);
    await act(async () => { delayed.resolve(); await operation; });
    expect(host.querySelector('.app-shell')?.hasAttribute('inert')).toBe(false);
  });

  it('discards a successfully deleted active note when another deletion fails (B05)', async () => {
    await mount(); await palette();
    vi.spyOn(db, 'getAllNotes').mockResolvedValue([summary('a'), summary('b')]);
    vi.mocked(db.deleteNote).mockImplementation(id => id === 'a' ? Promise.resolve() : Promise.reject(new Error('disk error')));
    vi.mocked(db.getRecentNotes).mockResolvedValue([summary('b')]);
    await act(async () => { await state.palette.onPromptClearAllNotes(); });
    expect(state.editor.noteId).toBe('b');
    expect(noteCache.has('a')).toBe(false);
  });

  it.each([
    ['duplicate', 'onDuplicateNote'], ['Markdown copy', 'onCopyNoteAsMarkdown'],
    ['plain-text copy', 'onCopyNoteAsText'], ['single export', 'onExportNote'],
  ])('awaits the active editor flush before %s reads content (B08)', async (_label, action) => {
    await mount(); await palette();
    const flush = deferred<void>();
    vi.mocked(db.flushEditorNow).mockClear().mockReturnValue(flush.promise);
    let operation!: Promise<void>;
    await act(async () => { operation = state.palette[action](); });
    expect(db.flushEditorNow).toHaveBeenCalled();
    expect(copyToClipboard).not.toHaveBeenCalled(); expect(downloadFile).not.toHaveBeenCalled(); expect(db.createNote).not.toHaveBeenCalled();
    await act(async () => { noteCache.set('a', doc('a', 'LATEST EDIT'), version, 'a'); flush.resolve(); await operation; });
    if (action === 'onDuplicateNote') expect(vi.mocked(db.updateNote).mock.calls[0][2]).toContain('LATEST EDIT');
    else if (action === 'onExportNote') expect(vi.mocked(downloadFile).mock.calls[0][1]).toContain('LATEST EDIT');
    else expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toContain('LATEST EDIT');
  });

  it('updates the duplicate first H1 to match its Copy metadata title (B13)', async () => {
    await mount(); await palette();
    await act(async () => { await state.palette.onDuplicateNote(); });
    const [, copiedTitle, content] = vi.mocked(db.updateNote).mock.calls[0];
    const first = JSON.parse(content).content[0];
    expect(first.type).toBe('heading');
    expect(first.content.map((n: any) => n.text ?? '').join('')).toBe(copiedTitle);
  });

  it.each([
    [{ enabled: false, hotkey: '⌘P' }, 'disabled'],
    [{ enabled: true, hotkey: '⌘J' }, 'remapped'],
  ])('does not keep CmdP active when browse is %s (B17)', async (config) => {
    localStorage.setItem('notefast_commands_config', JSON.stringify([{ id: 'browse', ...config }]));
    await mount();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', metaKey: true, bubbles: true, cancelable: true })); });
    expect(state.search.isOpen).toBe(false);
  });

  it('removes a deleted inactive note from navigation history (B32)', async () => {
    await mount();
    await act(async () => (window as any).__RAYNOTE_SELECT_NOTE__('b', summary('b')));
    await act(async () => (window as any).__RAYNOTE_SELECT_NOTE__('a', summary('a')));
    await palette();
    vi.mocked(db.getRecentNotes).mockResolvedValue([summary('a')]);
    await act(async () => { await state.palette.onDeleteNote('b'); });
    await act(async () => state.palette.onGoBack());
    expect(state.editor.noteId).toBe('a');
  });

  it('does not navigate back to deleted IDs after Clear All (B32)', async () => {
    await mount();
    await act(async () => (window as any).__RAYNOTE_SELECT_NOTE__('b', summary('b')));
    await palette();
    vi.spyOn(db, 'getAllNotes').mockResolvedValue([summary('a'), summary('b')]);
    await act(async () => { await state.palette.onPromptClearAllNotes(); });
    await act(async () => state.palette.onGoBack());
    expect(state.editor.noteId).toBeNull();
  });

  it('does not trigger orphan recovery when startup DB read fails transiently (R03)', async () => {
    const precious = doc('Precious title', 'precious unsaved body');
    writeActiveNoteSnapshot({ id: 'saved-outside-recents', content: precious, baseUpdatedAt: version, unsaved: true });
    vi.mocked(db.getRecentNotes).mockResolvedValue([summary('a')]);
    vi.mocked(db.getNote).mockRejectedValue(new Error('transient sqlite error'));
    await mount();
    expect(db.createNote).not.toHaveBeenCalled();
    expect(readActiveNoteSnapshot()?.content).toContain('precious unsaved body');
  });

  it('restores title and summary of source note when note switch fails (R05)', async () => {
    await mount();
    expect(state.editor.noteId).toBe('a');
    expect(titleStore.getTitle()).toBe('a');
    // Start switch to b
    await act(async () => (window as any).__RAYNOTE_SELECT_NOTE__('b', summary('b')));
    expect(titleStore.getTitle()).toBe('b');
    // Simulate switch failure back to a
    await act(async () => state.editor.onSwitchFailed('a', new Error('Note could not be loaded')));
    expect(state.editor.noteId).toBe('a');
    expect(titleStore.getTitle()).toBe('a');
  });

  it('Export All flushes editor and save queue before exporting from DB (R06)', async () => {
    const exportSpy = vi.spyOn(db, 'exportAllNotesFromDb').mockResolvedValue('Exported 2 notes');
    await mount();
    await palette();
    const calls: string[] = [];
    vi.mocked(db.flushEditorNow).mockImplementation(async () => { calls.push('flushEditor'); });
    vi.mocked(db.flushSaveQueue).mockImplementation(async () => { calls.push('flushQueue'); });
    exportSpy.mockImplementation(async () => { calls.push('exportDb'); return 'ok'; });
    await act(async () => { await state.palette.onExportAllNotes(); });
    expect(calls).toEqual(['flushEditor', 'flushQueue', 'exportDb']);
  });
  it('retains every cached revision during recovery and saves a real heading title',async()=>{
    await mount();const old=doc('Original','old'),first=doc('First title','first new'),last=doc('Last title','LAST TYPING');
    noteCache.set('a',old,version,'Original',0,true);
    const writes=[deferred<string>(),deferred<string>()];let count=0;
    vi.mocked(db.updateNote).mockImplementation(async()=>count<2?writes[count++].promise:version);
    let operation!:Promise<string>;await act(async()=>{operation=state.editor.onRecoverOrphan(old,'a')});
    noteCache.updateContent('a',first,'First title');
    await act(async()=>writes[0].resolve(version));
    noteCache.updateContent('a',last,'Last title');
    await act(async()=>{writes[1].resolve(version);await operation});
    expect(readActiveNoteSnapshot()?.content).toBe(last);
    expect(vi.mocked(db.updateNote).mock.calls[vi.mocked(db.updateNote).mock.calls.length - 1]).toEqual(['copy','Last title',last]);
  });
  it('keeps interrupted recovery on lookup error instead of creating a duplicate',async()=>{
    await mount();localStorage.setItem('notefast_recovered_note_id',JSON.stringify({sourceId:'a',recoveredId:'existing'}));
    vi.mocked(db.getNote).mockRejectedValue(new Error('temporarily unavailable'));
    await act(async()=>{await expect(state.editor.onRecoverOrphan(doc('Draft'),'a')).rejects.toThrow('temporarily unavailable')});
    expect(db.createNote).not.toHaveBeenCalled();
    expect(localStorage.getItem('notefast_recovered_note_id')).toContain('existing');
  });
  it('restores the history cursor after failed Back without deleting visited notes',async()=>{
    await mount();
    await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('b',summary('b')));
    await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('c',summary('c')));
    await palette();await act(async()=>state.palette.onGoBack());
    await act(async()=>state.editor.onSwitchFailed('c',new Error('Note could not be loaded')));
    await act(async()=>state.palette.onGoBack());expect(state.editor.noteId).toBe('b');
  });

  it('restores forward history when a fresh branch fails',async()=>{
    await mount();await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('b',summary('b')));
    await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('c',summary('c')));await palette();
    await act(async()=>state.palette.onGoBack());expect(state.editor.noteId).toBe('b');
    await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('d',summary('d')));
    await act(async()=>state.editor.onSwitchFailed('b',new Error('Note could not be loaded')));
    await act(async()=>state.palette.onGoForward());expect(state.editor.noteId).toBe('c');
  });

  it('never regresses the retained recovery revision if replacement caching evicts its source',async()=>{
    await mount();const latest=doc('Latest','precious');noteCache.set('a',latest,version,'Latest',0,true);
    const original=noteCache.set.bind(noteCache);
    vi.spyOn(noteCache,'set').mockImplementation((...args)=>{original(...args);if(args[0]==='copy')noteCache.delete('a')});
    await act(async()=>{await state.editor.onRecoverOrphan(doc('Old','outdated'),'a')});
    expect(readActiveNoteSnapshot()?.content).toBe(latest);
    expect(vi.mocked(db.updateNote).mock.calls.every(c=>!c[2].includes('outdated'))).toBe(true);
  });

  it('coalesces recovery requests for different revisions of the same source',async()=>{
    await mount();const pending=deferred<string>();vi.mocked(db.updateNote).mockReturnValueOnce(pending.promise);
    const older=doc('Old'),latest=doc('Latest');noteCache.set('a',older,version,'Old',0,true);
    let first!:Promise<string>,second!:Promise<string>;
    await act(async()=>{first=state.editor.onRecoverOrphan(older,'a')});
    noteCache.updateContent('a',latest,'Latest');
    await act(async()=>{second=state.editor.onRecoverOrphan(latest,'a')});
    await act(async()=>{pending.resolve(version);expect(await first).toBe('copy');expect(await second).toBe('copy')});
    expect(db.createNote).toHaveBeenCalledOnce();expect(readActiveNoteSnapshot()?.content).toBe(latest);
  });

  it('preserves a failed Forward entry so navigation can be retried',async()=>{
    await mount();await act(async()=>(window as any).__RAYNOTE_SELECT_NOTE__('b',summary('b')));
    await palette();await act(async()=>state.palette.onGoBack());expect(state.editor.noteId).toBe('a');
    await act(async()=>state.palette.onGoForward());
    await act(async()=>state.editor.onSwitchFailed('a',new Error('Note could not be loaded')));
    await act(async()=>state.palette.onGoForward());expect(state.editor.noteId).toBe('b');
  });

});
