//! NoteFast SQLite Persistence Layer (database.rs)
//!
//! Architectural highlights:
//! - Dual Connections (Reader / Writer): Separates writes (writer Mutex) from concurrent reads
//!   (reader Mutex with SQLITE_OPEN_READ_ONLY and PRAGMA query_only = true) in WAL mode.
//! - Gated Migrations: Gated behind PRAGMA user_version to prevent full index re-wipes on startup.
//! - SQLite FTS5 Full-Text Search: Automatically indexes titles, previews, and contents via
//!   SQL triggers (`notes_fts_ai`, `notes_fts_ad`, `notes_fts_au`) for rapid keyword matching.
//! - In-Place Metadata Cache: Thread-safe RwLock<Option<Arc<Vec<NoteSummary>>>> updated in-place
//!   on note mutations with precomputed lowercase titles, eliminating heap re-allocations on reads.

use rusqlite::{Connection, Result, params, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, RwLock, Arc};
use std::sync::atomic::{AtomicBool, Ordering};
use std::path::PathBuf;
use crate::search::{
    calculate_recency_bonus, normalize_query, score_title_fuzzy, score_title_match, tokenize,
    SearchResult,
};

#[cfg(test)]
/// Per-stage nanosecond latency diagnostics for search_documents.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct SearchStageTimings {
    pub setup_ns: u64,
    pub cache_fetch_ns: u64,
    pub title_pass_ns: u64,
    pub fts_query_ns: u64,
    pub merge_sort_ns: u64,
    pub snippet_build_ns: u64,
    pub total_ns: u64,
}

/// Lightweight note summary row structure returned for lists and searches.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    #[serde(skip)]
    #[serde(default)]
    #[allow(dead_code)]
    pub title_lower: String,
    pub preview: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_pinned: bool,
}

#[derive(Debug, Serialize)]
pub struct TrashedNoteSummary {
    pub id: String,
    pub title: String,
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

/// Thread-safe database wrapper maintaining separate writer and reader connections in WAL mode,
/// with an in-memory metadata cache for sub-millisecond search and switcher performance.
pub struct Database {
    pub writer: Mutex<Connection>,
    pub reader: Mutex<Connection>,
    meta_cache: RwLock<Option<Arc<Vec<NoteSummary>>>>,
    search_index_checked: AtomicBool,
    pub cache_gen: std::sync::atomic::AtomicU64,
}

/// Helper function defining canonical sort ordering:
/// Pinned notes strictly precede unpinned notes, tie-broken by `updated_at` descending,
/// then deterministic `id` ascending.
#[inline]
pub fn sorts_before(s: &NoteSummary, n: &NoteSummary) -> bool {
    if s.is_pinned != n.is_pinned {
        s.is_pinned
    } else if s.updated_at != n.updated_at {
        s.updated_at > n.updated_at
    } else {
        s.id < n.id
    }
}

/// Binary-search based sorted insertion maintaining canonical note order in O(log N).
pub fn insert_sorted(vec: &mut Vec<NoteSummary>, s: NoteSummary) {
    let idx = vec.partition_point(|n| !sorts_before(&s, n));
    vec.insert(idx, s);
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
            if value.get("type").and_then(|v| v.as_str()) == Some("doc") || !cleaned.is_empty() {
                return cleaned;
            }
        }
    }

    strip_markdown_and_html(trimmed)
}

