/**
 * Safe LocalStorage & Write-Coalescing Utility (src/lib/storage.ts)
 *
 * Architecture:
 * - Quota Safety: Wraps all localStorage writes in try-catch blocks to prevent uncaught QuotaExceededErrors.
 * - Eviction Fallback: When quota errors occur, evicts large note cache content first.
 * - Write Coalescing: Debounces / batches rapid back-to-back lifecycle events (blur, visibilitychange,
 *   panel-will-hide) into a single atomic write, eliminating duplicate disk and IPC operations.
 */

export const STORAGE_KEYS = {
  ACTIVE_NOTE_ID: "notefast_active_note_id",
  CACHED_NOTES: "notefast_cached_notes",
  ACTIVE_NOTE_CONTENT: "notefast_active_note_content",
  ZOOM_LEVEL: "notefast_zoom_level",
  ESC_LOSES_FOCUS: "notefast_esc_loses_focus",
  ALWAYS_ON_TOP: "notefast_always_on_top",
  SHOW_MENUBAR: "notefast_show_menubar",
  SMOOTH_CARET: "notefast_smooth_caret",
  THEME_MODE: "notefast_theme_mode",
  ACCENT_COLOR: "notefast_accent_color",
  FONT: "notefast_font",
  SETTINGS_PANE: "notefast_settings_active_pane",
  COMMANDS_CONFIG: "notefast_commands_config",
  ALIASES: "raynote_custom_aliases",
} as const;

export function isProtectedRecoveryKey(key: string): boolean {
  return (
    key.startsWith("notefast_active_note") ||
    key.startsWith("notefast_recovered_note_id")
  );
}

export function safeLocalStorageSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err: any) {
    console.warn(`[storage] LocalStorage write failed for key "${key}":`, err?.name || err);
    // On QuotaExceededError, evict non-essential cached note summaries to free space.
    // CRITICAL: NEVER evict active note recovery keys (notefast_active_note_*) or recovered note pointers (notefast_recovered_note_id).
    if (key !== STORAGE_KEYS.CACHED_NOTES) {
      try {
        localStorage.removeItem(STORAGE_KEYS.CACHED_NOTES);
        localStorage.setItem(key, value);
        return true;
      } catch {
        // Still exceeds quota or storage disabled; fail safely without throwing
      }
    }
    return false;
  }
}

export function safeLocalStorageGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageRemoveItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

/**
 * Creates a coalesced executor that batches rapid multiple invocations into a single scheduled execution.
 *
 * NOTE: The 16 ms coalescing window is governed by a timer (`setTimeout`), not a microtask.
 * Calling `flush()` executes the writer immediately (synchronously if `writerFn` is synchronous)
 * and cancels any pending timer.
 */
export function createCoalescedWriter(
  writerFn: () => void | Promise<void>,
  delayMs = 16
) {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let isExecuting = false;
  let retriggerPending = false;

  const flush = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (isExecuting) {
      retriggerPending = true;
      return;
    }
    isExecuting = true;
    const complete = () => {
      isExecuting = false;
      if (retriggerPending) {
        retriggerPending = false;
        schedule();
      }
    };
    try {
      const res = writerFn();
      if (res && typeof res.then === "function") {
        return res.finally(complete);
      }
    } catch (error) {
      complete();
      throw error;
    }
    complete();
  };

  const schedule = () => {
    if (timerId !== null) return; // Already queued for this tick
    timerId = setTimeout(() => {
      timerId = null;
      flush();
    }, delayMs);
  };

  return {
    schedule,
    flush,
    cancel: () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      retriggerPending = false;
    },
  };
}

export interface ActiveNoteSnapshot {
  id: string;
  content: string;
  baseUpdatedAt: string;
  unsaved: boolean;
}

const ACTIVE_SNAPSHOT_KEY = "notefast_active_note_snapshot";

/** One atomic record owns recovery; legacy keys remain mirrors for compatibility. */
export function readActiveNoteSnapshot(): ActiveNoteSnapshot | null {
  const atomic = safeLocalStorageGetItem(ACTIVE_SNAPSHOT_KEY);
  if (atomic !== null) {
    try {
      const record = JSON.parse(atomic);
      if (record && typeof record.id === "string" && record.id &&
          typeof record.content === "string" && typeof record.baseUpdatedAt === "string" &&
          typeof record.unsaved === "boolean") return record;
    } catch {}
    return null;
  }
  const id = safeLocalStorageGetItem(STORAGE_KEYS.ACTIVE_NOTE_ID);
  const content = safeLocalStorageGetItem(STORAGE_KEYS.ACTIVE_NOTE_CONTENT);
  if (!id || content === null) return null;
  return {
    id, content,
    baseUpdatedAt: safeLocalStorageGetItem("notefast_active_note_base_updated_at") || "",
    unsaved: safeLocalStorageGetItem("notefast_active_note_unsaved") === "true",
  };
}

export function writeActiveNoteSnapshot(snapshot: ActiveNoteSnapshot): boolean {
  if (!safeLocalStorageSetItem(ACTIVE_SNAPSHOT_KEY, JSON.stringify(snapshot))) return false;
  safeLocalStorageSetItem(STORAGE_KEYS.ACTIVE_NOTE_ID, snapshot.id);
  safeLocalStorageSetItem(STORAGE_KEYS.ACTIVE_NOTE_CONTENT, snapshot.content);
  safeLocalStorageSetItem("notefast_active_note_base_updated_at", snapshot.baseUpdatedAt);
  safeLocalStorageSetItem("notefast_active_note_unsaved", String(snapshot.unsaved));
  return true;
}

export function clearActiveNoteSnapshot(id?: string): void {
  if (!id || readActiveNoteSnapshot()?.id === id) {
    // A tombstone prevents partial legacy cleanup from being read as a snapshot.
    // It is replaced atomically by the next complete snapshot.
    safeLocalStorageSetItem(ACTIVE_SNAPSHOT_KEY, "null");
  }
  if (!id || safeLocalStorageGetItem(STORAGE_KEYS.ACTIVE_NOTE_ID) === id) {
    safeLocalStorageRemoveItem(STORAGE_KEYS.ACTIVE_NOTE_ID);
    safeLocalStorageRemoveItem(STORAGE_KEYS.ACTIVE_NOTE_CONTENT);
    safeLocalStorageRemoveItem("notefast_active_note_base_updated_at");
    safeLocalStorageRemoveItem("notefast_active_note_unsaved");
  }
}
