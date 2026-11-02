// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NoteLRUCache } from '../noteCache';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('Cache eviction under storage failure', () => {
  it('removes memory entry and updates accounting even when storage is blocked', () => {
    const cache = new NoteLRUCache();
    cache.set('a', 'cached content');
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(() => cache.delete('a')).not.toThrow();
    expect(cache.has('a')).toBe(false);
    expect(cache.totalBytes).toBe(0);
  });
});

describe('Atomic recovery snapshots', () => {
  it('hydrates a coherent snapshot when a legacy content mirror write fails', () => {
    const cache = new NoteLRUCache();
    cache.persistActiveToLocalStorage('old', 'old content', 'old-version', false);
    const set = localStorage.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === 'notefast_active_note_content') throw new DOMException('Quota', 'QuotaExceededError');
      set(key, value);
    });
    cache.persistActiveToLocalStorage('new', 'new content', 'new-version', false);
    const hydrated = new NoteLRUCache();
    expect(hydrated.get('new')?.content).toBe('new content');
    expect(hydrated.get('new')?.baseUpdatedAt).toBe('new-version');
    expect(hydrated.get('new')?.unsaved).toBe(false);
  });

  it('retains the previous complete snapshot when the atomic write fails', () => {
    const cache = new NoteLRUCache();
    cache.persistActiveToLocalStorage('old', 'previous complete content', 'old-version', false);
    const set = localStorage.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === 'notefast_active_note_snapshot') throw new DOMException('Quota', 'QuotaExceededError');
      set(key, value);
    });
    cache.persistActiveToLocalStorage('new', 'new content', 'new-version', false);
    const hydrated = new NoteLRUCache();
    expect(hydrated.get('old')?.content).toBe('previous complete content');
    expect(hydrated.get('old')?.unsaved).toBe(false);
    expect(hydrated.has('new')).toBe(false);
  });
});


describe('Pending source save recovery', () => {
  it('keeps unsaved source recovery until that source is committed before persisting a target', () => {
    const cache = new NoteLRUCache();
    cache.persistActiveToLocalStorage('source', 'new edits', 'v1', true);
    cache.persistActiveToLocalStorage('target', 'target content', 'v2', false);
    expect(new NoteLRUCache().get('source')?.content).toBe('new edits');
    cache.persistActiveToLocalStorage('source', 'new edits', 'v3', false);
    cache.persistActiveToLocalStorage('target', 'target content', 'v2', false);
    expect(new NoteLRUCache().get('target')?.content).toBe('target content');
  });
});
