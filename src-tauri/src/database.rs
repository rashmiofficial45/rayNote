use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_pinned: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String, // Full JSON or Markdown from Tiptap
    pub preview: String, // Lightweight plain text preview
    pub created_at: String,
    pub updated_at: String,
    pub is_pinned: bool,
}

pub struct Database {
    pub conn: Mutex<Connection>,
}

pub fn extract_preview(content: &str, max_chars: usize) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let mut extracted = String::new();
            extract_text_from_tiptap_json(&value, &mut extracted, max_chars);
            let cleaned = extracted.split_whitespace().collect::<Vec<_>>().join(" ");
            if !cleaned.is_empty() {
                return truncate_preview(&cleaned, max_chars);
            }
        }
    }

    let plain = strip_markdown_and_html(trimmed);
    truncate_preview(&plain, max_chars)
}

fn extract_text_from_tiptap_json(node: &serde_json::Value, out: &mut String, max_chars: usize) {
    if out.chars().count() >= max_chars {
        return;
    }
    if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(text);
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children {
            extract_text_from_tiptap_json(child, out, max_chars);
            if out.chars().count() >= max_chars {
                break;
            }
        }
    }
}

fn strip_markdown_and_html(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        if c == '<' {
            in_tag = true;
            continue;
        }
        if c == '>' {
            in_tag = false;
            continue;
        }
        if !in_tag {
            if c != '#' && c != '*' && c != '_' && c != '`' && c != '~' && c != '>' {
                result.push(c);
            }
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_preview(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}…", truncated.trim_end())
    } else {
        truncated
    }
}

impl Database {
    pub fn new(app_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&app_dir).ok();
        let db_path = app_dir.join("raynote.db");

        // Seamless migration: copy notes from legacy notefast.db if raynote.db doesn't exist yet
        if !db_path.exists() {
            let local_legacy = app_dir.join("notefast.db");
            if local_legacy.exists() {
                let _ = std::fs::copy(&local_legacy, &db_path);
            } else if let Some(parent) = app_dir.parent() {
                let old_app_dir = parent.join("com.notefast.app");
                let old_db = old_app_dir.join("notefast.db");
                if old_db.exists() {
                    let _ = std::fs::copy(&old_db, &db_path);
                }
            }
        }

        let conn = Connection::open(&db_path)?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -1000;
             PRAGMA temp_store = MEMORY;
             PRAGMA mmap_size = 0;

             CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                preview TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(is_pinned DESC, updated_at DESC);
            "
        )?;

        // Ensure preview column exists on existing schemas
        let _ = conn.execute("ALTER TABLE notes ADD COLUMN preview TEXT NOT NULL DEFAULT ''", []);

        // Backfill any empty previews for existing notes
        if let Ok(mut stmt) = conn.prepare("SELECT id, content FROM notes WHERE (preview = '' OR preview IS NULL) AND content != ''") {
            let to_update: Vec<(String, String)> = stmt.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .and_then(|mapped| mapped.collect::<Result<Vec<_>, _>>())
            .unwrap_or_default();

            for (id, content) in to_update {
                let prev = extract_preview(&content, 120);
                let _ = conn.execute("UPDATE notes SET preview = ?1 WHERE id = ?2", params![prev, id]);
            }
        }

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    /// Optimized: Returns lightweight note summaries WITHOUT full document content
    pub fn get_all_notes(&self) -> Result<Vec<NoteSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, preview, created_at, updated_at, is_pinned
             FROM notes
             ORDER BY is_pinned DESC, updated_at DESC"
        )?;

        let notes = stmt.query_map([], |row| {
            Ok(NoteSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                preview: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                is_pinned: row.get::<_, i32>(5)? != 0,
            })
        })?.collect::<Result<Vec<_>>>()?;

        Ok(notes)
    }

    /// Fetches all notes with full content (used strictly for bulk export)
    pub fn get_all_notes_with_content(&self) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, content, preview, created_at, updated_at, is_pinned
             FROM notes
             ORDER BY is_pinned DESC, updated_at DESC"
        )?;

        let notes = stmt.query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                preview: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                is_pinned: row.get::<_, i32>(6)? != 0,
            })
        })?.collect::<Result<Vec<_>>>()?;

        Ok(notes)
    }

    /// Fetches ONE note's full content on demand when selected by user
    pub fn get_note(&self, id: &str) -> Result<Option<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, content, preview, created_at, updated_at, is_pinned
             FROM notes WHERE id = ?1"
        )?;

        let mut notes = stmt.query_map(params![id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                preview: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                is_pinned: row.get::<_, i32>(6)? != 0,
            })
        })?;

        match notes.next() {
            Some(note) => Ok(Some(note?)),
            None => Ok(None),
        }
    }

    pub fn create_note(&self, note: &Note) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let preview = if note.preview.is_empty() {
            extract_preview(&note.content, 120)
        } else {
            note.preview.clone()
        };
        conn.execute(
            "INSERT INTO notes (id, title, content, preview, created_at, updated_at, is_pinned)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                note.id,
                note.title,
                note.content,
                preview,
                note.created_at,
                note.updated_at,
                note.is_pinned as i32,
            ],
        )?;
        Ok(())
    }

    pub fn update_note(&self, id: &str, title: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let preview = extract_preview(content, 120);
        conn.execute(
            "UPDATE notes SET title = ?1, content = ?2, preview = ?3, updated_at = ?4 WHERE id = ?5",
            params![title, content, preview, now, id],
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn toggle_pin(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE notes SET is_pinned = CASE WHEN is_pinned = 0 THEN 1 ELSE 0 END WHERE id = ?1",
            params![id],
        )?;

        let pinned: i32 = conn.query_row(
            "SELECT is_pinned FROM notes WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        Ok(pinned != 0)
    }
}