fn extract_text_recursive(node: &serde_json::Value, out: &mut String) {
    if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
        out.push_str(text);
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children { extract_text_recursive(child, out); }
    }
    // Inline marks split text nodes, not words. Only structural boundaries separate text.
    let kind = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if matches!(kind, "paragraph" | "heading" | "codeBlock" | "hardBreak" | "tableCell" | "tableHeader") && !out.ends_with(' ') {
        out.push(' ');
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
/// Splits on non-alphanumeric characters (including hyphens and punctuation).
/// Only tokens with >= 3 alphanumeric characters receive prefix wildcard '*' for typeahead search.
/// Tokens with < 3 characters are matched as exact words to prevent massive index expansions.
#[allow(dead_code)]
pub fn sanitize_fts5_query(query: &str) -> String {
    let clean = query.replace('"', " ");
    let mut tokens = Vec::new();
    for word in clean.split(|c: char| !c.is_alphanumeric() && c != '_') {
        let cleaned = word.trim();
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
    /// Opens writer and reader connections to `raynote.db`, applies PRAGMA optimizations,
    /// runs migrations gated by user_version, and initializes lazy in-memory caching.
    pub fn new(app_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&app_dir).ok();
        let db_path = app_dir.join("raynote.db");

        // Read through SQLite so committed WAL pages are included in the migration.
        // Publish only a complete backup; a failed migration must remain retryable.
        if !db_path.exists() {
            let local_legacy = app_dir.join("notefast.db");
            let legacy_path = if local_legacy.exists() {
                Some(local_legacy)
            } else {
                app_dir.parent().map(|parent| parent.join("com.notefast.app/notefast.db"))
                    .filter(|path| path.exists())
            };
            if let Some(legacy_path) = legacy_path {
                let source = Connection::open_with_flags(&legacy_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
                let staging = app_dir.join(format!("raynote-migration-{}.db", uuid::Uuid::new_v4()));
                if let Err(error) = source.backup(rusqlite::MAIN_DB, &staging, None::<fn(_)>) {
                    let _ = std::fs::remove_file(&staging);
                    return Err(error);
                }
                if let Err(error) = std::fs::rename(&staging, &db_path) {
                    let _ = std::fs::remove_file(&staging);
                    return Err(rusqlite::Error::SqliteFailure(
                        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_IOERR),
                        Some(error.to_string()),
                    ));
                }
            }
        }

        let mut writer = Connection::open(&db_path)?;

        let _ = writer.pragma_update(None, "journal_mode", "WAL");
        let _ = writer.pragma_update(None, "synchronous", "NORMAL");
        let _ = writer.pragma_update(None, "cache_size", -1000);
        let _ = writer.pragma_update(None, "temp_store", "MEMORY");
        let _ = writer.pragma_update(None, "mmap_size", 0);
        let _ = writer.pragma_update(None, "journal_size_limit", 8388608);

        writer.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                preview TEXT NOT NULL DEFAULT '',
                search_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);

            CREATE TABLE IF NOT EXISTS trashed_notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                preview TEXT NOT NULL,
                search_text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_pinned INTEGER NOT NULL,
                trashed_at TEXT NOT NULL
            );
            "
        )?;

        // Ensure notes_fts and triggers exist unconditionally for baseline table operations
        writer.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                id UNINDEXED,
                title,
                search_text,
                tokenize='unicode61'
            );

            CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
                INSERT INTO notes_fts(rowid, id, title, search_text)
                VALUES (new.rowid, new.id, new.title, new.search_text);
            END;

            CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
                DELETE FROM notes_fts WHERE rowid = old.rowid;
            END;

            CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE OF title, search_text ON notes
            WHEN old.title IS NOT new.title OR old.search_text IS NOT new.search_text
            BEGIN
                DELETE FROM notes_fts WHERE rowid = old.rowid;
                INSERT INTO notes_fts(rowid, id, title, search_text)
                VALUES (new.rowid, new.id, new.title, new.search_text);
            END;"
        )?;

        // One-time migrations wrapped in an atomic transaction and gated by PRAGMA user_version
        let user_version: i32 = writer
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap_or(0);

        if user_version < 3 {
            let tx = writer.transaction()?;

            if user_version < 1 {
                // Ensure preview and search_text columns exist on legacy tables
                let _ = tx.execute("ALTER TABLE notes ADD COLUMN preview TEXT NOT NULL DEFAULT ''", []);
                let _ = tx.execute("ALTER TABLE notes ADD COLUMN search_text TEXT NOT NULL DEFAULT ''", []);

                // Backfill any empty previews or search_text for existing notes
                if let Ok(mut stmt) = tx.prepare("SELECT id, content FROM notes WHERE (search_text = '' OR search_text IS NULL OR preview = '' OR preview IS NULL) AND content != ''") {
                    let to_update: Vec<(String, String)> = stmt.query_map([], |row| {
                        Ok((row.get(0)?, row.get(1)?))
                    })
                    .and_then(|mapped| mapped.collect::<Result<Vec<_>, _>>())
                    .unwrap_or_default();

                    for (id, content) in to_update {
                        let st = extract_searchable_text(&content);
                        let prev = truncate_preview(&st, 120);
                        let _ = tx.execute("UPDATE notes SET search_text = ?1, preview = ?2 WHERE id = ?3", params![st, prev, id]);
                    }
                }
            }

            if user_version < 2 {
                // Drop old triggers and virtual table
                let _ = tx.execute_batch(
                    "DROP TRIGGER IF EXISTS notes_fts_ai;
                     DROP TRIGGER IF EXISTS notes_fts_ad;
                     DROP TRIGGER IF EXISTS notes_fts_au;
                     DROP TABLE IF EXISTS notes_fts;"
                );

                // Recreate notes_fts with (id UNINDEXED, title, search_text) ONLY - preview dropped
                tx.execute_batch(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                         id UNINDEXED,
                         title,
                         search_text,
                         tokenize='unicode61'
                     );

                     CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
                         INSERT INTO notes_fts(rowid, id, title, search_text)
                         VALUES (new.rowid, new.id, new.title, new.search_text);
                     END;

                     CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
                         DELETE FROM notes_fts WHERE rowid = old.rowid;
                     END;

                     CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE OF title, search_text ON notes
                     WHEN old.title IS NOT new.title OR old.search_text IS NOT new.search_text
                     BEGIN
                         DELETE FROM notes_fts WHERE rowid = old.rowid;
                         INSERT INTO notes_fts(rowid, id, title, search_text)
                         VALUES (new.rowid, new.id, new.title, new.search_text);
                     END;"
                )?;

                // Populate notes_fts once for pre-existing notes
                tx.execute(
                    "INSERT INTO notes_fts(rowid, id, title, search_text)
                     SELECT rowid, id, title, search_text FROM notes",
                    [],
                )?;
            }

            if user_version < 3 {
                // idx_notes_pinned is provably redundant because (is_pinned DESC, updated_at DESC) is a left prefix of idx_notes_covering
                let _ = tx.execute("DROP INDEX IF EXISTS idx_notes_pinned", []);
                // Keep idx_notes_updated_at: updated_at alone is not a left prefix of idx_notes_covering (which starts with is_pinned)
                tx.execute(
                    "CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC)",
                    [],
                )?;
            }

            tx.execute("PRAGMA user_version = 3", [])?;
            tx.commit()?;
        }

        if user_version < 4 {
            let tx = writer.transaction()?;
            {
                let mut stmt = tx.prepare("SELECT id, content FROM notes")?;
                let mut rows = stmt.query([])?;
                while let Some(row) = rows.next()? {
                    let id: String = row.get(0)?;
                    let content: String = row.get(1)?;
                    let text = extract_searchable_text(&content);
                    tx.execute("UPDATE notes SET search_text = ?1, preview = ?2 WHERE id = ?3", params![text, truncate_preview(&text, 120), id])?;
                }
            }
            tx.pragma_update(None, "user_version", 4)?;
            tx.commit()?;
        }

        if user_version < 6 {
            let tx = writer.transaction()?;
            // Trash filters loaded titles locally. Remove the old body index, not the notes.
            tx.execute_batch(
                "DROP TRIGGER IF EXISTS trashed_notes_fts_ai;
                 DROP TRIGGER IF EXISTS trashed_notes_fts_ad;
                 DROP TABLE IF EXISTS trashed_notes_fts;",
            )?;
            tx.pragma_update(None, "user_version", 6)?;
            tx.commit()?;
        }

        // Legacy columns must exist before creating this index. Also restore it
        // if an otherwise current database is missing the index.
        writer.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_covering ON notes(is_pinned DESC, updated_at DESC, id, title, preview, created_at)",
            [],
        )?;

        // Open independent read-only connection
        let reader = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let _ = reader.pragma_update(None, "query_only", "true");
        let _ = reader.pragma_update(None, "cache_size", -256);

        Ok(Database {
            writer: Mutex::new(writer),
            reader: Mutex::new(reader),
            meta_cache: RwLock::new(None),
            search_index_checked: AtomicBool::new(false),
            cache_gen: std::sync::atomic::AtomicU64::new(0),
        })
    }

    // Ordinary note reads don't need FTS. Check it before the first body
    // search instead of counting two entire tables on every launch.
    fn ensure_search_index(&self) -> Result<()> {
        if self.search_index_checked.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        if self.search_index_checked.load(Ordering::Relaxed) {
            return Ok(());
        }
        let notes_count: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?;
        let fts_count: i64 = conn.query_row("SELECT COUNT(*) FROM notes_fts", [], |row| row.get(0))?;
        if notes_count != fts_count {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM notes_fts", [])?;
            tx.execute(
                "INSERT INTO notes_fts(rowid, id, title, search_text)
                 SELECT rowid, id, title, search_text FROM notes",
                [],
            )?;
            tx.commit()?;
        }
        self.search_index_checked.store(true, Ordering::Release);
        Ok(())
    }

    /// Completely rebuilds the SQLite FTS5 index from the `notes` table.
    /// Call this after any bulk restore or import operation.
    #[allow(dead_code)]
    pub fn rebuild_fts(&self) -> Result<()> {
        let conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM notes_fts", [])?;
        conn.execute(
            "INSERT INTO notes_fts(rowid, id, title, search_text)
             SELECT rowid, id, title, search_text FROM notes",
            [],
        )?;
        self.invalidate_cache();
        Ok(())
    }

    /// Invalidates in-memory metadata cache when bulk operations occur.
    #[allow(dead_code)]
    pub fn invalidate_cache(&self) {
        if let Ok(mut lock) = self.meta_cache.write() {
            self.cache_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            *lock = None;
        }
    }

    /// Returns the total number of notes in the database using a lightweight COUNT(*) query.
    pub fn get_note_count(&self) -> Result<usize> {
        let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    /// Returns Arc-wrapped note summaries WITHOUT copying the underlying Vec on cache hits.
    pub fn get_all_notes_arc(&self) -> Result<Arc<Vec<NoteSummary>>> {
        {
            if let Ok(lock) = self.meta_cache.read() {
                if let Some(ref cached) = *lock {
                    return Ok(Arc::clone(cached));
                }
            }
        }

        // Record generation BEFORE running the SQL query to prevent race conditions
        let gen_before = self.cache_gen.load(std::sync::atomic::Ordering::SeqCst);

        let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, title, preview, created_at, updated_at, is_pinned
             FROM notes
             ORDER BY is_pinned DESC, updated_at DESC, id ASC"
        )?;

        let notes: Vec<NoteSummary> = stmt.query_map([], |row| {
            let title: String = row.get(1)?;
            let title_lower = normalize_query(&title);
            Ok(NoteSummary {
                id: row.get(0)?,
                title,
                title_lower,
                preview: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                is_pinned: row.get::<_, i32>(5)? != 0,
            })
        })?.collect::<Result<Vec<_>>>()?;

        let arc = Arc::new(notes);
        if let Ok(mut lock) = self.meta_cache.write() {
            // Only populate cache if no concurrent write invalidated or updated it during our read query
            if self.cache_gen.load(std::sync::atomic::Ordering::SeqCst) == gen_before {
                *lock = Some(Arc::clone(&arc));
            }
        }

        Ok(arc)
    }

    /// Returns lightweight note summaries for external serialization.
    #[allow(dead_code)]
    pub fn get_all_notes(&self) -> Result<Vec<NoteSummary>> {
        let arc = self.get_all_notes_arc()?;
        Ok((*arc).clone())
    }

    /// Returns only the requested recent results, without warming the full search cache.
    pub fn get_recent_notes(&self, limit: usize) -> Result<Vec<SearchResult>> {
        Ok(self.get_recent_summaries(limit)?.into_iter().map(|note| SearchResult {
            id: note.id,
            title: note.title,
            snippet: note.preview,
            score: if note.is_pinned { 100.0 } else { 50.0 },
            match_type: "recent".to_string(),
            updated_at: note.updated_at,
            is_pinned: note.is_pinned,
        }).collect())
    }

    pub fn get_recent_summaries(&self, limit: usize) -> Result<Vec<NoteSummary>> {
        if let Ok(cache) = self.meta_cache.read() {
            if let Some(notes) = cache.as_ref() {
                return Ok(notes.iter().take(limit).cloned().collect());
            }
        }

        let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare_cached(
            "SELECT id, title, preview, created_at, updated_at, is_pinned
             FROM notes
             ORDER BY is_pinned DESC, updated_at DESC, id ASC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([i64::try_from(limit).unwrap_or(i64::MAX)], |row| {
            let title: String = row.get(1)?;
            Ok(NoteSummary {
                id: row.get(0)?,
                title_lower: normalize_query(&title),
                title,
                preview: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                is_pinned: row.get::<_, i32>(5)? != 0,
            })
        })?;
        rows.collect()
    }

    /// Keyset navigation for Option+Up / Option+Down across all notes in (is_pinned DESC, updated_at DESC, id ASC) order.
    /// Uses in-memory summary cache for current note metadata to avoid reading table rows / overflow pages,
    /// and uses prepare_cached on the reader connection for sub-millisecond index seeks.
    pub fn get_adjacent_note(&self, current_id: &str, direction: &str) -> Result<Option<String>> {
        let all = self.get_all_notes_arc()?;
        if all.is_empty() {
            return Ok(None);
        }

        let (is_pinned, updated_at) = match all.iter().find(|n| n.id == current_id) {
            Some(n) => (n.is_pinned as i32, n.updated_at.as_str()),
            None => {
                // Fall back to first note if id is not found in cache
                return Ok(Some(all[0].id.clone()));
            }
        };

        let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());

        let target_id: Option<String> = if direction == "prev" {
            let mut stmt = conn.prepare_cached(
                "SELECT id FROM (
                     SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at = ?2 AND id < ?3 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
                 ) UNION ALL SELECT id FROM (
                     SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at > ?2 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
                 ) UNION ALL SELECT id FROM (
                     SELECT id FROM notes WHERE is_pinned > ?1 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
                 ) LIMIT 1",
            )?;
            let found: Option<String> = stmt.query_row(
                params![is_pinned, updated_at, current_id],
                |r| r.get(0),
            ).optional()?;
            match found {
                Some(id) => Some(id),
                None => {
                    let mut wrap_stmt = conn.prepare_cached(
                        "SELECT id FROM notes ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1",
                    )?;
                    wrap_stmt.query_row([], |r| r.get(0)).optional()?
                }
            }
        } else {
            let mut stmt = conn.prepare_cached(
                "SELECT id FROM (
                     SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at = ?2 AND id > ?3 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
                 ) UNION ALL SELECT id FROM (
                     SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at < ?2 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
                 ) UNION ALL SELECT id FROM (
                     SELECT id FROM notes WHERE is_pinned < ?1 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
                 ) LIMIT 1",
            )?;
            let found: Option<String> = stmt.query_row(
                params![is_pinned, updated_at, current_id],
                |r| r.get(0),
            ).optional()?;
            match found {
                Some(id) => Some(id),
                None => {
                    let mut wrap_stmt = conn.prepare_cached(
                        "SELECT id FROM notes ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1",
                    )?;
                    wrap_stmt.query_row([], |r| r.get(0)).optional()?
                }
            }
        };

        Ok(target_id)
    }

    /// High-performance hybrid relevance-ranked search engine:
    /// (a) Fast title-only scoring with 0 heap allocations per note (exact, prefix, substring, all-words).
    /// (b) Fuzzy title search ONLY triggered if cheap title matching produces fewer than `limit` candidates.
    /// (c) Sub-millisecond FTS5 query on reader connection using quoted prefix tokens with snippet().
    /// (d) Cheaply score candidates, partition top-K via `select_nth_unstable_by`, and build SearchResult
    ///     structures ONLY for the final K results.
    pub fn search_documents(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>> {
        let trimmed_query = query.trim();

        // 1. Empty query falls back to recents directly
        if trimmed_query.is_empty() {
            return self.get_recent_notes(limit);
        }

        let norm_query = normalize_query(trimmed_query);
        let all_notes = self.get_all_notes_arc()?;
        let limit = limit.min(all_notes.len());
        if limit == 0 {
            return Ok(Vec::new());
        }

        // 2. Non-empty query with no alphanumeric FTS tokens (emoji, symbols, quotes only)
        if norm_query.is_empty() {
            let query_words: Vec<&str> = trimmed_query.split_whitespace().collect();
            let query_lower = trimmed_query.to_lowercase();
            let mut matches = Vec::new();
            for note in all_notes.iter() {
                let title_lower = note.title.to_lowercase();
                let is_match = if query_words.len() > 1 {
                    query_words.iter().all(|w| title_lower.contains(&w.to_lowercase()))
                } else {
                    title_lower.contains(&query_lower)
                };

                if is_match {
                    let pinned_bonus = if note.is_pinned { 15.0 } else { 0.0 };
                    let recency_bonus = calculate_recency_bonus(&note.updated_at);
                    matches.push(SearchResult {
                        id: note.id.clone(),
                        title: note.title.clone(),
                        snippet: note.preview.clone(),
                        score: 500.0 + pinned_bonus + recency_bonus,
                        match_type: "title_substring".to_string(),
                        updated_at: note.updated_at.clone(),
                        is_pinned: note.is_pinned,
                    });
                    if matches.len() >= limit {
                        break;
                    }
                }
            }
            return Ok(matches);
        }

        let query_tokens = tokenize(&norm_query);

        struct ScoredCandidate {
            note_idx: usize,
            score: f64,
            match_type: &'static str,
            fts_snippet: Option<String>,
        }

        let mut candidates: Vec<ScoredCandidate> = Vec::with_capacity(limit * 2);
        let mut matched_indices: std::collections::HashSet<usize> = std::collections::HashSet::with_capacity(limit * 2);

        for (idx, note) in all_notes.iter().enumerate() {
            let (base_score, match_type) = score_title_match(&norm_query, &query_tokens, &note.title_lower, false);
            if base_score >= 50.0 {
                let pinned_bonus = if note.is_pinned { 15.0 } else { 0.0 };
                let recency_bonus = calculate_recency_bonus(&note.updated_at);
                let score = base_score + pinned_bonus + recency_bonus;
                candidates.push(ScoredCandidate {
                    note_idx: idx,
                    score,
                    match_type,
                    fts_snippet: None,
                });
                matched_indices.insert(idx);
            }
        }

        // Fuzzy pass: ONLY if exact/prefix/substring produced fewer than `limit` results
        if candidates.len() < limit {
            for (idx, note) in all_notes.iter().enumerate() {
                if matched_indices.contains(&idx) {
                    continue;
                }
                // Skip titles where no word is within 2 characters length of any query token
                let has_length_compatible_word = query_tokens.iter().any(|q| {
                    note.title_lower
                        .split_whitespace()
                        .any(|t| (q.len() as isize - t.len() as isize).abs() <= 2)
                });
                if !has_length_compatible_word {
                    continue;
                }

                let (base_score, match_type) = score_title_fuzzy(&norm_query, &query_tokens, &note.title_lower);
                if base_score >= 50.0 {
                    let pinned_bonus = if note.is_pinned { 15.0 } else { 0.0 };
                    let recency_bonus = calculate_recency_bonus(&note.updated_at);
                    let score = base_score + pinned_bonus + recency_bonus;
                    candidates.push(ScoredCandidate {
                        note_idx: idx,
                        score,
                        match_type,
                        fts_snippet: None,
                    });
                    matched_indices.insert(idx);
                }
            }
        }

        // Full-Text Search (FTS5):
        // 1. If title matches already satisfy the requested limit, skip expensive FTS
        //    (title matches score 500-1000, content matches score ~200, so content matches won't outrank them).
        // 2. For single-character queries (norm_query.len() < 2), full-text body search scans
        //    hundreds of thousands of words in SQLite and takes seconds. Single-character search is title matching.
        // 3. sanitize_fts5_query safely appends wildcard `*` only for tokens >= 3 chars, preventing massive index scans.
        if candidates.len() < limit && norm_query.len() >= 2 {
            let clean_fts = sanitize_fts5_query(trimmed_query);

            if !clean_fts.is_empty() {
                self.ensure_search_index()?;
                let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());
                let stmt = conn.prepare(
                    "SELECT f.id, snippet(notes_fts, 2, '', '', '…', 15), rank
                     FROM notes_fts f
                     WHERE notes_fts MATCH ?1
                     ORDER BY rank
                     LIMIT ?2",
                );
                if let Ok(mut prepared) = stmt {
                    let fts_rows = prepared.query_map(params![clean_fts, (limit * 2) as i64], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
                    });
                    if let Ok(rows) = fts_rows {
                        for r in rows.flatten() {
                            let (fts_id, snippet, rank) = r;
                            let fts_score = (-rank).max(0.0) * 10.0;
                            if let Some(pos) = candidates.iter().position(|c| all_notes[c.note_idx].id == fts_id) {
                                candidates[pos].score += fts_score + 50.0;
                                candidates[pos].fts_snippet = Some(snippet);
                            } else if let Some(idx) = all_notes.iter().position(|n| n.id == fts_id) {
                                let note = &all_notes[idx];
                                let pinned_bonus = if note.is_pinned { 15.0 } else { 0.0 };
                                let recency_bonus = calculate_recency_bonus(&note.updated_at);
                                candidates.push(ScoredCandidate {
                                    note_idx: idx,
                                    score: 200.0 + fts_score + pinned_bonus + recency_bonus,
                                    match_type: "content",
                                    fts_snippet: Some(snippet),
                                });
                            }
                        }
                    }
                }
            }
        }

        if candidates.len() > limit {
            candidates.select_nth_unstable_by(limit, |a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| all_notes[b.note_idx].is_pinned.cmp(&all_notes[a.note_idx].is_pinned))
                    .then_with(|| all_notes[b.note_idx].updated_at.cmp(&all_notes[a.note_idx].updated_at))
                    .then_with(|| all_notes[a.note_idx].id.cmp(&all_notes[b.note_idx].id))
            });
            candidates.truncate(limit);
        }

        candidates.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| all_notes[b.note_idx].is_pinned.cmp(&all_notes[a.note_idx].is_pinned))
                .then_with(|| all_notes[b.note_idx].updated_at.cmp(&all_notes[a.note_idx].updated_at))
                .then_with(|| all_notes[a.note_idx].id.cmp(&all_notes[b.note_idx].id))
        });

        let results: Vec<SearchResult> = candidates
            .into_iter()
            .map(|c| {
                let note = &all_notes[c.note_idx];
                let snippet = c.fts_snippet.unwrap_or_else(|| note.preview.clone());
                SearchResult {
                    id: note.id.clone(),
                    title: note.title.clone(),
                    snippet,
                    score: c.score,
                    match_type: c.match_type.to_string(),
                    updated_at: note.updated_at.clone(),
                    is_pinned: note.is_pinned,
                }
            })
            .collect();

        Ok(results)
    }

    #[cfg(test)]
    /// Diagnostics-instrumented version for regression tracking tests only.
    pub fn search_documents_profiled(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<(Vec<SearchResult>, SearchStageTimings)> {
        let mut timings = SearchStageTimings::default();
        let total_start = std::time::Instant::now();

        let trimmed_query = query.trim();

        // 1. Empty query falls back to recents directly
        if trimmed_query.is_empty() {
            let res = self.get_recent_notes(limit)?;
            timings.total_ns = total_start.elapsed().as_nanos() as u64;
            return Ok((res, timings));
        }

        let norm_query = normalize_query(trimmed_query);

        let t_cache = std::time::Instant::now();
        let all_notes = self.get_all_notes_arc()?;
        timings.cache_fetch_ns = t_cache.elapsed().as_nanos() as u64;

        // 2. Non-empty query with no alphanumeric FTS tokens (emoji, symbols, quotes only)
        // MUST NOT fall back to recents! Run raw title match only:
        if norm_query.is_empty() {
            let t_title = std::time::Instant::now();
            let query_words: Vec<&str> = trimmed_query.split_whitespace().collect();
            let query_lower = trimmed_query.to_lowercase();
            let mut matches = Vec::new();
            for note in all_notes.iter() {
                let title_lower = note.title.to_lowercase();
                let is_match = if query_words.len() > 1 {
                    query_words.iter().all(|w| title_lower.contains(&w.to_lowercase()))
                } else {
                    title_lower.contains(&query_lower)
                };

                if is_match {
                    let pinned_bonus = if note.is_pinned { 15.0 } else { 0.0 };
                    let recency_bonus = calculate_recency_bonus(&note.updated_at);
                    matches.push(SearchResult {
                        id: note.id.clone(),
                        title: note.title.clone(),
                        snippet: note.preview.clone(),
                        score: 500.0 + pinned_bonus + recency_bonus,
                        match_type: "title_substring".to_string(),
                        updated_at: note.updated_at.clone(),
                        is_pinned: note.is_pinned,
                    });
                    if matches.len() >= limit {
                        break;
                    }
                }
            }
            timings.title_pass_ns = t_title.elapsed().as_nanos() as u64;
            timings.total_ns = total_start.elapsed().as_nanos() as u64;
            return Ok((matches, timings));
        }

        let query_tokens = tokenize(&norm_query);

        struct ScoredCandidate {
            note_idx: usize,
            score: f64,
            match_type: &'static str,
            fts_snippet: Option<String>,
        }

        // Stage 1: Fast title pass (zero allocations)
        let t_title = std::time::Instant::now();
        let mut candidates: Vec<ScoredCandidate> = Vec::with_capacity(64);
        let mut matched_indices: std::collections::HashSet<usize> = std::collections::HashSet::with_capacity(64);

        for (idx, note) in all_notes.iter().enumerate() {
            let (base_score, match_type) = score_title_match(&norm_query, &query_tokens, &note.title_lower, false);
            if base_score >= 50.0 {
                let pinned_bonus = if note.is_pinned { 15.0 } else { 0.0 };
                let recency_bonus = calculate_recency_bonus(&note.updated_at);
                let score = base_score + pinned_bonus + recency_bonus;
                candidates.push(ScoredCandidate {
                    note_idx: idx,
                    score,
                    match_type,
                    fts_snippet: None,
                });
                matched_indices.insert(idx);
            }
        }

        // Fuzzy pass: ONLY if exact/prefix/substring produced fewer than `limit` results
        if candidates.len() < limit {
            for (idx, note) in all_notes.iter().enumerate() {
                if matched_indices.contains(&idx) {
                    continue;
                }
                // Skip titles where no word is within 2 characters length of any query token
                let has_length_compatible_word = query_tokens.iter().any(|q| {
                    note.title_lower
                        .split_whitespace()
                        .any(|t| (q.len() as isize - t.len() as isize).abs() <= 2)
                });
                if !has_length_compatible_word {
                    continue;
                }

                let (base_score, match_type) = score_title_fuzzy(&norm_query, &query_tokens, &note.title_lower);
                if base_score >= 50.0 {
                    let pinned_bonus = if note.is_pinned { 15.0 } else { 0.0 };
                    let recency_bonus = calculate_recency_bonus(&note.updated_at);
                    let score = base_score + pinned_bonus + recency_bonus;
                    candidates.push(ScoredCandidate {
                        note_idx: idx,
                        score,
                        match_type,
                        fts_snippet: None,
                    });
                    matched_indices.insert(idx);
                }
            }
        }
        timings.title_pass_ns = t_title.elapsed().as_nanos() as u64;

        // Stage 2: Sub-millisecond FTS query on reader connection
        let t_fts = std::time::Instant::now();
        let clean_fts = sanitize_fts5_query(trimmed_query);
        if !clean_fts.is_empty() {
            self.ensure_search_index()?;
            let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());
            let stmt = conn.prepare(
                "SELECT f.id, snippet(notes_fts, 2, '', '', '…', 15), rank
                 FROM notes_fts f
                 WHERE notes_fts MATCH ?1
                 ORDER BY rank
                 LIMIT 50"
            );

            if let Ok(mut prepared) = stmt {
                let fts_rows = prepared.query_map(params![clean_fts], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, f64>(2)?,
                    ))
                });

                if let Ok(rows) = fts_rows {
                    for row in rows.flatten() {
                        let (id, snippet_text, _rank) = row;
                        if let Some(cand) = candidates.iter_mut().find(|c| all_notes[c.note_idx].id == id) {
                            if !snippet_text.trim().is_empty()
                                && (all_notes[cand.note_idx].preview.is_empty()
                                    || !all_notes[cand.note_idx].preview.to_lowercase().contains(&norm_query))
                            {
                                cand.fts_snippet = Some(snippet_text);
                            }
                        } else if let Some((idx, note)) = all_notes.iter().enumerate().find(|(_, n)| n.id == id) {
                            let pinned_bonus = if note.is_pinned { 15.0 } else { 0.0 };
                            let recency_bonus = calculate_recency_bonus(&note.updated_at);
                            let score = 200.0 + pinned_bonus + recency_bonus;
                            let snippet = if !snippet_text.trim().is_empty() {
                                Some(snippet_text)
                            } else {
                                None
                            };
                            candidates.push(ScoredCandidate {
                                note_idx: idx,
                                score,
                                match_type: "content",
                                fts_snippet: snippet,
                            });
                        }
                    }
                }
            }
        }
        timings.fts_query_ns = t_fts.elapsed().as_nanos() as u64;

        // Stage 3: Merge, rank, and keep top K
        let t_sort = std::time::Instant::now();
        if candidates.len() > limit {
            candidates.select_nth_unstable_by(limit, |a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| all_notes[b.note_idx].is_pinned.cmp(&all_notes[a.note_idx].is_pinned))
                    .then_with(|| all_notes[b.note_idx].updated_at.cmp(&all_notes[a.note_idx].updated_at))
                    .then_with(|| all_notes[a.note_idx].id.cmp(&all_notes[b.note_idx].id))
            });
            candidates.truncate(limit);
        }

        candidates.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| all_notes[b.note_idx].is_pinned.cmp(&all_notes[a.note_idx].is_pinned))
                .then_with(|| all_notes[b.note_idx].updated_at.cmp(&all_notes[a.note_idx].updated_at))
                .then_with(|| all_notes[a.note_idx].id.cmp(&all_notes[b.note_idx].id))
        });
        timings.merge_sort_ns = t_sort.elapsed().as_nanos() as u64;

        // Stage 4: Build SearchResult only for the final K
        let t_build = std::time::Instant::now();
        let results: Vec<SearchResult> = candidates
            .into_iter()
            .map(|c| {
                let note = &all_notes[c.note_idx];
                let snippet = c.fts_snippet.unwrap_or_else(|| note.preview.clone());
                SearchResult {
                    id: note.id.clone(),
                    title: note.title.clone(),
                    snippet,
                    score: c.score,
                    match_type: c.match_type.to_string(),
                    updated_at: note.updated_at.clone(),
                    is_pinned: note.is_pinned,
                }
            })
            .collect();
        timings.snippet_build_ns = t_build.elapsed().as_nanos() as u64;
        timings.total_ns = total_start.elapsed().as_nanos() as u64;

        Ok((results, timings))
    }



    /// Fetches all notes with full content using reader connection (used strictly for bulk export)
    pub fn get_all_notes_with_content(&self) -> Result<Vec<Note>> {
        let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());
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

    /// Fetches ONE note's full content on demand via reader connection
    pub fn get_note(&self, id: &str) -> Result<Option<Note>> {
        let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());
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

    /// Inserts a newly generated note row into SQLite and patches meta_cache in-place.
    pub fn create_note(&self, note: &Note) -> Result<()> {
        let search_text = extract_searchable_text(&note.content);
        let preview = if note.preview.is_empty() {
            truncate_preview(&search_text, 120)
        } else {
            note.preview.clone()
        };

        let conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        {
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
        }

        // Bump cache generation and patch cache in-place inside the SAME write lock critical section
        if let Ok(mut lock) = self.meta_cache.write() {
            self.cache_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if let Some(ref mut arc) = *lock {
                let vec = Arc::make_mut(arc);
                // Idempotent: remove any existing entry with the same ID before inserting
                vec.retain(|n| n.id != note.id);
                let title_lower = normalize_query(&note.title);
                let summary = NoteSummary {
                    id: note.id.clone(),
                    title: note.title.clone(),
                    title_lower,
                    preview,
                    created_at: note.created_at.clone(),
                    updated_at: note.updated_at.clone(),
                    is_pinned: note.is_pinned,
                };
                insert_sorted(vec, summary);
            }
        }

        Ok(())
    }

    /// Updates title, content, computed preview, search_text, and updated_at timestamp for a note in SQLite.
    /// Parses JSON AST before acquiring writer lock and patches meta_cache in-place.
    /// Returns the updated RFC3339 timestamp.
    pub fn update_note(&self, id: &str, title: &str, content: &str) -> Result<String> {
        let now = chrono::Utc::now().to_rfc3339();
        let search_text = extract_searchable_text(content);
        let preview = truncate_preview(&search_text, 120);
        let title_trimmed = title.trim();

        let conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        {
            let rows_affected = conn.execute(
                "UPDATE notes SET title = CASE WHEN length(trim(?1)) > 0 THEN ?1 ELSE title END, content = ?2, preview = ?3, search_text = ?4, updated_at = ?5 WHERE id = ?6",
                params![title_trimmed, content, preview, search_text, now, id],
            )?;
            if rows_affected == 0 {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
        }

        // Bump cache generation and patch cache in-place inside the SAME write lock critical section
        if let Ok(mut lock) = self.meta_cache.write() {
            self.cache_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if let Some(ref mut arc) = *lock {
                let vec = Arc::make_mut(arc);
                if let Some(pos) = vec.iter().position(|n| n.id == id) {
                    let is_pinned = vec[pos].is_pinned;
                    let created_at = vec[pos].created_at.clone();
                    let final_title = if title_trimmed.is_empty() {
                        vec[pos].title.clone()
                    } else {
                        title_trimmed.to_string()
                    };
                    vec.remove(pos);
                    let title_lower = normalize_query(&final_title);
                    let summary = NoteSummary {
                        id: id.to_string(),
                        title: final_title,
                        title_lower,
                        preview,
                        created_at,
                        updated_at: now.clone(),
                        is_pinned,
                    };
                    insert_sorted(vec, summary);
                }
            }
        }

        Ok(now)
    }

    /// Moves a note into Trash atomically. The active table's triggers remove it from search.
    pub fn delete_note(&self, id: &str) -> Result<()> {
        let mut conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO trashed_notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned, trashed_at)
             SELECT id, title, content, preview, search_text, created_at, updated_at, is_pinned, ?2
             FROM notes WHERE id = ?1",
            params![id, chrono::Utc::now().to_rfc3339()],
        )?;
        tx.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        tx.commit()?;

        // Bump cache generation and patch cache in-place inside the SAME write lock critical section
        if let Ok(mut lock) = self.meta_cache.write() {
            self.cache_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if let Some(ref mut arc) = *lock {
                let vec = Arc::make_mut(arc);
                vec.retain(|n| n.id != id);
            }
        }

        Ok(())
    }

    pub fn list_trashed_notes(&self) -> Result<Vec<TrashedNoteSummary>> {
        let conn = self.reader.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare_cached(
            "SELECT id, title FROM trashed_notes ORDER BY trashed_at DESC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TrashedNoteSummary { id: row.get(0)?, title: row.get(1)? })
        })?;
        rows.collect()
    }

    pub fn restore_trashed_note(&self, id: &str) -> Result<()> {
        let mut conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction()?;
        let inserted = tx.execute(
            "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
             SELECT id, title, content, preview, search_text, created_at, updated_at, is_pinned
             FROM trashed_notes WHERE id = ?1",
            params![id],
        )?;
        if inserted == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        tx.execute("DELETE FROM trashed_notes WHERE id = ?1", params![id])?;
        tx.commit()?;
        self.invalidate_cache();
        Ok(())
    }

    pub fn purge_trashed_note(&self, id: &str) -> Result<()> {
        let conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        let deleted = conn.execute("DELETE FROM trashed_notes WHERE id = ?1", params![id])?;
        if deleted == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    pub fn restore_all_trashed_notes(&self) -> Result<usize> {
        let mut conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction()?;
        let restored = tx.execute(
            "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
             SELECT id, title, content, preview, search_text, created_at, updated_at, is_pinned
             FROM trashed_notes",
            [],
        )?;
        tx.execute("DELETE FROM trashed_notes", [])?;
        tx.commit()?;
        if restored > 0 {
            self.invalidate_cache();
        }
        Ok(restored)
    }

    /// Permanently deletes only the notes included in the confirmation.
    pub fn purge_trashed_notes(&self, ids: &[String]) -> Result<usize> {
        let mut conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction()?;
        let mut deleted = 0;
        {
            let mut delete = tx.prepare("DELETE FROM trashed_notes WHERE id = ?1")?;
            for id in ids {
                deleted += delete.execute(params![id])?;
            }
        }
        tx.commit()?;
        Ok(deleted)
    }

    /// Toggles the is_pinned boolean flag for a note and updates meta_cache in-place with re-sorting.
    pub fn toggle_pin(&self, id: &str) -> Result<bool> {
        let conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        let new_pinned = {
            let current: i32 = conn.query_row(
                "SELECT is_pinned FROM notes WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )?;
            let new_pinned = current == 0;
            conn.execute(
                "UPDATE notes SET is_pinned = ?1 WHERE id = ?2",
                params![new_pinned as i32, id],
            )?;
            new_pinned
        };

        // Bump cache generation and patch cache in-place inside the SAME write lock critical section
        if let Ok(mut lock) = self.meta_cache.write() {
            self.cache_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if let Some(ref mut arc) = *lock {
                let vec = Arc::make_mut(arc);
                if let Some(pos) = vec.iter().position(|n| n.id == id) {
                    let mut note = vec.remove(pos);
                    note.is_pinned = new_pinned;
                    insert_sorted(vec, note);
                }
            }
        }

        Ok(new_pinned)
    }
}

#[cfg(test)]
mod tests;
