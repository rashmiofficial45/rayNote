// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import App from '../../App';
import * as db from '../../lib/db';
import { noteCache } from '../../lib/noteCache';
import { titleStore } from '../../lib/titleStore';
const state = vi.hoisted(() => ({ palette: null as any, editor: null as any }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ isFocused: () => Promise.resolve(true), onFocusChanged: () => Promise.resolve(() => {}), setFocus: () => Promise.resolve() }) }));
vi.mock('../../lib/theme', () => ({ initTheme: vi.fn() }));
vi.mock('../TitleBar', () => ({ TitleBar: (p: any) => <button onClick={p.onOpenCommandPalette}>palette</button> }));
vi.mock('../NoteEditor', () => ({ NoteEditor: (p: any) => { state.editor = p; return <div data-note={p.noteId} />; } }));
vi.mock('../WindowResizeHandles', () => ({ WindowResizeHandles: () => null }));
vi.mock('../CommandPalette', () => ({ CommandPalette: (p: any) => { state.palette = p; return <button onClick={p.onPromptClearAllNotes}>clear</button>; } }));
vi.mock('../SmartSearch', () => ({ SmartSearch: () => null, clearCachedRecentSearchResults: vi.fn() }));
vi.mock('../ShortcutsModal', () => ({ ShortcutsModal: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const summary = (id: string) => ({ id, title: id, preview: id, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', is_pinned: false });
describe('App library and selection regressions', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => {
    localStorage.clear(); noteCache.clear(); titleStore.reset(); state.palette = null;
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.spyOn(db, 'getRecentNotes').mockResolvedValue([]);
    vi.spyOn(db, 'flushEditorNow').mockResolvedValue();
    vi.spyOn(db, 'flushSaveQueue').mockResolvedValue();
    vi.spyOn(db, 'setAlwaysOnTop').mockResolvedValue();
    vi.spyOn(db, 'registerExitFlushHandler').mockReturnValue(undefined);
    vi.spyOn(db, 'registerPanelHideHandler').mockReturnValue(undefined);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); noteCache.clear(); localStorage.clear(); });
  it('ignores a slow cache miss after switching to a cached note', async () => {
    let resolve!: (note: db.Note) => void;
    vi.spyOn(db, 'getNote').mockReturnValue(new Promise(r => { resolve = r; }));
    noteCache.set('cached', 'cached body', '2026-01-02T00:00:00Z', 'cached');
    await act(async () => root.render(<App />));
    await act(async () => (window as any).__RAYNOTE_SELECT_NOTE__('slow', summary('slow')));
    await act(async () => (window as any).__RAYNOTE_SELECT_NOTE__('cached', summary('cached')));
    await act(async () => resolve({ ...summary('slow'), content: 'slow body' }));
    expect(titleStore.getTitle()).toBe('cached');
    expect(localStorage.getItem('notefast_active_note_content')).toBe('cached body');
  });
  it('switches the full recovery snapshot metadata with cached content', async () => {
    noteCache.set('cached', 'cached body', '2026-01-02T00:00:00Z', 'cached');
    await act(async () => root.render(<App />));
    localStorage.setItem('notefast_active_note_unsaved', 'true');
    localStorage.setItem('notefast_active_note_base_updated_at', 'old-version');
    await act(async () => (window as any).__RAYNOTE_SELECT_NOTE__('cached', summary('cached')));
    expect(localStorage.getItem('notefast_active_note_unsaved')).toBe('false');
    expect(localStorage.getItem('notefast_active_note_base_updated_at')).toBe('2026-01-02T00:00:00Z');
  });
  it('clears notes beyond the thirty-note recent list', async () => {
    const all = Array.from({ length: 35 }, (_, i) => summary(`note-${i}`));
    vi.spyOn(db, 'getRecentNotes').mockResolvedValue(all.slice(0, 30));
    vi.spyOn(db, 'getNote').mockResolvedValue({ ...all[0], content: 'body' });
    vi.spyOn(db, 'getAllNotes').mockResolvedValue(all);
    const deleted = vi.spyOn(db, 'deleteNote').mockResolvedValue();
    window.confirm = vi.fn().mockReturnValue(true);
    await act(async () => root.render(<App />));
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    expect(state.palette).not.toBeNull();
    await act(async () => { state.palette.onPromptClearAllNotes(); });
    expect(deleted).toHaveBeenCalledTimes(35);
    expect(localStorage.getItem('notefast_active_note_content')).toBeNull();
  });
  it('drains dirty editor writes before deleting its row and marks it discarded for switching', async () => {
    const one = summary('one'); const two = summary('two');
    vi.spyOn(db, 'getRecentNotes').mockResolvedValue([one, two]);
    vi.spyOn(db, 'getNote').mockImplementation(async id => ({ ...summary(id), content: 'body' }));
    const deleted = vi.spyOn(db, 'deleteNote').mockResolvedValue();
    await act(async () => root.render(<App />));
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    let finishFlush!: () => void;
    vi.spyOn(db, 'flushEditorNow').mockReturnValue(new Promise(resolve => { finishFlush = resolve; }));
    vi.spyOn(db, 'getRecentNotes').mockResolvedValue([two]);
    let deletion!: Promise<void>;
    await act(async () => { deletion = state.palette.onDeleteNote('one'); });
    expect(deleted).not.toHaveBeenCalled();
    await act(async () => { finishFlush(); await deletion; });
    expect(deleted).toHaveBeenCalledWith('one');
    expect(state.editor.discardedNoteId).toBe('one');
    expect(state.editor.noteId).toBe('two');
  });

});
