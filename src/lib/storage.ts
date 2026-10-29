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
  if (typeof window === "undefined" || !window.localStorage) return false;
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
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageRemoveItem(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
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
    try {
      const res = writerFn();
      if (res && typeof (res as any).then === "function") {
        return (res as Promise<void>).finally(() => {
          isExecuting = false;
          if (retriggerPending) {
            retriggerPending = false;
            schedule();
          }
        });
      }
    } finally {
      isExecuting = false;
      if (retriggerPending) {
        retriggerPending = false;
        schedule();
      }
    }
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
