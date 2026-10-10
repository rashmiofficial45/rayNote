//! NoteFast SQLite Persistence Layer (database.rs)
//!
//! Architectural highlights:
//! - Embedded SQLite Connection: Manages local file-based database (`raynote.db`) with WAL
//!   (Write-Ahead Logging) and MEMORY temp_store for zero-latency concurrent read/write operations.
//! - Automatic Schema Migrations: Automatically upgrades schema across versions (e.g. adding
//!   preview columns, copying data from legacy `notefast.db` installations).
//! - SQLite FTS5 Full-Text Search: Automatically indexes titles, previews, and contents via
//!   SQL triggers (`notes_fts_ai`, `notes_fts_ad`, `notes_fts_au`) for rapid keyword matching.
//! - Lightweight Summaries vs On-Demand Full Notes: Prevents unnecessary memory overhead by
//!   retrieving only lightweight metadata (`NoteSummary`) during listing, loading full document
//!   JSON/Markdown payloads strictly on demand when a note is opened.

use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::path::PathBuf;
use crate::search::{DocumentCandidate, SearchResult, generate_contextual_snippet, score_document};

/// Lightweight note summary row structure returned for lists and searches.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_pinned: bool,
}

/// Full note document containing the complete TipTap JSON/HTML or Markdown content payload.
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

/// Thread-safe database wrapper wrapping an SQLite connection in a Mutex,
/// with an in-memory metadata cache for sub-millisecond search and switcher performance.
pub struct Database {
    pub conn: Mutex<Connection>,
    meta_cache: Mutex<Option<Vec<NoteSummary>>>,
}

/// Recursively extracts clean human-readable plain text from note content:
/// - Walks TipTap/ProseMirror JSON nodes (headings, paragraphs, lists, tasks, blockquotes, code blocks, tables)
/// - Strips Markdown markers and HTML tags without concatenating adjacent blocks
/// - Eliminates all JSON formatting keys and markup tokens
pub fn extract_searchable_text(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let mut extracted = String::new();
            extract_text_recursive(&value, &mut extracted);
            let cleaned = extracted.split_whitespace().collect::<Vec<_>>().join(" ");
            if !cleaned.is_empty() {
                return cleaned;
            }
        }
    }

    strip_markdown_and_html(trimmed)
}

fn extract_text_recursive(node: &serde_json::Value, out: &mut String) {
    if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
        if !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
        out.push_str(text);
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children {
            extract_text_recursive(child, out);
        }
        if !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
    }
}

/// Extracts a plain-text preview snippet from note content.
#[allow(dead_code)]
pub fn extract_preview(content: &str, max_chars: usize) -> String {
    let plain = extract_searchable_text(content);
    truncate_preview(&plain, max_chars)
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
            if !result.ends_with(' ') && !result.is_empty() {
                result.push(' ');
            }
            continue;
        }
        if !in_tag {
            if c != '#' && c != '*' && c != '_' && c != '`' && c != '~' && c != '>' && c != '|' {
                result.push(c);
            } else if !result.ends_with(' ') && !result.is_empty() {
                result.push(' ');
            }
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn truncate_preview(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}…", truncated.trim_end())
    } else {
        truncated
    }
}

/// Sanitizes a search string into an SQLite FTS5 prefix match expression.
/// Strips punctuation and characters.
/// Only tokens with >= 3 alphanumeric characters receive prefix wildcard '*' for typeahead search.
/// Tokens with < 3 characters are matched as exact words to prevent massive index expansions.
pub fn sanitize_fts5_query(query: &str) -> String {
    let mut tokens = Vec::new();
    for word in query.split_whitespace() {
        let cleaned: String = word
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if !cleaned.is_empty() {
            if cleaned.chars().count() >= 3 {
                tokens.push(format!("\"{}\"*", cleaned));
            } else {
                tokens.push(format!("\"{}\"", cleaned));
            }
        }
    }
    tokens.join(" ")
}

