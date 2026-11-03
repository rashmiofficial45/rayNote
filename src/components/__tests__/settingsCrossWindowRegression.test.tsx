// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { getExtensions } from '../../editor/extensions';
import { BottomToolbar } from '../BottomToolbar';
import SettingsApp from '../../SettingsApp';
import { listenToSettingsSync } from '../../lib/settingsSync';
import { listen } from '@tauri-apps/api/event';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue({ notes_count: 0, size_bytes: 0, db_path: '/tmp/disposable.db' }) }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn().mockResolvedValue(undefined), listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: vi.fn().mockResolvedValue(() => {}) }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let editor: Editor; let stop: (() => void) | undefined;
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); editor = new Editor({ extensions: getExtensions(), content: '<p>Test</p>' }); });
afterEach(() => { stop?.(); stop = undefined; act(() => root.unmount()); editor.destroy(); host.remove(); vi.restoreAllMocks(); localStorage.clear(); });
async function deliver(payload: unknown) {
  await act(async () => {
    for (const [event, callback] of [...vi.mocked(listen).mock.calls]) {
      if (event === 'notefast://settings-sync') await callback({ event, id: 1, payload } as any);
    }
  });
}
async function drawToolbar() {
  stop = listenToSettingsSync();
  await act(async () => root.render(<BottomToolbar editor={editor} />));
  act(() => (host.querySelector('[aria-label="Format"]') as HTMLButtonElement).click());
}
describe('Cross-window preference controls', () => {
  it('mounts Settings when WebKit storage access is denied (B33)', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    await expect(act(async () => root.render(<SettingsApp />))).resolves.toBeUndefined();
    expect(host.querySelector('.settings-window-root')).not.toBeNull();
  });
  it('reflects another window theme selection in the toolbar (B23)', async () => {
    await drawToolbar(); await deliver({ type: 'theme_mode', value: 'light' });
    expect(host.querySelector('[aria-label="Light Mode"]')?.classList.contains('is-selected')).toBe(true);
  });
  it('reflects another window accent selection in the toolbar (B23)', async () => {
    await drawToolbar(); await deliver({ type: 'accent', value: 'emerald' });
    expect(host.querySelector('[aria-label="Accent: Emerald Mint"]')?.classList.contains('is-selected')).toBe(true);
  });
  it('reflects another window font selection in the toolbar (B23)', async () => {
    await drawToolbar(); await deliver({ type: 'font', value: 'mono' });
    expect(host.querySelector('.toolbar-font-btn')?.textContent).toContain('JetBrains Mono');
  });
  it('reflects a cross-window menu-bar storage preference in Settings (B24)', async () => {
    await act(async () => root.render(<SettingsApp />));
    const row = Array.from(host.querySelectorAll('.settings-row')).find(row => row.textContent?.includes('Menu Bar'))!;
    expect((row.querySelector('input') as HTMLInputElement).checked).toBe(true);
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'notefast_show_menubar', newValue: 'false' })); });
    expect((row.querySelector('input') as HTMLInputElement).checked).toBe(false);
  });
});
