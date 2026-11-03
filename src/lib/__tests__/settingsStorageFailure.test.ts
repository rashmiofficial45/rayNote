// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredCommandsConfig, DEFAULT_COMMANDS } from '../commandsConfig';
import { getStoredThemeMode, getStoredAccent, getStoredFont, setStoredThemeMode, setStoredAccent, setStoredFont } from '../theme';
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn().mockResolvedValue(undefined), listen: vi.fn().mockResolvedValue(() => {}) }));
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
const denyStorage = () => vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Storage unavailable', 'SecurityError'); });
describe('Settings degrade safely when storage is unavailable (B33)', () => {
  it('returns default command configuration', () => { denyStorage(); expect(getStoredCommandsConfig()).toEqual(DEFAULT_COMMANDS); });
  it('returns default theme mode', () => { denyStorage(); expect(getStoredThemeMode()).toBe('dark'); });
  it('returns default accent', () => { denyStorage(); expect(getStoredAccent()).toBe('violet'); });
  it('returns default editor font', () => { denyStorage(); expect(getStoredFont()).toBe('inter'); });
  it('continues applying theme, accent and font for the current session', () => {
    denyStorage();
    expect(() => { setStoredThemeMode('light'); setStoredAccent('emerald'); setStoredFont('mono'); }).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.accent).toBe('emerald');
    expect(document.documentElement.dataset.font).toBe('mono');
  });
});