impl Database {
    /// Opens connection to `raynote.db`, applies PRAGMA optimizations (WAL, cache, memory store),
    /// executes schema migrations, sets up FTS5 tables with automated sync triggers,
    /// and backfills previews and search indices.
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

        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        let _ = conn.pragma_update(None, "cache_size", -1000);
        let _ = conn.pragma_update(None, "temp_store", "MEMORY");
        let _ = conn.pragma_update(None, "mmap_size", 0);

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
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

            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                id UNINDEXED,
                title,
                content,
                preview,
                tokenize='unicode61'
            );
            "
        )?;

        // Ensure preview and search_text columns exist on existing schemas
        let _ = conn.execute("ALTER TABLE notes ADD COLUMN preview TEXT NOT NULL DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE notes ADD COLUMN search_text TEXT NOT NULL DEFAULT ''", []);

        // Backfill any empty previews or search_text for existing notes
        if let Ok(mut stmt) = conn.prepare("SELECT id, content FROM notes WHERE (search_text = '' OR search_text IS NULL OR preview = '' OR preview IS NULL) AND content != ''") {
            let to_update: Vec<(String, String)> = stmt.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .and_then(|mapped| mapped.collect::<Result<Vec<_>, _>>())
            .unwrap_or_default();

            for (id, content) in to_update {
                let st = extract_searchable_text(&content);
                let prev = truncate_preview(&st, 120);
                let _ = conn.execute("UPDATE notes SET search_text = ?1, preview = ?2 WHERE id = ?3", params![st, prev, id]);
            }
        }

        // Configure automated FTS triggers using search_text instead of raw JSON markup
        let _ = conn.execute_batch(
            "DROP TRIGGER IF EXISTS notes_fts_ai;
             DROP TRIGGER IF EXISTS notes_fts_ad;
             DROP TRIGGER IF EXISTS notes_fts_au;

             CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
                 INSERT INTO notes_fts(id, title, content, preview)
                 VALUES (new.id, new.title, new.search_text, new.preview);
             END;

             CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
                 DELETE FROM notes_fts WHERE id = old.id;
             END;

             CREATE TRIGGER notes_fts_au AFTER UPDATE ON notes BEGIN
                 DELETE FROM notes_fts WHERE id = old.id;
                 INSERT INTO notes_fts(id, title, content, preview)
                 VALUES (new.id, new.title, new.search_text, new.preview);
             END;"
        );

        // Synchronize and refresh notes_fts with clean plain text
        let _ = conn.execute("DELETE FROM notes_fts", []);
        let _ = conn.execute(
            "INSERT INTO notes_fts(id, title, content, preview)
             SELECT id, title, search_text, preview FROM notes",
            [],
        );

        Ok(Database {
            conn: Mutex::new(conn),
            meta_cache: Mutex::new(None),
        })
    }

    /// Invalidates in-memory metadata cache when notes are modified.
    pub fn invalidate_cache(&self) {
        if let Ok(mut lock) = self.meta_cache.lock() {
            *lock = None;
        }
    }

    /// Searches notes across title, preview, and full content using SQLite FTS5
    pub fn search_notes(&self, query: &str) -> Result<Vec<NoteSummary>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.get_all_notes();
        }

        // Fast path for short queries (1-2 chars): instant in-memory title and preview match (< 0.1ms)
        if trimmed.chars().count() < 3 {
            let q_lower = trimmed.to_lowercase();
            let all = self.get_all_notes()?;
            let filtered: Vec<NoteSummary> = all
                .into_iter()
                .filter(|n| n.title.to_lowercase().contains(&q_lower) || n.preview.to_lowercase().contains(&q_lower))
                .take(50)
                .collect();
            return Ok(filtered);
        }

        let clean = sanitize_fts5_query(trimmed);
        if clean.is_empty() {
            return self.get_all_notes();
        }

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT n.id, n.title, n.preview, n.created_at, n.updated_at, n.is_pinned
             FROM notes_fts f
             JOIN notes n ON n.id = f.id
             WHERE notes_fts MATCH ?1
             ORDER BY rank, n.is_pinned DESC, n.updated_at DESC
             LIMIT 50"
        )?;

        let notes = stmt.query_map(params![clean], |row| {
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

    /// Optimized: Returns lightweight note summaries WITHOUT full document content.
    /// Served instantly from RAM cache (< 0.01ms) when warm.
    pub fn get_all_notes(&self) -> Result<Vec<NoteSummary>> {
        if let Ok(lock) = self.meta_cache.lock() {
            if let Some(ref cached) = *lock {
                return Ok(cached.clone());
            }
        }

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

        if let Ok(mut lock) = self.meta_cache.lock() {
            *lock = Some(notes.clone());
        }

        Ok(notes)
    }

    /// Advanced relevance-ranked multi-tier search engine across titles and content.
    /// Ultra-fast (< 0.05ms): uses in-memory metadata cache and gates FTS prefix wildcards.
    pub fn search_documents(&self, query: &str) -> Result<Vec<SearchResult>> {
        let trimmed_query = query.trim();

        // If query is empty, return top 20 recent notes directly from in-memory cache (< 0.01ms)
        if trimmed_query.is_empty() {
            let all = self.get_all_notes()?;
            let recent = all
                .into_iter()
                .take(20)
                .map(|n| SearchResult {
                    id: n.id,
                    title: n.title,
                    snippet: n.preview,
                    score: if n.is_pinned { 100.0 } else { 50.0 },
                    match_type: "recent".to_string(),
                    updated_at: n.updated_at,
                    is_pinned: n.is_pinned,
                })
                .collect();

            return Ok(recent);
        }

        // 1. Check if the query contains any substantial token (>= 3 chars)
        // Short queries (< 3 chars) bypass FTS content scan completely (< 0.05ms!)
        let has_substantial_token = trimmed_query
            .split_whitespace()
            .any(|w| w.chars().filter(|c| c.is_alphanumeric()).count() >= 3);

        let mut fts_matched_ids = std::collections::HashSet::new();
        if has_substantial_token {
            let clean_fts = sanitize_fts5_query(trimmed_query);
            if !clean_fts.is_empty() {
                let conn = self.conn.lock().unwrap();
                let prepared = conn.prepare("SELECT f.id FROM notes_fts f WHERE notes_fts MATCH ?1 LIMIT 50");
                if let Ok(mut stmt) = prepared {
                    if let Ok(rows) = stmt.query_map(params![clean_fts], |row| row.get::<_, String>(0)) {
                        for id in rows.flatten() {
                            fts_matched_ids.insert(id);
                        }
                    }
                }
            }
        }

        // 2. Fetch candidate note metadata from in-memory cache (< 0.01ms!)
        let notes = self.get_all_notes()?;

        let mut results = Vec::new();
        for note in &notes {
            let is_fts_match = fts_matched_ids.contains(&note.id);

            let candidate = DocumentCandidate {
                id: &note.id,
                title: &note.title,
                search_text: &note.preview,
                preview: &note.preview,
                updated_at: &note.updated_at,
                is_pinned: note.is_pinned,
                fts_snippet: if is_fts_match { Some("fts") } else { None },
            };

            let (score, match_type) = score_document(trimmed_query, &candidate);
            if score > 0.0 {
                let snippet = generate_contextual_snippet(
                    &note.preview,
                    trimmed_query,
                    None,
                    &note.preview,
                    110,
                );

                results.push(SearchResult {
                    id: note.id.clone(),
                    title: note.title.clone(),
                    snippet,
                    score,
                    match_type,
                    updated_at: note.updated_at.clone(),
                    is_pinned: note.is_pinned,
                });
            }
        }

        // 3. Deterministically sort results:
        // Score (descending) -> is_pinned (descending) -> updated_at (descending) -> id (ascending)
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.is_pinned.cmp(&a.is_pinned))
                .then_with(|| b.updated_at.cmp(&a.updated_at))
                .then_with(|| a.id.cmp(&b.id))
        });

        // Bounded result set
        results.truncate(30);

        // 4. For any top-ranked content matches where the query term was deeper in the document
        // than the preview, fetch search_text on demand for contextual snippet extraction
        if has_substantial_token {
            let q_lower = trimmed_query.to_lowercase();
            let conn = self.conn.lock().unwrap();
            for item in &mut results {
                if item.match_type == "content" && !item.snippet.to_lowercase().contains(&q_lower) {
                    if let Ok(st) = conn.query_row(
                        "SELECT search_text FROM notes WHERE id = ?1",
                        params![item.id],
                        |row| row.get::<_, String>(0),
                    ) {
                        item.snippet = generate_contextual_snippet(&st, trimmed_query, None, &item.snippet, 110);
                    }
                }
            }
        }

        Ok(results)
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

    /// Inserts a newly generated note row into SQLite and extracts an initial preview.
    pub fn create_note(&self, note: &Note) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let search_text = extract_searchable_text(&note.content);
        let preview = if note.preview.is_empty() {
            truncate_preview(&search_text, 120)
        } else {
            note.preview.clone()
        };
        conn.execute(
            "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                note.id,
                note.title,
                note.content,
                preview,
                search_text,
                note.created_at,
                note.updated_at,
                note.is_pinned as i32,
            ],
        )?;
        drop(conn);
        self.invalidate_cache();
        Ok(())
    }

    /// Updates title, content, computed preview, search_text, and updated_at timestamp for a note in SQLite.
    pub fn update_note(&self, id: &str, title: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let search_text = extract_searchable_text(content);
        let preview = truncate_preview(&search_text, 120);
        conn.execute(
            "UPDATE notes SET title = ?1, content = ?2, preview = ?3, search_text = ?4, updated_at = ?5 WHERE id = ?6",
            params![title, content, preview, search_text, now, id],
        )?;
        drop(conn);
        self.invalidate_cache();
        Ok(())
    }

    /// Permanently deletes a note from SQLite (trigger automatically removes FTS index).
    pub fn delete_note(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        drop(conn);
        self.invalidate_cache();
        Ok(())
    }

    /// Toggles the is_pinned boolean flag for a note and returns the new pinned state.
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

        drop(conn);
        self.invalidate_cache();
        Ok(pinned != 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_searchable_text_tiptap_json() {
        let tiptap_json = r#"{
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": { "level": 1 },
                    "content": [{ "type": "text", "text": "Feature Audit" }]
                },
                {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "This document covers performance optimization." }]
                },
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{ "type": "text", "text": "Cache eviction strategy" }]
                                }
                            ]
                        }
                    ]
                },
                {
                    "type": "codeBlock",
                    "attrs": { "language": "rust" },
                    "content": [{ "type": "text", "text": "fn benchmark() { let x = 42; }" }]
                }
            ]
        }"#;

        let extracted = extract_searchable_text(tiptap_json);

        // Plain text must contain textual contents
        assert!(extracted.contains("Feature Audit"));
        assert!(extracted.contains("performance optimization"));
        assert!(extracted.contains("Cache eviction strategy"));
        assert!(extracted.contains("fn benchmark"));

        // Must NOT contain JSON structural tokens
        assert!(!extracted.contains("\"type\""));
        assert!(!extracted.contains("\"content\""));
        assert!(!extracted.contains("\"attrs\""));
        assert!(!extracted.contains("bulletList"));
    }

    #[test]
    fn test_extract_searchable_text_markdown_and_html() {
        let md = "## Heading Two\nThis is **bold** and *italic* text with `inline code` and <span>HTML tags</span>.";
        let extracted = extract_searchable_text(md);

        assert!(extracted.contains("Heading Two"));
        assert!(extracted.contains("bold"));
        assert!(extracted.contains("italic text with inline code"));
        assert!(extracted.contains("HTML tags"));
        assert!(!extracted.contains("<span>"));
        assert!(!extracted.contains("</span>"));
        assert!(!extracted.contains("##"));
    }

    #[test]
    fn test_database_search_lifecycle() {
        let temp_dir = std::env::temp_dir().join(format!("raynote_test_db_{}", uuid::Uuid::new_v4()));
        let db = Database::new(temp_dir.clone()).expect("Failed to initialize test database");

        let note_id = uuid::Uuid::new_v4().to_string();
        let initial_note = Note {
            id: note_id.clone(),
            title: "Performance Audit".to_string(),
            content: r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"We tested cache eviction and SQLite WAL mode."}]}]}"#.to_string(),
            preview: "".to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            is_pinned: false,
        };

        // 1. Create note -> searchable
        db.create_note(&initial_note).expect("create_note failed");

        let title_results = db.search_documents("performance").expect("search failed");
        assert!(!title_results.is_empty());
        assert_eq!(title_results[0].id, note_id);
        assert_eq!(title_results[0].match_type, "title_prefix");

        let content_results = db.search_documents("eviction").expect("search failed");
        assert!(!content_results.is_empty());
        assert_eq!(content_results[0].id, note_id);
        assert_eq!(content_results[0].match_type, "content");
        assert!(content_results[0].snippet.to_lowercase().contains("eviction"));

        // 2. Renaming note -> search updates
        db.update_note(
            &note_id,
            "Benchmark Suite",
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"We tested cache eviction and SQLite WAL mode."}]}]}"#,
        ).expect("update_note failed");

        let old_title_search = db.search_documents("performance").expect("search failed");
        assert!(old_title_search.is_empty() || old_title_search[0].match_type != "title_prefix");

        let new_title_search = db.search_documents("benchmark").expect("search failed");
        assert!(!new_title_search.is_empty());
        assert_eq!(new_title_search[0].id, note_id);

        // 3. Editing content changes indexed matches
        db.update_note(
            &note_id,
            "Benchmark Suite",
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Includes garbage collection and memory telemetry."}]}]}"#,
        ).expect("update_note failed");

        let updated_content_search = db.search_documents("telemetry").expect("search failed");
        assert!(!updated_content_search.is_empty());
        assert_eq!(updated_content_search[0].id, note_id);

        // 4. Deleting note removes it from search results
        db.delete_note(&note_id).expect("delete_note failed");
        let deleted_search = db.search_documents("benchmark").expect("search failed");
        assert!(deleted_search.is_empty());

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_real_db_search_benchmark() {
        let home = std::env::var("HOME").unwrap_or_default();
        let app_dir = std::path::PathBuf::from(home)
            .join("Library/Application Support/com.raynote.desktop");
        if !app_dir.join("raynote.db").exists() {
            println!("Real DB does not exist, skipping real DB benchmark");
            return;
        }

        let db = Database::new(app_dir).expect("Failed to open real DB");
        let test_queries = [
            "a",
            "p",
            "pe",
            "per",
            "perf",
            "performance",
            "audit",
            "cache",
            "eviction",
            "z",
        ];

        println!("\n=== REAL DATABASE LATENCY BENCHMARK ===");
        for query in test_queries {
            // Warmup
            let _ = db.search_documents(query);

            let mut times = Vec::new();
            for _ in 0..5 {
                let start = std::time::Instant::now();
                let results = db.search_documents(query).unwrap();
                let dur = start.elapsed();
                times.push((dur, results.len()));
            }

            let avg_micros: u128 = times.iter().map(|(d, _)| d.as_micros()).sum::<u128>() / 5;
            let avg_ms = avg_micros as f64 / 1000.0;
            let count = times[0].1;
            println!("Query '{:12}': {:6.3} ms ({} results)", query, avg_ms, count);

            // 1-letter queries MUST complete in under 5 ms (well below 16ms frame budget)
            if query.len() == 1 {
                assert!(avg_ms < 5.0, "1-character query took {:.2}ms (> 5ms)", avg_ms);
            }
        }
        println!("=======================================\n");
    }
}
