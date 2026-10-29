use std::path::PathBuf;
use std::time::Instant;
use rusqlite::{Connection, OpenFlags};

fn main() {
    let db_path = PathBuf::from("/tmp/current_bench_dir/raynote.db");
    
    // Ensure file exists
    if !db_path.exists() {
        std::fs::copy("/tmp/synthetic_benchmark.db", &db_path).unwrap();
    }

    println!("--- Profiling Database::new components on /tmp/current_bench_dir/raynote.db ---");
    let t_total = Instant::now();

    let t0 = Instant::now();
    let writer = Connection::open(&db_path).unwrap();
    println!("1. Connection::open: {:.3} ms", t0.elapsed().as_secs_f64() * 1000.0);

    let t1 = Instant::now();
    let _ = writer.pragma_update(None, "journal_mode", "WAL");
    let _ = writer.pragma_update(None, "synchronous", "NORMAL");
    let _ = writer.pragma_update(None, "cache_size", -1000);
    let _ = writer.pragma_update(None, "temp_store", "MEMORY");
    let _ = writer.pragma_update(None, "mmap_size", 0);
    let _ = writer.pragma_update(None, "journal_size_limit", 8388608);
    println!("2. PRAGMAs: {:.3} ms", t1.elapsed().as_secs_f64() * 1000.0);

    let t2 = Instant::now();
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
        CREATE INDEX IF NOT EXISTS idx_notes_covering ON notes(is_pinned DESC, updated_at DESC, id, title, preview, created_at);
        "
    ).unwrap();
    println!("3. execute_batch CREATE TABLE/INDEX: {:.3} ms", t2.elapsed().as_secs_f64() * 1000.0);

    let t3 = Instant::now();
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
    ).unwrap();
    println!("4. execute_batch FTS5 and triggers: {:.3} ms", t3.elapsed().as_secs_f64() * 1000.0);

    let t4 = Instant::now();
    let user_version: i32 = writer.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(0);
    println!("5. PRAGMA user_version query (value={}): {:.3} ms", user_version, t4.elapsed().as_secs_f64() * 1000.0);

    let t5 = Instant::now();
    let notes_count: i64 = writer.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0)).unwrap();
    let fts_count: i64 = writer.query_row("SELECT COUNT(*) FROM notes_fts", [], |r| r.get(0)).unwrap();
    println!("6. Self-heal count query (notes={}, fts={}): {:.3} ms", notes_count, fts_count, t5.elapsed().as_secs_f64() * 1000.0);

    let t6 = Instant::now();
    let reader = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).unwrap();
    let _ = reader.pragma_update(None, "query_only", "true");
    let _ = reader.pragma_update(None, "cache_size", -256);
    println!("7. reader open: {:.3} ms", t6.elapsed().as_secs_f64() * 1000.0);

    println!("Total cold open: {:.3} ms", t_total.elapsed().as_secs_f64() * 1000.0);
}
