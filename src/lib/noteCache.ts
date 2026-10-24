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

import { safeLocalStorageSetItem, safeLocalStorageRemoveItem } from "./storage";

export interface CachedNote {
  id: string;
  content: string;
  baseUpdatedAt: string; // The SQLite row's updated_at timestamp (RFC3339 / ISO string)
  unsaved: boolean;      // True if modified locally and uncommitted to SQLite
  updatedAt: number;     // Legacy Unix timestamp in ms
  preview?: string;
  title?: string;
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
      const baseUpdatedAt = localStorage.getItem("notefast_active_note_base_updated_at") || "";
      const unsaved = localStorage.getItem("notefast_active_note_unsaved") === "true";
      if (activeId && activeContent) {
        this.set(activeId, activeContent, baseUpdatedAt, undefined, 0, unsaved);
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Persists active note ID, content, and versioning metadata to localStorage for instant hydration on next launch.
   */
  persistActiveToLocalStorage(
    id: string,
    content: string,
    baseUpdatedAt?: string,
    unsaved = false
  ): void {
    if (typeof localStorage === "undefined") return;
    safeLocalStorageSetItem("notefast_active_note_id", id);
    if (content && content.length <= 65536) {
      safeLocalStorageSetItem("notefast_active_note_content", content);
      if (baseUpdatedAt) {
        safeLocalStorageSetItem("notefast_active_note_base_updated_at", baseUpdatedAt);
      }
      safeLocalStorageSetItem("notefast_active_note_unsaved", unsaved ? "true" : "false");
    } else {
      safeLocalStorageRemoveItem("notefast_active_note_content");
      safeLocalStorageRemoveItem("notefast_active_note_base_updated_at");
      safeLocalStorageRemoveItem("notefast_active_note_unsaved");
    }
  }

  get size(): number {
    return this.cache.size;
  }

  get totalBytes(): number {
    return this.currentTotalBytes;
  }

  /**
   * Estimates memory footprint of an entry in bytes strictly as length * 2 per string.
   * In JavaScript engines (V8 / JavaScriptCore), UTF-16 strings take 2 bytes per char.
   */
  private estimateSize(content: string, preview?: string): number {
    const contentBytes = (content?.length || 0) * 2;
    const previewBytes = (preview?.length || 0) * 2;
    return contentBytes + previewBytes;
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
    baseUpdatedAt?: number | string,
    preview?: string,
    scrollTop = 0,
    unsaved = false
  ): void {
    const baseUpdatedStr =
      typeof baseUpdatedAt === "string"
        ? baseUpdatedAt
        : typeof baseUpdatedAt === "number"
        ? new Date(baseUpdatedAt).toISOString()
        : new Date().toISOString();

    const ts =
      typeof baseUpdatedAt === "string"
        ? new Date(baseUpdatedAt).getTime()
        : baseUpdatedAt || Date.now();

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
      baseUpdatedAt: baseUpdatedStr,
      unsaved,
      updatedAt: ts,
      preview,
      title: preview,
      scrollTop: existing ? (scrollTop || existing.scrollTop) : scrollTop,
      byteSize,
    };

    this.cache.set(id, entry);
    this.currentTotalBytes += byteSize;

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
   * Updates note content and marks note as having unsaved local changes.
   * Preserves original `baseUpdatedAt` so reconciliation on reboot can detect if DB moved on.
   */
  updateContent(id: string, content: string, preview?: string): void {
    const entry = this.cache.get(id);
    const newByteSize = this.estimateSize(content, preview);
    const oldByteSize = entry ? entry.byteSize : 0;
    const currentScroll = entry ? entry.scrollTop : 0;
    const baseUpdatedAt = entry ? entry.baseUpdatedAt : new Date().toISOString();

    this.currentTotalBytes = this.currentTotalBytes - oldByteSize + newByteSize;

    if (entry) {
      this.cache.delete(id);
    }

    this.cache.set(id, {
      id,
      content,
      baseUpdatedAt,
      unsaved: true,
      updatedAt: Date.now(),
      preview: preview !== undefined ? preview : entry?.preview,
      title: preview !== undefined ? preview : entry?.title,
      scrollTop: currentScroll,
      byteSize: newByteSize,
    });

    this.evictToBudget(id);
  }

  /**
   * Sets the authoritative baseUpdatedAt timestamp for a cached note (e.g., after successful SQLite save).
   * Optionally updates the unsaved flag (defaults to false if omitted).
   */
  setBaseUpdatedAt(id: string, baseUpdatedAt: string, unsaved = false): void {
    const entry = this.cache.get(id);
    if (entry) {
      entry.baseUpdatedAt = baseUpdatedAt;
      entry.unsaved = unsaved;
      entry.updatedAt = new Date(baseUpdatedAt).getTime();
    }
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
   * Evicts oldest entries (beginning of Map iterator) until both byte budget (8 MB)
   * and entry count constraints are satisfied.
   *
   * Invariant: The Most Recently Used (MRU) entry is NEVER evicted, even if its single size
   * exceeds the cache byte budget.
   */
  private evictToBudget(activeMruId?: string): void {
    // Identify the MRU entry (either explicit activeMruId or the last key in insertion order)
    let mruKey = activeMruId;
    if (!mruKey && this.cache.size > 0) {
      for (const k of this.cache.keys()) {
        mruKey = k;
      }
    }

    while (
      (this.cache.size > this.maxEntries || this.currentTotalBytes > this.maxBytes) &&
      this.cache.size > 1
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;

      // Never evict the MRU entry
      if (oldestKey === mruKey) {
        break;
      }

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

/**
 * Reconciles an active note snapshot (from in-memory cache or localStorage hydration)
 * against the authoritative row fetched from SQLite on application boot.
 *
 * Strict Rules:
 * 1. Never compare client and server clocks (avoids clock skew / NTP drift).
 * 2. If snapshot has unsaved local edits (`unsaved: true`):
 *    Because rayNote is single-instance with zero external database writers (no multi-instance,
 *    no background sync daemon, no restore daemon), any snapshot marked unsaved represents
 *    uncommitted user edits that are strictly newer than any in-flight DB write that may have
 *    advanced fullNote.updated_at. An unsaved snapshot must always win and be marked dirty
 *    (`keep_snapshot_and_mark_dirty`), never silently dropped.
 * 3. If snapshot is marked clean (`unsaved: false`):
 *    - Case 1: If updated_at == baseUpdatedAt and fullNote.content === cached.content:
 *      Snapshot matches SQLite perfectly -> `noop`, clean.
 *    - Case 1b: If updated_at == baseUpdatedAt but fullNote.content !== cached.content:
 *      Authoritative SQLite database content wins -> `apply_db`, clean.
 *    - Case 1c: If updated_at != baseUpdatedAt:
 *      SQLite moved on while snapshot was clean -> `apply_db`, clean.
 */
export function reconcileSnapshotWithDb(
  cached: { content: string; baseUpdatedAt: string; unsaved: boolean },
  fullNote: { content: string; updated_at: string } | null | undefined
): {
  action: "recover_orphan_as_new" | "keep_snapshot_and_mark_dirty" | "apply_db" | "noop" | "evict_orphan";
  content: string;
  isDirty: boolean;
} {
  // If the note row no longer exists in SQLite (deleted or non-existent in DB)
  if (!fullNote) {
    if (cached.unsaved) {
      // User has uncommitted text, but the note row does not exist in SQLite.
      // Do NOT mark dirty to avoid saving to a dead ID (which returns QueryReturnedNoRows error).
      // Instead, trigger creation of a new note with this content.
      return {
        action: "recover_orphan_as_new",
        content: cached.content,
        isDirty: false,
      };
    } else {
      // Snapshot was clean; note was permanently removed from DB; evict orphaned snapshot
      return {
        action: "evict_orphan",
        content: "",
        isDirty: false,
      };
    }
  }

  if (cached.unsaved) {
    return {
      action: "keep_snapshot_and_mark_dirty",
      content: cached.content,
      isDirty: true,
    };
  }

  if (fullNote.updated_at !== cached.baseUpdatedAt || fullNote.content !== cached.content) {
    return {
      action: "apply_db",
      content: fullNote.content,
      isDirty: false,
    };
  }

  return {
    action: "noop",
    content: cached.content,
    isDirty: false,
  };
}
