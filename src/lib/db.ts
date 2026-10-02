import { invoke } from "@tauri-apps/api/core";

export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
}

export interface Note extends NoteSummary {
  content: string;
}

export async function getAllNotes(): Promise<NoteSummary[]> {
  return invoke<NoteSummary[]>("get_all_notes");
}

export async function searchNotes(query: string): Promise<NoteSummary[]> {
  return invoke<NoteSummary[]>("search_notes", { query });
}

export async function getNote(id: string): Promise<Note | null> {
  return invoke<Note | null>("get_note", { id });
}

export async function exportAllNotesFromDb(): Promise<string> {
  return invoke<string>("export_all_notes_from_db");
}

export async function createNote(): Promise<Note> {
  return invoke<Note>("create_note");
}

export async function updateNote(
  id: string,
  title: string,
  content: string
): Promise<void> {
  return invoke("update_note", { id, title, content });
}

export async function deleteNote(id: string): Promise<void> {
  return invoke("delete_note", { id });
}

export async function togglePin(id: string): Promise<boolean> {
  return invoke<boolean>("toggle_pin", { id });
}

export async function saveWindowSize(width: number, height: number): Promise<void> {
  return invoke("save_window_size", { width, height });
}

export async function hideWindow(): Promise<void> {
  return invoke("hide_window");
}

export async function quitApp(): Promise<void> {
  return invoke("quit_app");
}

export async function openSettingsWindow(): Promise<void> {
  return invoke("open_settings_window");
}

export async function closeSettingsWindow(): Promise<void> {
  return invoke("close_settings_window");
}

export async function openAppDataFolder(): Promise<void> {
  return invoke("open_app_data_folder");
}

export interface StorageStats {
  notes_count: number;
  db_path: string;
  size_bytes: number;
}

export async function getStorageStats(): Promise<StorageStats> {
  return invoke<StorageStats>("get_storage_stats");
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  return invoke("set_always_on_top", { alwaysOnTop, always_on_top: alwaysOnTop });
}


