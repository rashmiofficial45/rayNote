// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import * as db from '../../lib/db';
import { listen } from '@tauri-apps/api/event';
import { noteCache } from '../../lib/noteCache';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ isFocused: () => Promise.resolve(true), onFocusChanged: () => Promise.resolve(() => {}), setFocus: () => Promise.resolve() }) }));
vi.mock('../TitleBar', () => ({ TitleBar: (props: any) => <button data-open-palette onClick={props.onOpenCommandPalette}>Palette</button> }));
vi.mock('../NoteEditor', () => ({ NoteEditor: ({ isFindOpen }: { isFindOpen: boolean }) => <textarea data-editor data-find-open={isFindOpen} /> }));
vi.mock('../WindowResizeHandles', () => ({ WindowResizeHandles: () => null }));
vi.mock('../SmartSearch', () => ({ SmartSearch: ({ isOpen }: { isOpen: boolean }) => isOpen ? <input data-note-switcher /> : null, clearCachedRecentSearchResults: vi.fn() }));
vi.mock('../ShortcutsModal', () => ({ ShortcutsModal: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-shortcuts /> : null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  localStorage.clear(); noteCache.clear(); vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(db, 'getRecentNotes').mockResolvedValue([]); vi.spyOn(db, 'flushEditorNow').mockResolvedValue(); vi.spyOn(db, 'flushSaveQueue').mockResolvedValue();
  vi.spyOn(db, 'setAlwaysOnTop').mockResolvedValue(); vi.spyOn(db, 'hideWindow').mockResolvedValue();
  vi.spyOn(db, 'registerExitFlushHandler').mockReturnValue(undefined); vi.spyOn(db, 'registerPanelHideHandler').mockReturnValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear(); noteCache.clear(); });
describe('App native wiring and Escape precedence', () => {
  it('mounts the main app when WebKit storage access is denied (B33)', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    await expect(act(async () => root.render(<App />))).resolves.toBeUndefined();
    expect(host.querySelector('.app-shell')).not.toBeNull();
  });
  it('hides on Escape when the loses-focus preference is disabled (B20)', async () => {
    localStorage.setItem('notefast_esc_loses_focus', 'false'); await act(async () => root.render(<App />));
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(db.hideWindow).toHaveBeenCalledTimes(1);
  });
  it('keeps the window visible when Escape only drops focus (B20)', async () => {
    localStorage.setItem('notefast_esc_loses_focus', 'true'); await act(async () => root.render(<App />));
    const input = host.querySelector('textarea')!; input.focus();
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(db.hideWindow).not.toHaveBeenCalled(); expect(document.activeElement).not.toBe(input);
  });
  it('creates a note when the native tray emits new-note (B21)', async () => {
    const note = { id: 'new', title: '', content: '', preview: '', created_at: '2026-11-03', updated_at: '2026-11-03', is_pinned: false };
    const create = vi.spyOn(db, 'createNote').mockResolvedValue(note); await act(async () => root.render(<App />));
    const handler = vi.mocked(listen).mock.calls.find(([event]) => event === 'new-note')?.[1];
    expect(handler).toBeDefined();
    await act(async () => { await handler!({ event: 'new-note', id: 1, payload: undefined }); });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('replaces the active panel when using shortcuts or the palette Notes button', async () => {
    await act(async () => root.render(<App />));
    const shortcut = async (key: string, metaKey = true) => {
      await act(async () => {
        const target = document.activeElement ?? window;
        target.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, bubbles: true, cancelable: true }));
      });
    };
    const expectOnly = (selector?: string) => {
      const open = host.querySelectorAll('.command-palette, [data-note-switcher], [data-shortcuts], [data-find-open="true"]');
      expect(Array.from(open)).toEqual(selector ? [host.querySelector(selector)] : []);
    };

    await shortcut('k');
    expectOnly('.command-palette');
    await shortcut('p');
    expectOnly('[data-note-switcher]');
    await shortcut('k');
    expectOnly('.command-palette');

    await act(async () => host.querySelector<HTMLButtonElement>('.command-view-switch-btn')!.click());
    expectOnly('[data-note-switcher]');
    await shortcut('Escape', false);
    expectOnly();

    await shortcut('k');
    await shortcut('/');
    expectOnly('[data-shortcuts]');
    await shortcut('f');
    expectOnly('[data-find-open="true"]');
    await shortcut('Escape', false);
    expectOnly();
  });
  it('returns from palette appearance submenu before closing the palette (B31)', async () => {
    await act(async () => root.render(<App />));
    await act(async () => (host.querySelector('[data-open-palette]') as HTMLButtonElement).click());
    const appearance = Array.from(host.querySelectorAll<HTMLButtonElement>('.command-item')).find(button => button.textContent?.includes('Appearance Mode'))!;
    await act(async () => appearance.click());
    const input = host.querySelector<HTMLInputElement>('.command-search input')!;
    expect(input.placeholder).toContain('Choose appearance');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(host.querySelector('.command-palette')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('.command-search input')?.placeholder).toBe('Search notes, commands & settings…');
  });
});
