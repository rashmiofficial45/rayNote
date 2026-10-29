/**
 * NoteFast Tauri IPC Database Client (db.ts)
 *
 * Bridges the React frontend with the native Rust backend:
 * - Direct Tauri IPC: Invokes commands registered in `src-tauri/src/commands.rs`.
 * - Local SQLite Persistence: Notes, metadata, window sizes, and pin states are saved
 *   into an embedded SQLite database (`notefast.db`) located in the macOS Application Support directory.
 * - Full-Text Search (FTS): Supports high-performance searching across note titles and content.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Lightweight note summary representation used for drawer listing,
 * fuzzy searching, and memory caching.
 */
export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
}

/**
 * Full note document including the complete TipTap JSON/HTML or Markdown content payload.
 */
export interface Note extends NoteSummary {
  content: string;
}

/**
 * Fetches recent note summaries from SQLite/cache (default limit 30), sorted by pinned status first,
 * then descending by updated timestamp.
 */
export async function getRecentNotes(limit: number = 30): Promise<NoteSummary[]> {
  const res = await invoke<NoteSummary[]>("get_all_notes", { limit });
  return res || [];
}

export async function getAllNotes(limit?: number): Promise<NoteSummary[]> {
  const res = await invoke<NoteSummary[]>("get_all_notes", { limit });
  return res || [];
}

/**
 * Relevance-ranked search result item returned by ⌘P Smart Search.
 */
export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  match_type: "exact_title" | "title_prefix" | "title_substring" | "title_words" | "fuzzy_title" | "content" | "recent" | string;
  updated_at: string;
  is_pinned: boolean;
}

/**
 * Executes high-performance relevance-ranked search across titles and extracted document content.
 */
export async function searchDocuments(query: string, limit?: number): Promise<SearchResult[]> {
  const res = await invoke<SearchResult[]>("search_documents", { query, limit });
  return res || [];
}

/**
 * Fetches recent notes formatted as SearchResults directly from metadata cache for empty search queries without full-table scan.
 */
export async function getRecentSearchResults(limit: number = 30): Promise<SearchResult[]> {
  const res = await invoke<SearchResult[]>("get_recent_notes", { limit });
  return res || [];
}

/**
 * Keyset navigation for Option+Up / Option+Down across all notes in (is_pinned DESC, updated_at DESC, id DESC) order.
 */
export async function getAdjacentNote(id: string, direction: "prev" | "next"): Promise<string | null> {
  return invoke<string | null>("get_adjacent_note", { id, direction });
}

/**
 * Loads a single complete note by its UUID. Returns `null` if the note does not exist.
 */
export async function getNote(id: string): Promise<Note | null> {
  return invoke<Note | null>("get_note", { id });
}

/**
 * Batch exports all notes from SQLite into individual Markdown files
 * inside a user-selected folder via native macOS file dialog.
 */
export async function exportAllNotesFromDb(): Promise<string> {
  return invoke<string>("export_all_notes_from_db");
}

/**
 * Inserts a brand new blank note document into SQLite with default paragraph content.
 */
export async function createNote(): Promise<Note> {
  return invoke<Note>("create_note");
}

let saveQueue: Promise<unknown> = Promise.resolve();
let activeEditorFlush: (() => Promise<void> | void) | null = null;

/**
 * Registers an active editor debounce flush callback.
 */
export function registerEditorFlush(flushFn: (() => Promise<void> | void) | null): void {
  activeEditorFlush = flushFn;
}

/**
 * Awaits commit of active editor uncommitted changes and any in-flight follow-up saves into saveQueue.
 */
export async function flushEditorNow(): Promise<void> {
  if (activeEditorFlush) {
    try {
      await activeEditorFlush();
    } catch (e) {
      console.error("Error flushing editor debounce:", e);
    }
  }
}

/**
 * Persists updated title and content for a note into SQLite, updating the `updated_at` timestamp.
 * Sequenced through a FIFO promise chain to ensure saves of the same note always reach SQLite
 * in strictly chronological order. Failure of a previous save never blocks subsequent saves.
 */
export function updateNote(
  id: string,
  title: string,
  content: string
): Promise<string> {
  const task = saveQueue
    .catch(() => {})
    .then(() => invoke<string>("update_note", { id, title, content }));
  saveQueue = task.catch(() => {});
  return task;
}

/**
 * Waits for all in-flight and queued saves in saveQueue to complete.
 */
export async function flushSaveQueue(): Promise<void> {
  await saveQueue;
}

/**
 * Notifies the native backend that pending frontend saves have flushed completely before app exit.
 */
export async function flushDone(): Promise<void> {
  return invoke("flush_done");
}

/**
 * Registers an event listener for "panel-will-hide" from Rust.
 * Flushes active editor debounce, title timer, and drains saveQueue.
 */
