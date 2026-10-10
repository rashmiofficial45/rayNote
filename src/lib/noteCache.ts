/**
 * High-Performance In-Memory LRU Cache for rayNote (noteCache.ts)
 *
 * Architecture:
 * - Dual-bounded eviction: Evicts least-recently-used notes when either:
 *     1. MAX_ENTRIES (25 notes) is exceeded, OR
 *     2. MAX_CACHE_BYTES (~8 MB) is exceeded.
 * - Single Editor Shell: Stores serialized document payloads and scroll positions,
 *   enabling 0ms instantaneous note switching inside a SINGLE mounted Tiptap editor.
 * - Zero React Render Overhead: Lives outside React state as a pure in-memory store.
 * - Recency-Preserving: Every `get()` promotes the entry to the front of the LRU queue.
 */

export interface CachedNote {
  id: string;
  content: string;
  updatedAt: number; // Unix timestamp in ms
  preview?: string;
  scrollTop: number;
  byteSize: number;
}

export interface NoteCacheStats {
  count: number;
  totalBytes: number;
  maxEntries: number;
  maxBytes: number;
}

export const MAX_ENTRIES = 25;
export const MAX_CACHE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_SINGLE_NOTE_BYTES = 2 * 1024 * 1024; // 2 MB soft ceiling for weighted caching

export class NoteLRUCache {
  private cache = new Map<string, CachedNote>();
  private currentTotalBytes = 0;
  private maxEntries: number;
  private maxBytes: number;

