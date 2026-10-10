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
 * Fetches all note summaries from SQLite, sorted by pinned status first,
 * then descending by updated timestamp.
 */
export async function getAllNotes(): Promise<NoteSummary[]> {
  return invoke<NoteSummary[]>("get_all_notes");
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
export async function searchDocuments(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_documents", { query });
}

/**
 * Queries the SQLite FTS5 (Full-Text Search) index to find matching notes by keyword.
 */
export async function searchNotes(query: string): Promise<NoteSummary[]> {
  return invoke<NoteSummary[]>("search_notes", { query });
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

/**
 * Persists updated title and content for a note into SQLite, updating the `updated_at` timestamp.
 */
export async function updateNote(
  id: string,
  title: string,
  content: string
): Promise<void> {
  return invoke("update_note", { id, title, content });
}

/**
 * Permanently removes a note and its corresponding full-text search index from SQLite.
 */
export async function deleteNote(id: string): Promise<void> {
  return invoke("delete_note", { id });
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



