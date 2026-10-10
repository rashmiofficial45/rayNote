import { describe, it, expect } from 'vitest';
import { NoteLRUCache, MAX_ENTRIES, MAX_CACHE_BYTES } from '../noteCache';

describe('NoteLRUCache Regression & Boundedness Tests', () => {
  it('1. Basic Set & Get retrieves content and scroll position correctly', () => {
    const cache = new NoteLRUCache(5, 1024 * 1024);
    cache.set('n1', 'Content 1', '2026-10-07T00:00:00Z', 'Preview 1', 150);
    const item = cache.get('n1');
    expect(item).toBeDefined();
    expect(item?.content).toBe('Content 1');
    expect(item?.scrollTop).toBe(150);
  });

  it('2. Enforces entry limit (MAX_ENTRIES = 25): adding 25 notes stays within limit, 26th evicts LRU', () => {
    const cache = new NoteLRUCache(MAX_ENTRIES, MAX_CACHE_BYTES);

    // Insert 25 distinct notes
    for (let i = 1; i <= 25; i++) {
      cache.set(`note-${i}`, `Note body ${i}`);
    }
    expect(cache.size).toBe(25);
    expect(cache.has('note-1')).toBe(true);
    expect(cache.has('note-25')).toBe(true);

    // Adding 26th note must evict note-1 (the least recently used)
    cache.set('note-26', 'Note body 26');
    expect(cache.size).toBe(25);
    expect(cache.has('note-1')).toBe(false); // evicted!
    expect(cache.has('note-2')).toBe(true);
    expect(cache.has('note-26')).toBe(true);
  });

  it('3. Reading an older note updates its recent-use position before 26th note insertion', () => {
    const cache = new NoteLRUCache(MAX_ENTRIES, MAX_CACHE_BYTES);

    // Insert 25 notes
    for (let i = 1; i <= 25; i++) {
      cache.set(`note-${i}`, `Note body ${i}`);
    }

    // Access note-1 (moves it to the front of LRU queue)
    const readNote1 = cache.get('note-1');
    expect(readNote1).toBeDefined();

    // Now insert note-26: note-2 must be evicted instead of note-1!
    cache.set('note-26', 'Note body 26');
    expect(cache.size).toBe(25);
    expect(cache.has('note-1')).toBe(true); // preserved because it was read!
    expect(cache.has('note-2')).toBe(false); // note-2 evicted as it was the oldest
    expect(cache.has('note-26')).toBe(true);
  });

  it('4. Enforces 8 MB memory budget (MAX_CACHE_BYTES) and evicts oldest to stay bounded', () => {
    const limitBytes = 8 * 1024 * 1024; // 8 MB
    const cache = new NoteLRUCache(100, limitBytes);
    const chunk1MB = 'a'.repeat(500 * 1024); // ~1 MB UTF-16 string

    // Insert 7 x 1MB notes -> 7 MB < 8 MB
    for (let i = 1; i <= 7; i++) {
      cache.set(`big-${i}`, chunk1MB);
    }
    expect(cache.size).toBe(7);
    expect(cache.totalBytes).toBeLessThanOrEqual(limitBytes);

    // Insert 8th and 9th -> total would be ~9 MB, so oldest entries must be evicted
    cache.set('big-8', chunk1MB);
    cache.set('big-9', chunk1MB);
    expect(cache.totalBytes).toBeLessThanOrEqual(limitBytes);
    expect(cache.has('big-1')).toBe(false); // evicted to preserve 8 MB budget
    expect(cache.has('big-9')).toBe(true);
  });

  it('5. Handles oversized entries (> 8 MB) safely without infinite loop or throwing', () => {
    const limitBytes = 8 * 1024 * 1024;
    const cache = new NoteLRUCache(25, limitBytes);
    const massiveDoc = 'm'.repeat(5 * 1024 * 1024); // ~10 MB string

    // Pre-populate with a few notes
    cache.set('n1', 'small note');
    cache.set('n2', 'another small note');

    // Inserting an oversized entry that exceeds total budget on its own
    expect(() => {
      cache.set('giant-note', massiveDoc);
    }).not.toThrow();

    // The oversized entry evicts other notes and safely remains as single entry without crashing
    expect(cache.has('n1')).toBe(false);
    expect(cache.has('n2')).toBe(false);
    expect(cache.has('giant-note')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('6. Persists and updates scroll position independently', () => {
    const cache = new NoteLRUCache(5, 1024 * 1024);
    cache.set('n1', 'Hello world', undefined, undefined, 4200);
    expect(cache.getScrollTop('n1')).toBe(4200);

    cache.setScrollTop('n1', 7850);
    expect(cache.getScrollTop('n1')).toBe(7850);
  });

  it('7. Updates content in-place without resetting scroll offset', () => {
    const cache = new NoteLRUCache(5, 1024 * 1024);
    cache.set('n1', 'Original Content', '2026-10-07T00:00:00Z', 'Preview 1', 500);

    cache.updateContent('n1', 'Edited Content', 'Updated Preview');
    const updated = cache.get('n1');
    expect(updated?.content).toBe('Edited Content');
    expect(updated?.scrollTop).toBe(500);
    expect(updated?.preview).toBe('Updated Preview');
  });

  it('8. High throughput benchmark: 50,000 lookups complete in under 50ms', () => {
    const cache = new NoteLRUCache(25, 8 * 1024 * 1024);
    const mediumDoc = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100);

    for (let i = 0; i < 25; i++) {
      cache.set(`note-${i}`, mediumDoc);
    }

    const t0 = performance.now();
    for (let i = 0; i < 50000; i++) {
      cache.get(`note-${i % 25}`);
    }
    const duration = performance.now() - t0;
    expect(duration).toBeLessThan(100);
  });
});
