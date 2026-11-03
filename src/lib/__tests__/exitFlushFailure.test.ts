import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { registerEditorFlush, registerExitFlushHandler } from '../db';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn() }));
afterEach(() => { registerEditorFlush(null); vi.clearAllMocks(); });
describe('Exit flush failure acknowledgment', () => {
  it('never sends a successful flush acknowledgment when editor persistence rejects (B07)', async () => {
    registerEditorFlush(() => Promise.reject(new Error('Disk full')));
    await registerExitFlushHandler();
    const handler = vi.mocked(listen).mock.calls.find(([name]) => name === 'app-will-exit')![1];
    await Promise.resolve(handler({ event: 'app-will-exit', id: 1, payload: undefined })).catch(() => {});
    const acknowledgments = vi.mocked(invoke).mock.calls.filter(([name]) => name === 'flush_done');
    expect(acknowledgments.every(([, args]: any) => args?.ok === false)).toBe(true);
  });
});
