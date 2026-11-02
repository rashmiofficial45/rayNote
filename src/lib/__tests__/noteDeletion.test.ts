// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
const bus = vi.hoisted(() => ({ listeners: new Map<string, (event: { payload: any }) => unknown>() }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, callback: (event: { payload: any }) => unknown) => {
    bus.listeners.set(event, callback);
    return () => { bus.listeners.delete(event); };
  }),
  emit: vi.fn(async (event: string, payload: any) => { void bus.listeners.get(event)?.({ payload }); }),
}));
import { requestClearAllNotes, registerClearAllNotesHandler } from '../noteDeletion';
import { emit } from '@tauri-apps/api/event';

describe('Cross-window note deletion coordination', () => {
  afterEach(() => { bus.listeners.clear(); vi.clearAllMocks(); vi.useRealTimers(); });
  it('waits for the editor owner to finish before acknowledging deletion', async () => {
    let finish!: () => void;
    const clear = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const stop = await registerClearAllNotesHandler(clear);
    let completed = false;
    const request = requestClearAllNotes().then(() => { completed = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(clear).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    finish(); await request;
    expect(completed).toBe(true);
    expect(bus.listeners.has('raynote://clear-notes-result')).toBe(false);
    stop();
  });
  it('reports owner failure and never deletes from the settings window as a fallback', async () => {
    await registerClearAllNotesHandler(async () => { throw new Error('SQLite unavailable'); });
    await expect(requestClearAllNotes()).rejects.toThrow('SQLite unavailable');
    expect(bus.listeners.has('raynote://clear-notes-result')).toBe(false);
  });
  it('times out safely if the editor owner is unavailable and cleans up its listener', async () => {
    vi.useFakeTimers();
    const request = requestClearAllNotes();
    const rejected = expect(request).rejects.toThrow('notes window did not finish');
    await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(bus.listeners.has('raynote://clear-notes-result')).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
