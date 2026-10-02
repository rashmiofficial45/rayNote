use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String, // JSON from Tiptap
    pub created_at: String,
    pub updated_at: String,
    pub is_pinned: bool,
}

pub struct Database {
    pub conn: Mutex<Connection>,
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
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(is_pinned DESC, updated_at DESC);
            "
        )?;

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn get_all_notes(&self) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, content, created_at, updated_at, is_pinned
             FROM notes
             ORDER BY is_pinned DESC, updated_at DESC"
        )?;

        let notes = stmt.query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                is_pinned: row.get::<_, i32>(5)? != 0,
            })
        })?.collect::<Result<Vec<_>>>()?;

        Ok(notes)
    }

    pub fn get_note(&self, id: &str) -> Result<Option<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, content, created_at, updated_at, is_pinned
             FROM notes WHERE id = ?1"
        )?;

        let mut notes = stmt.query_map(params![id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                is_pinned: row.get::<_, i32>(5)? != 0,
            })
        })?;

        match notes.next() {
            Some(note) => Ok(Some(note?)),
            None => Ok(None),
        }
    }

    pub fn create_note(&self, note: &Note) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO notes (id, title, content, created_at, updated_at, is_pinned)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                note.id,
                note.title,
                note.content,
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
        conn.execute(
            "UPDATE notes SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, content, now, id],
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
