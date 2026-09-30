import { invoke } from "@tauri-apps/api/core";

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
}

export async function getAllNotes(): Promise<Note[]> {
  return invoke<Note[]>("get_all_notes");
}

export async function getNote(id: string): Promise<Note | null> {
  return invoke<Note | null>("get_note", { id });
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