export function registerPanelHideHandler(onHideCallback?: () => void): Promise<UnlistenFn> | undefined {
  try {
    return listen("panel-will-hide", async () => {
      // 1. Kick off editor flush callback synchronously
      let flushPromise: Promise<void> | void = undefined;
      if (activeEditorFlush) {
        try {
          flushPromise = activeEditorFlush();
        } catch (e) {
          console.error("Error calling activeEditorFlush:", e);
        }
      }
      // 2. Synchronously commit pending title timer or custom onHide logic into saveQueue
      if (onHideCallback) {
        try {
          onHideCallback();
        } catch (e) {
          console.error("Error in onHideCallback on panel-will-hide:", e);
        }
      }
      // 3. Await active editor flush promise chain
      if (flushPromise && typeof (flushPromise as any).then === "function") {
        try {
          await flushPromise;
        } catch {}
      }
      // 4. Await all in-flight and queued saves
      await flushSaveQueue();
      // 5. Run passive WAL checkpoint after frontend flush drains
      try {
        await invoke("checkpoint_passive");
      } catch {}
    });
  } catch {
    return undefined;
  }
}

/**
 * Registers an event listener for "app-will-exit" from Rust.
 * Flushes active editor debounce, title timer, drains saveQueue, and notifies Rust via flush_done.
 */
export function registerExitFlushHandler(flushPendingCallback?: () => void): Promise<UnlistenFn> | undefined {
  try {
    return listen("app-will-exit", async () => {
      // 1. Kick off editor flush callback synchronously
      let flushPromise: Promise<void> | void = undefined;
      if (activeEditorFlush) {
        try {
          flushPromise = activeEditorFlush();
        } catch (e) {
          console.error("Error calling activeEditorFlush on app-will-exit:", e);
        }
      }
      // 2. Synchronously commit pending title timer into saveQueue
      if (flushPendingCallback) {
        try {
          flushPendingCallback();
        } catch (e) {
          console.error("Error in flushPendingCallback on app-will-exit:", e);
        }
      }
      // 3. Await active editor flush promise chain
      if (flushPromise && typeof (flushPromise as any).then === "function") {
        try {
          await flushPromise;
        } catch {}
      }
      // 4. Await complete drain of saveQueue
      await flushSaveQueue();
      // 5. Signal native backend
      try {
        await flushDone();
      } catch (e) {
        console.error("Error calling flush_done:", e);
      }
    });
  } catch {
    return undefined;
  }
}

/**
 * Permanently removes a note and its corresponding full-text search index from SQLite.
 * Clears active note snapshot from localStorage when deleted ID matches the cached snapshot.
 */
export async function deleteNote(id: string): Promise<void> {
  const result = await invoke<void>("delete_note", { id });
  try {
    if (typeof localStorage !== "undefined") {
      if (localStorage.getItem("notefast_active_note_id") === id) {
        localStorage.removeItem("notefast_active_note_id");
        localStorage.removeItem("notefast_active_note_content");
        localStorage.removeItem("notefast_active_note_base_updated_at");
        localStorage.removeItem("notefast_active_note_unsaved");
      }
      const cached = localStorage.getItem("notefast_cached_notes");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter((n: any) => n.id !== id);
            localStorage.setItem("notefast_cached_notes", JSON.stringify(filtered));
          }
        } catch {}
      }
    }
  } catch {}
  return result;
}

/**
 * Toggles the `is_pinned` boolean flag for a note in SQLite.
 * Returns the updated boolean state.
 */
export async function togglePin(id: string): Promise<boolean> {
  return invoke<boolean>("toggle_pin", { id });
}

/**
 * Saves current window dimensions (width & height) to app configuration
 * so dimensions persist across app restarts.
 */
export async function saveWindowSize(width: number, height: number): Promise<void> {
  return invoke("save_window_size", { width, height });
}

/**
 * Hides the NoteFast window (macOS NSPanel orderOut) without terminating the background process.
 */
export async function hideWindow(): Promise<void> {
  return invoke("hide_window");
}

/**
 * Completely quits the NoteFast application process.
 */
export async function quitApp(): Promise<void> {
  return invoke("quit_app");
}

/**
 * Spawns or focuses the dedicated secondary Settings window (`SettingsApp.tsx`).
 */
export async function openSettingsWindow(): Promise<void> {
  return invoke("open_settings_window");
}

/**
 * Closes the secondary Settings window.
 */
export async function closeSettingsWindow(): Promise<void> {
  return invoke("close_settings_window");
}

/**
 * Reveals the NoteFast Application Support data directory in macOS Finder.
 */
export async function openAppDataFolder(): Promise<void> {
  return invoke("open_app_data_folder");
}

/**
 * Diagnostic database storage statistics.
 */
export interface StorageStats {
  notes_count: number;
  db_path: string;
  size_bytes: number;
}

/**
 * Retrieves database diagnostics including total note count, disk file path, and database file size.
 */
export async function getStorageStats(): Promise<StorageStats> {
  return invoke<StorageStats>("get_storage_stats");
}

/**
 * Sets whether the NoteFast window should float above all other windows on macOS.
 */
export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  return invoke("set_always_on_top", { alwaysOnTop, always_on_top: alwaysOnTop });
}



