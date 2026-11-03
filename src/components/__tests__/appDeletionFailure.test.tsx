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
vi.mock('../TitleBar', () => ({ TitleBar: (props: any) => <button data-palette onClick={props.onOpenCommandPalette}>Palette</button> }));
vi.mock('../NoteEditor', () => ({ NoteEditor: (props: any) => { state.editor = props; return <div data-note={props.noteId} />; } }));
vi.mock('../WindowResizeHandles', () => ({ WindowResizeHandles: () => null }));
vi.mock('../CommandPalette', () => ({ CommandPalette: (props: any) => { state.palette = props; return null; } }));
vi.mock('../SmartSearch', () => ({ SmartSearch: () => null, clearCachedRecentSearchResults: vi.fn() }));
vi.mock('../ShortcutsModal', () => ({ ShortcutsModal: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const summary = (id: string) => ({ id, title: id, preview: id, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', is_pinned: false });
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  localStorage.clear(); noteCache.clear(); titleStore.reset(); state.palette = null;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(db, 'getRecentNotes').mockResolvedValue([summary('a'), summary('b')]);
  vi.spyOn(db, 'getNote').mockImplementation(async id => ({ ...summary(id), content: 'content' }));
  vi.spyOn(db, 'flushEditorNow').mockResolvedValue(); vi.spyOn(db, 'flushSaveQueue').mockResolvedValue();
  vi.spyOn(db, 'setAlwaysOnTop').mockResolvedValue();
  vi.spyOn(db, 'registerExitFlushHandler').mockReturnValue(undefined); vi.spyOn(db, 'registerPanelHideHandler').mockReturnValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); noteCache.clear(); localStorage.clear(); });
async function openPalette() {
  await act(async () => root.render(<App />));
  await act(async () => (host.querySelector('[data-palette]') as HTMLButtonElement).click());
  expect(state.editor.noteId).toBe('a'); expect(state.palette).not.toBeNull();
}
describe('Deletion reconciliation and successful recovery ownership', () => {
  it('never leaves the successfully deleted active document selected if refreshing recents fails', async () => {
    const deleted = vi.spyOn(db, 'deleteNote').mockResolvedValue();
    await openPalette(); vi.mocked(db.getRecentNotes).mockRejectedValue(new Error('Read unavailable'));
    await act(async () => state.palette.onDeleteNote('a'));
    expect(deleted).toHaveBeenCalledWith('a');
    expect(state.editor.noteId).not.toBe('a');
    expect(state.palette.notes.some((note: db.NoteSummary) => note.id === 'a')).toBe(false);
  });

  it('reconciles successful deletions even if another delete and the recents refresh both fail', async () => {
    vi.spyOn(db, 'getAllNotes').mockResolvedValue([summary('a'), summary('b')]);
    vi.spyOn(db, 'deleteNote').mockImplementation(id => id === 'a' ? Promise.resolve() : Promise.reject(new Error('Cannot delete b')));
    window.confirm = vi.fn().mockReturnValue(true);
    await openPalette(); vi.mocked(db.getRecentNotes).mockRejectedValue(new Error('Read unavailable'));
    await act(async () => state.palette.onPromptClearAllNotes());
    expect(state.editor.noteId).not.toBe('a');
    expect(state.palette.notes.some((note: db.NoteSummary) => note.id === 'a')).toBe(false);
    expect(state.palette.notes.some((note: db.NoteSummary) => note.id === 'b')).toBe(true);
  });

  it('discards the old source after recovery becomes durable so switching cannot save the orphan again', async () => {
    const discarded = vi.spyOn(db, 'discardEditorNote');
    vi.spyOn(db, 'createNote').mockResolvedValue({ ...summary('recovered'), content: '' });
    vi.spyOn(db, 'updateNote').mockResolvedValue('2026-11-03T00:00:00Z');
    await openPalette();
    await act(async () => state.editor.onRecoverOrphan('Recovered draft', 'a'));
    expect(discarded).toHaveBeenCalledWith('a');
    expect(state.editor.noteId).toBe('recovered');
  });
});
