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
import { invoke } from '@tauri-apps/api/core';
import { getPreferredBrowser } from '../../lib/webBrowsers';
import { getStoredGlassClarity } from '../../lib/theme';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue({ notes_count: 0, size_bytes: 0, db_path: '/tmp/disposable.db' }), isTauri: () => true }));
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
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Appearance"]')!.click());
}
describe('Cross-window preference controls', () => {
  it('reveals Settings after the saved theme and pane have committed', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    localStorage.setItem('notefast_theme_mode', 'light');
    localStorage.setItem('notefast_settings_active_pane', 'commands');
    const native = vi.mocked(invoke);
    const defaultInvoke = native.getMockImplementation()!;
    let visibleTheme: string | undefined;
    let visiblePane: string | null | undefined;
    native.mockImplementation((command, ...args) => {
      if (command === 'reveal_ready_window') {
        visibleTheme = document.documentElement.dataset.resolvedTheme;
        visiblePane = host.querySelector('.settings-sidebar-item[aria-current="page"]')?.textContent;
      }
      return defaultInvoke(command, ...args);
    });
    try {
      await act(async () => root.render(<SettingsApp />));
      expect(visibleTheme).toBe('light');
      expect(visiblePane).toContain('Commands');
    } finally {
      native.mockImplementation(defaultInvoke);
      vi.unstubAllGlobals();
    }
  });
  it('previews glass clarity immediately and ignores out-of-order updates from another window', async () => {
    await act(async () => root.render(<SettingsApp />));
    const picker = host.querySelector<HTMLInputElement>('.glass-clarity-slider')!;
    expect(picker.value).toBe('0');
    await act(async () => {
      const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setNativeValue.call(picker, '100');
      picker.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.documentElement.style.getPropertyValue('--app-glass-clarity')).toBe('100%');
    expect(getStoredGlassClarity()).toBe(100);

    // The native bus can deliver an older value after the webview bus.
    const changedAt = Date.now() + 10;
    await deliver({ type: 'glass_clarity', value: 63, changedAt });
    await deliver({ type: 'glass_clarity', value: 29, changedAt: changedAt - 1 });
    expect(picker.value).toBe('63');
    expect(document.documentElement.style.getPropertyValue('--app-glass-clarity')).toBe('63%');
  });

  it('updates the browser picker when macOS reports added and removed browsers', async () => {
    const native = vi.mocked(invoke);
    const stockResponse = native.getMockImplementation()!;
    let browsers = [{ bundleId: 'com.apple.Safari', name: 'Safari', icon: 'data:image/png;base64,stub' }];
    native.mockImplementation((command, ...args) => command === 'list_web_browsers'
      ? Promise.resolve(browsers) as ReturnType<typeof invoke>
      : stockResponse(command, ...args));

    try {
      await act(async () => root.render(<SettingsApp />));
      const picker = host.querySelector<HTMLButtonElement>('#web-browser')!;
      const items = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
      await act(async () => picker.click());
      expect(items().map(item => item.textContent)).toEqual(['System Default', 'Safari']);
      expect(items()[1].querySelector('img')?.getAttribute('src')).toBe(browsers[0].icon);
      await act(async () => {
        const selected = items()[0];
        selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      expect(document.activeElement).toBe(items()[1]);
      await act(async () => items()[1].click());
      expect(getPreferredBrowser()).toBe('com.apple.Safari');
      expect(picker.querySelector('img')?.getAttribute('src')).toBe(browsers[0].icon);

      browsers = [{ bundleId: 'org.mozilla.firefox', name: 'Firefox', icon: 'data:image/png;base64,other' }];
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await act(async () => picker.click());
      expect(items().map(item => item.textContent)).toEqual([
        'System Default', 'Preferred Browser Unavailable', 'Firefox',
      ]);
      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(items()).toHaveLength(0);
      expect(document.activeElement).toBe(picker);
      expect(host.querySelector('#web-browser-description')?.textContent).toContain('system default');
    } finally {
      native.mockImplementation(stockResponse);
    }
  });

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
