// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SmartSearch, clearCachedRecentSearchResults } from '../SmartSearch';
import * as db from '../../lib/db';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const note = { id: 'old', title: 'Unrelated previous result', preview: '', created_at: '2026-11-03', updated_at: '2026-11-03', is_pinned: false };
const recent = { id: note.id, title: note.title, snippet: '', score: 1000, match_type: 'recent', updated_at: note.updated_at, is_pinned: false };
describe('Audit search failure and keyboard regressions', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => {
    vi.useFakeTimers(); clearCachedRecentSearchResults();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.spyOn(db, 'flushEditorNow').mockResolvedValue(); vi.spyOn(db, 'flushSaveQueue').mockResolvedValue();
    vi.spyOn(db, 'getRecentSearchResults').mockResolvedValue([recent]);
    vi.spyOn(db, 'searchDocuments').mockResolvedValue([]);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
  it('does not open a stale result after the current query fails (B09)', async () => {
    const select = vi.fn();
    await act(async () => root.render(<SmartSearch isOpen onClose={() => {}} onSelectNote={select} notes={[note]} />));
    expect(host.textContent).toContain(note.title);
    vi.mocked(db.searchDocuments).mockRejectedValue(new Error('database temporarily unavailable'));
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'zzzz-no-match');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(select).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain(note.title);
  });
  it.each([false, true])('contains %s-shift Tab when the query input is the sole tab stop (B11)', async shiftKey => {
    await act(async () => root.render(<><button>Background control</button><SmartSearch isOpen onClose={() => {}} onSelectNote={() => {}} notes={[]} /></>));
    const input = host.querySelector('input')!; input.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    act(() => input.dispatchEvent(event));
    // happy-dom does not perform native Tab traversal. Preventing its default is
    // required at this boundary to keep focus inside the one-control modal.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});