  constructor(maxEntries = MAX_ENTRIES, maxBytes = MAX_CACHE_BYTES) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.hydrateFromLocalStorage();
  }

  /**
   * Hydrates the most recently active note from localStorage on app boot (0ms cold start).
   */
  hydrateFromLocalStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const activeId = localStorage.getItem("notefast_active_note_id");
      const activeContent = localStorage.getItem("notefast_active_note_content");
      if (activeId && activeContent) {
        this.set(activeId, activeContent, Date.now(), undefined, 0);
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Persists active note ID and content to localStorage for instant hydration on next launch.
   */
  persistActiveToLocalStorage(id: string, content: string): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem("notefast_active_note_id", id);
      localStorage.setItem("notefast_active_note_content", content);
    } catch {
      // Ignore quota errors
    }
  }

  get size(): number {
    return this.cache.size;
  }

  get totalBytes(): number {
    return this.currentTotalBytes;
  }

  /**
   * Estimates memory footprint of an entry in bytes.
   * JavaScript strings use UTF-16 (2 bytes per character) + metadata overhead.
   */
  private estimateSize(content: string, preview?: string): number {
    const contentBytes = (content?.length || 0) * 2;
    const previewBytes = (preview?.length || 0) * 2;
    return contentBytes + previewBytes + 160; // 160 bytes for object & field overhead
  }

  /**
   * Retrieves a note from cache and promotes it to the front of the LRU queue.
   */
  get(id: string): CachedNote | undefined {
    const entry = this.cache.get(id);
    if (!entry) return undefined;

    // Refresh recency in Map (delete and re-insert at end of iteration order)
    this.cache.delete(id);
    this.cache.set(id, entry);
    return entry;
  }

  /**
   * Inspects a cached note without altering its LRU recency position.
   */
  peek(id: string): CachedNote | undefined {
    return this.cache.get(id);
  }

  /**
   * Returns true if note exists in memory cache.
   */
  has(id: string): boolean {
    return this.cache.has(id);
  }

  /**
   * Inserts or updates a cached note, enforcing both MAX_ENTRIES and MAX_CACHE_BYTES.
   */
  set(
    id: string,
    content: string,
    updatedAt?: number | string,
    preview?: string,
    scrollTop = 0
  ): void {
    const ts =
      typeof updatedAt === "string"
        ? new Date(updatedAt).getTime()
        : updatedAt || Date.now();

    const byteSize = this.estimateSize(content, preview);

    // If updating existing entry, deduct its previous size first
    const existing = this.cache.get(id);
    if (existing) {
      this.currentTotalBytes -= existing.byteSize;
      this.cache.delete(id);
    }

    // Insert new entry at end of Map (most recently used)
    const entry: CachedNote = {
      id,
      content,
      updatedAt: ts,
      preview,
      scrollTop: existing ? (scrollTop || existing.scrollTop) : scrollTop,
      byteSize,
    };

    this.cache.set(id, entry);
    this.currentTotalBytes += byteSize;

    // Persist active note to localStorage if this is the active note
    if (typeof localStorage !== "undefined") {
      const activeId = localStorage.getItem("notefast_active_note_id");
      if (!activeId || activeId === id) {
        this.persistActiveToLocalStorage(id, content);
      }
    }

    // Evict oldest entries until both limits are satisfied
    this.evictToBudget(id);
  }

  /**
   * Updates only the scroll position for a cached note (0ms, no LRU reshuffle).
   */
  updateScrollTop(id: string, scrollTop: number): void {
    const entry = this.cache.get(id);
    if (entry) {
      entry.scrollTop = Math.max(0, scrollTop);
    }
  }

  /**
   * Updates note content and timestamp during debounced autosave.
   */
  updateContent(id: string, content: string, preview?: string): void {
    const entry = this.cache.get(id);
    const newByteSize = this.estimateSize(content, preview);
    const oldByteSize = entry ? entry.byteSize : 0;
    const currentScroll = entry ? entry.scrollTop : 0;

    this.currentTotalBytes = this.currentTotalBytes - oldByteSize + newByteSize;

    if (entry) {
      this.cache.delete(id);
    }

    this.cache.set(id, {
      id,
      content,
      updatedAt: Date.now(),
      preview: preview !== undefined ? preview : entry?.preview,
      scrollTop: currentScroll,
      byteSize: newByteSize,
    });

    this.persistActiveToLocalStorage(id, content);
    this.evictToBudget(id);
  }

  /**
   * Removes a note from cache and updates memory total.
   */
  delete(id: string): boolean {
    const entry = this.cache.get(id);
    if (entry) {
      this.currentTotalBytes -= entry.byteSize;
      if (typeof localStorage !== "undefined") {
        const activeId = localStorage.getItem("notefast_active_note_id");
        if (activeId === id) {
          try {
            localStorage.removeItem("notefast_active_note_content");
          } catch {}
        }
      }
      return this.cache.delete(id);
    }
    return false;
  }

  /**
   * Retrieves the cached scroll position for a note (defaults to 0).
   */
  getScrollTop(id: string): number {
    return this.cache.get(id)?.scrollTop || 0;
  }

  /**
   * Sets or updates scroll position.
   */
  setScrollTop(id: string, scrollTop: number): void {
    this.updateScrollTop(id, scrollTop);
  }

  /**
   * Clears the entire cache and resets byte count to 0.
   */
  clear(): void {
    this.cache.clear();
    this.currentTotalBytes = 0;
  }

  /**
   * Returns current cache diagnostics.
   */
  getStats(): NoteCacheStats {
    return {
      count: this.cache.size,
      totalBytes: this.currentTotalBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }

  /**
   * Evicts oldest entries (beginning of Map iterator) until both constraints are met.
   * `keepId` is preserved from eviction during the current insertion.
   */
  private evictToBudget(keepId?: string): void {
    while (
      this.cache.size > this.maxEntries ||
      this.currentTotalBytes > this.maxBytes
    ) {
      // Get least recently used (first key in insertion order)
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;

      // If the only candidate is the one we just inserted, break to avoid infinite loop
      if (oldestKey === keepId && this.cache.size === 1) break;

      const oldest = this.cache.get(oldestKey);
      if (oldest) {
        this.currentTotalBytes -= oldest.byteSize;
      }
      this.cache.delete(oldestKey);
    }
  }
}

// Module-level singleton instance shared across the entire application
export const noteCache = new NoteLRUCache();
