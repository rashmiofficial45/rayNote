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
});
