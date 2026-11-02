// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SmartSearch, clearCachedRecentSearchResults } from '../SmartSearch';
import * as db from '../../lib/db';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const summary = { id: 'one', title: 'Original note', preview: '', created_at: '2026-01-01', updated_at: '2026-01-01', is_pinned: false };
describe('SmartSearch library refresh regressions', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    clearCachedRecentSearchResults();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.spyOn(db, 'flushSaveQueue').mockResolvedValue();
    vi.spyOn(db, 'flushEditorNow').mockResolvedValue();
    vi.spyOn(db, 'getRecentSearchResults').mockResolvedValue([]);
    vi.spyOn(db, 'searchDocuments').mockResolvedValue([]);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  it('preserves typed query when autosave refreshes note summaries', async () => {
    await act(async () => root.render(<SmartSearch isOpen onClose={() => {}} onSelectNote={() => {}} notes={[summary]} />));
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'typing');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => root.render(<SmartSearch isOpen onClose={() => {}} onSelectNote={() => {}} notes={[{ ...summary, title: 'Saved change' }]} />));
    expect(input.value).toBe('typing');
  });
  it('accepts authoritative empty results and removes cached deleted notes', async () => {
    await act(async () => root.render(<SmartSearch isOpen onClose={() => {}} onSelectNote={() => {}} notes={[summary]} />));
    expect(host.textContent).not.toContain('Original note');
  });
});
