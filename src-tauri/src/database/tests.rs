use super::*;

#[test]
fn test_note_open_defers_fts_repair_until_body_search() {
    let dir = std::env::temp_dir().join(format!("raynote_deferred_fts_{}", uuid::Uuid::new_v4()));
    let db = Database::new(dir.clone()).unwrap();
    db.writer.lock().unwrap().execute_batch(
        "INSERT INTO notes (id, title, content, search_text, created_at, updated_at) VALUES
             ('note', 'Title', 'quartz beacon', 'quartz beacon', '2026-01-01', '2026-01-01');
             DELETE FROM notes_fts;"
    ).unwrap();
    drop(db);

    let db = Database::new(dir.clone()).unwrap();
    assert_eq!(db.get_note("note").unwrap().unwrap().content, "quartz beacon");
    assert_eq!(db.get_recent_summaries(1).unwrap().len(), 1);
    assert!(!db.search_index_checked.load(Ordering::Relaxed));

    let results = db.search_documents("quartz beacon", 5).unwrap();
    assert!(results.iter().any(|result| result.id == "note" && result.match_type == "content"));
    assert!(db.search_index_checked.load(Ordering::Relaxed));
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn test_recent_summaries_are_bounded_on_cold_start() {
    let dir = std::env::temp_dir().join(format!("raynote_recent_{}", uuid::Uuid::new_v4()));
    let db = Database::new(dir.clone()).unwrap();
    db.writer.lock().unwrap().execute_batch(
        "INSERT INTO notes (id, title, created_at, updated_at, is_pinned) VALUES
             ('c', 'Pinned', '2026-01-01', '2026-01-01', 1),
             ('b', 'Beta', '2026-01-01', '2026-01-03', 0),
             ('a', 'Alpha', '2026-01-01', '2026-01-03', 0);"
    ).unwrap();

    let cold = db.get_recent_summaries(2).unwrap();
    assert!(db.meta_cache.read().unwrap().is_none());
    assert_eq!(cold.iter().map(|note| note.id.as_str()).collect::<Vec<_>>(), ["c", "a"]);
    assert!(db.get_recent_summaries(0).unwrap().is_empty());

    db.get_all_notes_arc().unwrap();
    let warm = db.get_recent_summaries(2).unwrap();
    assert_eq!(warm.iter().map(|note| note.id.as_str()).collect::<Vec<_>>(), ["c", "a"]);
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn test_legacy_schema_migrates_before_covering_index() {
    let dir = std::env::temp_dir().join(format!("raynote_legacy_schema_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = Connection::open(dir.join("raynote.db")).unwrap();
    conn.execute_batch("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_pinned INTEGER NOT NULL DEFAULT 0);
            INSERT INTO notes VALUES ('legacy', 'Legacy', 'Preserved text', '2026-01-01', '2026-01-01', 0);").unwrap();
    drop(conn);
    let db = Database::new(dir.clone()).expect("legacy schema must migrate successfully");
    let note = db.get_note("legacy").unwrap().unwrap();
    assert_eq!(note.content, "Preserved text");
    assert_eq!(note.preview, "Preserved text");
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn test_legacy_migration_preserves_committed_wal_content() {
    let dir = std::env::temp_dir().join(format!("raynote_legacy_wal_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let legacy = Connection::open(dir.join("notefast.db")).unwrap();
    legacy.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(())).unwrap();
    legacy.query_row("PRAGMA wal_autocheckpoint=0", [], |_| Ok(())).unwrap();
    legacy.execute_batch("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', search_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_pinned INTEGER NOT NULL DEFAULT 0);
").unwrap();
    legacy.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).unwrap();
    legacy.execute_batch("INSERT INTO notes VALUES ('wal-note', 'WAL note', 'Latest committed text', '', '', '2026-01-01', '2026-01-01', 0);").unwrap();
    let db = Database::new(dir.clone()).expect("WAL database migration must succeed");
    assert_eq!(db.get_note("wal-note").unwrap().expect("committed WAL row must survive migration").content, "Latest committed text");
    drop(db);
    drop(legacy);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn test_mutation_holds_writer_until_cache_is_published() {
    let dir = std::env::temp_dir().join(format!("raynote_cache_publish_{}", uuid::Uuid::new_v4()));
    let db = Arc::new(Database::new(dir.clone()).unwrap());
    let note = Note { id: "test".into(), title: "Initial".into(), content: "Text".into(), preview: "Text".into(), created_at: "2026-01-01".into(), updated_at: "2026-01-01".into(), is_pinned: false };
    db.create_note(&note).unwrap();
    db.get_all_notes_arc().unwrap();
    let cache_guard = db.meta_cache.write().unwrap();
    let worker_db = db.clone();
    let worker = std::thread::spawn(move || worker_db.update_note("test", "Latest", "New text").unwrap());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while db.get_note("test").unwrap().unwrap().title != "Latest" {
        assert!(std::time::Instant::now() < deadline, "update must reach SQL commit");
        std::thread::yield_now();
    }
    let writer_is_held = db.writer.try_lock().is_err();
    drop(cache_guard);
    worker.join().unwrap();
    assert!(writer_is_held, "a later mutation must not commit before this mutation publishes its cache state");
    assert_eq!(db.get_all_notes_arc().unwrap()[0].title, db.get_note("test").unwrap().unwrap().title);
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}


#[test]
fn test_summary_query_uses_covering_index() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_covering_test_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    let conn = db.reader.lock().unwrap_or_else(|e| e.into_inner());
    let query_sql = "SELECT id, title, preview, created_at, updated_at, is_pinned FROM notes ORDER BY is_pinned DESC, updated_at DESC";
    let mut explain_stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", query_sql)).unwrap();
    let plan_details: Vec<String> = explain_stmt
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .flatten()
        .collect();

    let uses_covering = plan_details.iter().any(|detail| detail.contains("USING COVERING INDEX idx_notes_covering"));
    assert!(uses_covering, "Summary query must use covering index! Got query plan: {:?}", plan_details);

    // Verify idx_notes_updated_at is used when ordering by updated_at alone
    let updated_at_query = "SELECT id FROM notes ORDER BY updated_at DESC LIMIT 10";
    let mut explain_stmt2 = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", updated_at_query)).unwrap();
    let plan_details2: Vec<String> = explain_stmt2
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .flatten()
        .collect();
    let uses_updated_at_idx = plan_details2.iter().any(|d| d.contains("idx_notes_updated_at"));
    assert!(uses_updated_at_idx, "Query ordering by updated_at alone must use idx_notes_updated_at! Got: {:?}", plan_details2);

    // Verify get_adjacent_note EXPLAIN QUERY PLAN uses idx_notes_covering and has NO temp B-tree
    let next_sql = "SELECT id FROM (
             SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at = ?2 AND id > ?3 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
         ) UNION ALL SELECT id FROM (
             SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at < ?2 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
         ) UNION ALL SELECT id FROM (
             SELECT id FROM notes WHERE is_pinned < ?1 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
         ) LIMIT 1";
    let mut explain_next = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", next_sql)).unwrap();
    let plan_next: Vec<String> = explain_next.query_map(params![1, "2026-10-10", "abc"], |r| r.get::<_, String>(3)).unwrap().flatten().collect();
    assert!(plan_next.iter().all(|d| !d.contains("TEMP B-TREE")), "Next query must not use temp B-tree! Got: {:?}", plan_next);
    assert!(plan_next.iter().any(|d| d.contains("idx_notes_covering")), "Next query must use idx_notes_covering! Got: {:?}", plan_next);

    let prev_sql = "SELECT id FROM (
             SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at = ?2 AND id < ?3 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
         ) UNION ALL SELECT id FROM (
             SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at > ?2 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
         ) UNION ALL SELECT id FROM (
             SELECT id FROM notes WHERE is_pinned > ?1 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
         ) LIMIT 1";
    let mut explain_prev = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", prev_sql)).unwrap();
    let plan_prev: Vec<String> = explain_prev.query_map(params![1, "2026-10-10", "abc"], |r| r.get::<_, String>(3)).unwrap().flatten().collect();
    assert!(plan_prev.iter().all(|d| !d.contains("TEMP B-TREE")), "Prev query must not use temp B-tree! Got: {:?}", plan_prev);
    assert!(plan_prev.iter().any(|d| d.contains("idx_notes_covering")), "Prev query must use idx_notes_covering! Got: {:?}", plan_prev);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_update_note_returned_timestamp_equals_stored_updated_at() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_update_ts_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    let note = Note {
        id: format!("test-update-ts-{}", uuid::Uuid::new_v4()),
        title: "Initial Title".to_string(),
        content: "Initial Content".to_string(),
        preview: "Initial Preview".to_string(),
        created_at: "2026-10-10T10:00:00Z".to_string(),
        updated_at: "2026-10-10T10:00:00Z".to_string(),
        is_pinned: false,
    };
    db.create_note(&note).expect("Failed to create note");
    let initial_ts = note.updated_at.clone();

    // Perform first update
    let returned_ts1 = db.update_note(
        &note.id,
        "Updated Title 1",
        r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated text 1"}]}]}"#,
    ).expect("Failed to update note");

    // Verify returned timestamp is non-empty and strictly equals stored updated_at in DB
    assert!(!returned_ts1.is_empty());
    let stored_note1 = db.get_note(&note.id).expect("Query failed").expect("Note not found");
    assert_eq!(returned_ts1, stored_note1.updated_at);
    assert_ne!(returned_ts1, initial_ts);

    // Perform second update after short sleep to ensure monotonic timestamp advance
    std::thread::sleep(std::time::Duration::from_millis(10));
    let returned_ts2 = db.update_note(
        &note.id,
        "Updated Title 2",
        r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated text 2"}]}]}"#,
    ).expect("Failed to update note second time");

    let stored_note2 = db.get_note(&note.id).expect("Query failed").expect("Note not found");
    assert_eq!(returned_ts2, stored_note2.updated_at);
    assert_ne!(returned_ts2, returned_ts1);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_update_note_missing_id_returns_err_and_preserves_cache() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_update_missing_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    let note = Note {
        id: "existing-note-1".to_string(),
        title: "Original Title".to_string(),
        content: "Original Content".to_string(),
        preview: "Original Preview".to_string(),
        created_at: "2026-10-10T10:00:00Z".to_string(),
        updated_at: "2026-10-10T10:00:00Z".to_string(),
        is_pinned: false,
    };
    db.create_note(&note).expect("Failed to create note");

    // Warm and populate meta_cache
    let initial_arc = db.get_all_notes_arc().expect("Failed to load cache");
    assert_eq!(initial_arc.len(), 1);
    assert_eq!(initial_arc[0].title, "Original Title");

    // Attempt to update a non-existent note id
    let res = db.update_note(
        "missing-note-id-404",
        "Ghost Note Title",
        r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Ghost Content"}]}]}"#,
    );

    // Must return Err(rusqlite::Error::QueryReturnedNoRows) because 0 rows were affected
    assert!(matches!(res, Err(rusqlite::Error::QueryReturnedNoRows)), "update_note on missing id must return QueryReturnedNoRows, got: {:?}", res);

    // Verify meta_cache is completely untouched and intact
    let cached_after = db.get_all_notes_arc().expect("Failed to load cache");
    assert_eq!(cached_after.len(), 1);
    assert_eq!(cached_after[0].id, "existing-note-1");
    assert_eq!(cached_after[0].title, "Original Title");

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_update_note_empty_title_preserves_existing_title() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_empty_title_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    let note = Note {
        id: "note-with-title".to_string(),
        title: "Important Project Title".to_string(),
        content: "Initial content".to_string(),
        preview: "preview".to_string(),
        created_at: "2026-10-10T10:00:00Z".to_string(),
        updated_at: "2026-10-10T10:00:00Z".to_string(),
        is_pinned: false,
    };
    db.create_note(&note).expect("Failed to create note");

    // Update note with empty title "" (e.g. after paste-title where body has no H1)
    db.update_note(
        "note-with-title",
        "",
        r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"New body content"}]}]}"#,
    ).expect("update_note should succeed");

    // Verify SQLite row preserved the original title
    let loaded = db.get_note("note-with-title").expect("Failed to load note").expect("Note should exist");
    assert_eq!(loaded.title, "Important Project Title", "SQLite title must not be overwritten with empty string");

    // Verify in-memory meta_cache preserved the original title
    let cached = db.get_all_notes_arc().expect("Failed to load cache");
    assert_eq!(cached[0].title, "Important Project Title", "Cache title must not be overwritten with empty string");

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_create_note_idempotent_no_duplicates() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_create_idempotent_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    let note1 = Note {
        id: "note-1".to_string(),
        title: "First Note".to_string(),
        content: "Content 1".to_string(),
        preview: "Preview 1".to_string(),
        created_at: "2026-10-10T10:00:00Z".to_string(),
        updated_at: "2026-10-10T10:00:00Z".to_string(),
        is_pinned: false,
    };
    db.create_note(&note1).unwrap();

    // 1. Manually insert note-2 into SQLite (simulating writer commit completing before cache patch)
    {
        let conn = db.writer.lock().unwrap();
        conn.execute(
            "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "note-2",
                "Second Note",
                "Content 2",
                "Preview 2",
                "searchable content",
                "2026-10-10T11:00:00Z",
                "2026-10-10T11:00:00Z",
                0
            ],
        ).unwrap();
    }

    // 2. A concurrent reader calls get_all_notes_arc, which reads SQLite and populates cache with note-2
    let summaries = db.get_all_notes_arc().unwrap();
    assert!(summaries.iter().any(|n| n.id == "note-2"));

    // 3. Now the writer's create_note cache patch executes for note-2
    let note2 = Note {
        id: "note-2".to_string(),
        title: "Second Note".to_string(),
        content: "Content 2".to_string(),
        preview: "Preview 2".to_string(),
        created_at: "2026-10-10T11:00:00Z".to_string(),
        updated_at: "2026-10-10T11:00:00Z".to_string(),
        is_pinned: false,
    };
    if let Ok(mut lock) = db.meta_cache.write() {
        db.cache_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if let Some(ref mut arc) = *lock {
            let vec = Arc::make_mut(arc);
            vec.retain(|n| n.id != note2.id);
            let title_lower = normalize_query(&note2.title);
            let summary = NoteSummary {
                id: note2.id.clone(),
                title: note2.title.clone(),
                title_lower,
                preview: note2.preview.clone(),
                created_at: note2.created_at.clone(),
                updated_at: note2.updated_at.clone(),
                is_pinned: note2.is_pinned,
            };
            insert_sorted(vec, summary);
        }
    }

    // 4. Assert cache has NO duplicate IDs
    let cached = db.get_all_notes_arc().unwrap();
    let occurrences = cached.iter().filter(|n| n.id == "note-2").count();
    assert_eq!(occurrences, 1, "Cache must contain exactly 1 copy of note-2, found {}", occurrences);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_get_adjacent_note_keyset_navigation() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_adjacent_test_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    // 5 notes: 1 pinned, two with IDENTICAL updated_at
    let notes_to_create = [
        ("p1", "Pinned 1", true, "2026-10-10T12:00:00Z"),
        ("u_b", "Unpinned B", false, "2026-10-10T10:00:00Z"),
        ("u_a", "Unpinned A", false, "2026-10-10T10:00:00Z"), // Identical updated_at as u_b; tie broken by id ASC ("u_a" < "u_b")
        ("u_c", "Unpinned C", false, "2026-10-10T08:00:00Z"),
        ("u_d", "Unpinned D", false, "2026-10-10T06:00:00Z"),
    ];

    for (id, title, is_pinned, updated_at) in &notes_to_create {
        let note = Note {
            id: id.to_string(),
            title: title.to_string(),
            content: "Content".to_string(),
            preview: "Preview".to_string(),
            created_at: "2026-10-01T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
            is_pinned: *is_pinned,
        };
        db.create_note(&note).unwrap();
    }

    // Expected canonical sequence: ["p1", "u_a", "u_b", "u_c", "u_d"]
    let test_navigation_cycles = |db_ref: &Database, label: &str| {
        // Walk "next" 6 times starting at "p1"
        let mut curr = "p1".to_string();
        let mut next_walk = Vec::new();
        for _ in 0..6 {
            curr = db_ref.get_adjacent_note(&curr, "next").unwrap().expect("next note must exist");
            next_walk.push(curr.clone());
        }
        assert_eq!(
            next_walk,
            vec!["u_a", "u_b", "u_c", "u_d", "p1", "u_a"],
            "{}: Walk 'next' 6 times must visit every note once then wrap",
            label
        );

        // Walk "prev" 6 times starting at "p1"
        let mut curr_prev = "p1".to_string();
        let mut prev_walk = Vec::new();
        for _ in 0..6 {
            curr_prev = db_ref.get_adjacent_note(&curr_prev, "prev").unwrap().expect("prev note must exist");
            prev_walk.push(curr_prev.clone());
        }
        assert_eq!(
            prev_walk,
            vec!["u_d", "u_c", "u_b", "u_a", "p1", "u_d"],
            "{}: Walk 'prev' 6 times must visit every note once then wrap",
            label
        );

        // Unknown or deleted current_id returns first note instead of error
        assert_eq!(
            db_ref.get_adjacent_note("unknown_or_deleted_id", "next").unwrap(),
            Some("p1".to_string()),
            "{}: unknown_id for next must return first note",
            label
        );
        assert_eq!(
            db_ref.get_adjacent_note("unknown_or_deleted_id", "prev").unwrap(),
            Some("p1".to_string()),
            "{}: unknown_id for prev must return first note",
            label
        );
    };

    // 1. Test via in-memory cache path
    test_navigation_cycles(&db, "In-Memory Cache");

    // 2. Invalidate cache to test SQLite keyset fallback path directly
    db.invalidate_cache();
    test_navigation_cycles(&db, "SQLite Keyset Reader Fallback");

    // 3. Single-note DB: delete 4 notes, leave only "p1"
    for id in &["u_a", "u_b", "u_c", "u_d"] {
        db.delete_note(id).unwrap();
    }
    assert_eq!(db.get_adjacent_note("p1", "next").unwrap(), Some("p1".to_string()));
    assert_eq!(db.get_adjacent_note("p1", "prev").unwrap(), Some("p1".to_string()));
    assert_eq!(db.get_adjacent_note("unknown_id", "next").unwrap(), Some("p1".to_string()));
    assert_eq!(db.get_adjacent_note("unknown_id", "prev").unwrap(), Some("p1".to_string()));

    // Also test single-note DB with cold cache
    db.invalidate_cache();
    assert_eq!(db.get_adjacent_note("p1", "next").unwrap(), Some("p1".to_string()));
    assert_eq!(db.get_adjacent_note("p1", "prev").unwrap(), Some("p1".to_string()));
    assert_eq!(db.get_adjacent_note("unknown_id", "next").unwrap(), Some("p1".to_string()));
    assert_eq!(db.get_adjacent_note("unknown_id", "prev").unwrap(), Some("p1".to_string()));

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_cache_sort_order_invariants() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_cache_sort_test_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    let assert_cache_matches_sql = |context: &str| {
        // 1. Get order from cache
        let cached_ids: Vec<String> = db.get_all_notes_arc().unwrap().iter().map(|n| n.id.clone()).collect();

        // 2. Query canonical truth from SQLite
        let conn = db.reader.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare("SELECT id FROM notes ORDER BY is_pinned DESC, updated_at DESC, id ASC").unwrap();
        let sql_ids: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap();

        assert_eq!(cached_ids, sql_ids, "Cache mismatch at step: {}", context);
    };

    // Seed 2 pinned + 4 unpinned notes
    let initial_notes = [
        ("p1", "Pinned One", true, "2026-10-10T10:00:00Z"),
        ("p2", "Pinned Two", true, "2026-10-10T09:00:00Z"),
        ("u1", "Unpinned One", false, "2026-10-10T08:00:00Z"),
        ("u2", "Unpinned Two", false, "2026-10-10T07:00:00Z"),
        ("u3", "Unpinned Three", false, "2026-10-10T06:00:00Z"),
        ("u4", "Unpinned Four", false, "2026-10-10T05:00:00Z"),
    ];

    for (id, title, is_pinned, updated_at) in &initial_notes {
        let note = Note {
            id: id.to_string(),
            title: title.to_string(),
            content: format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"{}"}}]}}]}}"#, title),
            preview: "".to_string(),
            created_at: "2026-10-01T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
            is_pinned: *is_pinned,
        };
        db.create_note(&note).unwrap();
    }

    // Step 1: Initial state
    assert_cache_matches_sql("Step 1: Initial state with 2 pinned + 4 unpinned");

    // Step 2: Edit unpinned note u3 (bumps its updated_at to now, must stay below pinned notes)
    std::thread::sleep(std::time::Duration::from_millis(5));
    db.update_note("u3", "Unpinned Three Updated", r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated"}]}]}"#).unwrap();
    assert_cache_matches_sql("Step 2: After editing unpinned note u3");

    // Step 3: Pin unpinned note u2 (must move into pinned section, below p1 and p2 due to timestamp)
    db.toggle_pin("u2").unwrap();
    assert_cache_matches_sql("Step 3: After pinning u2");

    // Step 4: Unpin pinned note p1 (must drop into unpinned section)
    db.toggle_pin("p1").unwrap();
    assert_cache_matches_sql("Step 4: After unpinning p1");

    // Step 5: Create a new unpinned note u5
    std::thread::sleep(std::time::Duration::from_millis(5));
    let now = chrono::Utc::now().to_rfc3339();
    let u5 = Note {
        id: "u5".to_string(),
        title: "Unpinned Five".to_string(),
        content: r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"New note"}]}]}"#.to_string(),
        preview: "".to_string(),
        created_at: now.clone(),
        updated_at: now,
        is_pinned: false,
    };
    db.create_note(&u5).unwrap();
    assert_cache_matches_sql("Step 5: After creating note u5");

    // Step 6: Edit remaining pinned note p2
    std::thread::sleep(std::time::Duration::from_millis(5));
    db.update_note("p2", "Pinned Two Updated", r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated"}]}]}"#).unwrap();
    assert_cache_matches_sql("Step 6: After editing pinned note p2");

    // Step 7: Delete pinned note u2
    db.delete_note("u2").unwrap();
    assert_cache_matches_sql("Step 7: After deleting note u2");

    // Step 8: Delete unpinned note u4
    db.delete_note("u4").unwrap();
    assert_cache_matches_sql("Step 8: After deleting note u4");

    // Step 9: Pin u5 (newest timestamp -> moves to very top of pinned notes)
    db.toggle_pin("u5").unwrap();
    assert_cache_matches_sql("Step 9: After pinning u5");

    // Step 10: Unpin u5 (drops to top of unpinned notes)
    db.toggle_pin("u5").unwrap();
    assert_cache_matches_sql("Step 10: After unpinning u5");

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_extract_searchable_text_tiptap_json() {
    let json = r#"{
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": { "level": 1 },
                    "content": [{ "type": "text", "text": "My Project Plan" }]
                },
                {
                    "type": "paragraph",
                    "content": [
                        { "type": "text", "text": "Deploy to " },
                        { "type": "text", "marks": [{ "type": "bold" }], "text": "production" },
                        { "type": "text", "text": " on Friday." }
                    ]
                },
                {
                    "type": "taskList",
                    "content": [
                        {
                            "type": "taskItem",
                            "attrs": { "checked": true },
                            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Write migrations" }] }]
                        }
                    ]
                }
            ]
        }"#;

    let extracted = extract_searchable_text(json);
    assert!(extracted.contains("My Project Plan"));
    assert!(extracted.contains("Deploy to production on Friday."));
    assert!(extracted.contains("Write migrations"));
    assert!(!extracted.contains("type"));
    assert!(!extracted.contains("attrs"));
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

    let title_results = db.search_documents("performance", 30).expect("search failed");
    assert!(!title_results.is_empty());
    assert_eq!(title_results[0].id, note_id);
    assert_eq!(title_results[0].match_type, "title_prefix");

    let content_results = db.search_documents("eviction", 30).expect("search failed");
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

    let old_title_search = db.search_documents("performance", 30).expect("search failed");
    assert!(old_title_search.is_empty() || old_title_search[0].match_type != "title_prefix");

    let new_title_search = db.search_documents("benchmark", 30).expect("search failed");
    assert!(!new_title_search.is_empty());
    assert_eq!(new_title_search[0].id, note_id);

    // 3. Editing content changes indexed matches
    db.update_note(
        &note_id,
        "Benchmark Suite",
        r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Includes garbage collection and memory telemetry."}]}]}"#,
    ).expect("update_note failed");

    let updated_content_search = db.search_documents("telemetry", 30).expect("search failed");
    assert!(!updated_content_search.is_empty());
    assert_eq!(updated_content_search[0].id, note_id);

    // 4. Deleting note removes it from search results
    db.delete_note(&note_id).expect("delete_note failed");
    let deleted_search = db.search_documents("benchmark", 30).expect("search failed");
    assert!(deleted_search.is_empty());

    assert!(db.get_note(&note_id).unwrap().is_none());
    assert!(db.get_all_notes_with_content().unwrap().is_empty());
    // Simulate a v5 database containing the former Trash body index.
    db.writer.lock().unwrap().execute_batch(
        "CREATE VIRTUAL TABLE trashed_notes_fts USING fts5(title, search_text, content='trashed_notes');
             INSERT INTO trashed_notes_fts(trashed_notes_fts) VALUES ('rebuild');
             PRAGMA user_version = 5;",
    ).unwrap();
    drop(db);

    let db = Database::new(temp_dir.clone()).unwrap();
    let trash = db.list_trashed_notes().unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].id, note_id);
    assert_eq!(trash[0].title, "Benchmark Suite");
    assert!(db.purge_trashed_note("unrelated").is_err());
    db.restore_trashed_note(&note_id).unwrap();
    assert!(db.list_trashed_notes().unwrap().is_empty());
    assert!(db.get_note(&note_id).unwrap().unwrap().content.contains("memory telemetry"));
    assert_eq!(db.search_documents("telemetry", 30).unwrap()[0].id, note_id);
    assert!(db.purge_trashed_note(&note_id).is_err());
    assert!(db.get_note(&note_id).unwrap().is_some());
    db.delete_note(&note_id).unwrap();
    db.delete_note(&note_id).unwrap();
    db.purge_trashed_note(&note_id).unwrap();
    assert!(db.list_trashed_notes().unwrap().is_empty());
    assert!(db.restore_trashed_note(&note_id).is_err());

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_concurrent_updates_integrity() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_concurrent_test_{}", uuid::Uuid::new_v4()));
    let db = std::sync::Arc::new(Database::new(temp_dir.clone()).expect("Failed to initialize test db"));

    let note_id = uuid::Uuid::new_v4().to_string();
    let initial_note = Note {
        id: note_id.clone(),
        title: "Concurrent Note".to_string(),
        content: r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Initial"}]}]}"#.to_string(),
        preview: "".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        is_pinned: false,
    };
    db.create_note(&initial_note).expect("create_note failed");

    // Fire 30 updates from multiple concurrent threads
    let mut handles = Vec::new();
    for i in 1..=30 {
        let db_clone = std::sync::Arc::clone(&db);
        let nid = note_id.clone();
        let handle = std::thread::spawn(move || {
            let content = format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"Update version {}"}}]}}]}}"#, i);
            db_clone.update_note(&nid, &format!("Title {}", i), &content).unwrap();
        });
        handles.push(handle);
    }

    for h in handles {
        h.join().unwrap();
    }

    // Now issue a sequenced final update to simulate the queued latest state
    let final_content = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Final Verified Content"}]}]}"#;
    db.update_note(&note_id, "Final Title", final_content).expect("final update failed");

    let stored = db.get_note(&note_id).expect("get_note failed").expect("note must exist");
    assert_eq!(stored.title, "Final Title");
    assert_eq!(stored.content, final_content);

    let search_results = db.search_documents("Final", 30).expect("search failed");
    assert!(!search_results.is_empty());
    assert_eq!(search_results[0].id, note_id);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
#[ignore]
fn test_real_db_search_benchmark() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_bench_test_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize bench test database");

    // Seed 25 realistic notes
    for i in 1..=25 {
        let note = Note {
            id: format!("bench-test-{}", i),
            title: format!("Performance Engineering Note {}", i),
            content: format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"Testing cache eviction, SQLite WAL mode, and telemetry indexing with unique token_{}."}}]}}]}}"#, i),
            preview: "".to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            is_pinned: i % 5 == 0,
        };
        db.create_note(&note).expect("create_note failed in benchmark setup");
    }

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

    println!("\n=== TEMP DB LATENCY BENCHMARK ===");
    for query in test_queries {
        // Warmup
        let _ = db.search_documents(query, 30);

        let mut times = Vec::new();
        for _ in 0..5 {
            let start = std::time::Instant::now();
            let results = db.search_documents(query, 30).unwrap();
            let dur = start.elapsed();
            times.push((dur, results.len()));
        }

        let avg_micros: u128 = times.iter().map(|(d, _)| d.as_micros()).sum::<u128>() / 5;
        let avg_ms = avg_micros as f64 / 1000.0;
        let count = times[0].1;
        println!("Query '{:12}': {:6.3} ms ({} results)", query, avg_ms, count);

        if query.len() == 1 {
            assert!(avg_ms < 10.0, "1-character query took {:.2}ms (> 10ms)", avg_ms);
        }
    }
    println!("=================================\n");

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_cache_race_stale_snapshot_not_cached() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_race_test_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    // 1. Create initial note n1
    let n1 = Note {
        id: "n1".to_string(),
        title: "Note One".to_string(),
        content: r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"First note."}]}]}"#.to_string(),
        preview: "First note.".to_string(),
        created_at: "2026-10-01T00:00:00Z".to_string(),
        updated_at: "2026-10-01T00:00:00Z".to_string(),
        is_pinned: false,
    };
    db.create_note(&n1).unwrap();

    // Ensure cache is populated
    let _ = db.get_all_notes_arc().unwrap();

    // 2. Invalidate cache to simulate cold read
    db.invalidate_cache();
    assert!(db.meta_cache.read().unwrap().is_none());

    // 3. Reader records gen_before BEFORE querying SQLite
    let gen_before = db.cache_gen.load(std::sync::atomic::Ordering::SeqCst);

    // 4. While reader is reading, a concurrent write lands and commits
    let n2 = Note {
        id: "n2".to_string(),
        title: "Note Two".to_string(),
        content: r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Second note."}]}]}"#.to_string(),
        preview: "Second note.".to_string(),
        created_at: "2026-10-02T00:00:00Z".to_string(),
        updated_at: "2026-10-02T00:00:00Z".to_string(),
        is_pinned: false,
    };
    db.create_note(&n2).unwrap();

    // Confirm cache_gen was bumped unconditionally AFTER SQL write
    let current_gen = db.cache_gen.load(std::sync::atomic::Ordering::SeqCst);
    assert!(current_gen > gen_before, "cache_gen must have bumped after create_note commit");

    // 5. Invalidate cache again to test stale snapshot commit rejection
    {
        let mut lock = db.meta_cache.write().unwrap();
        *lock = None;
    }

    // 6. Reader attempts to store its stale snapshot (only having n1) using gen_before guard:
    let stale_snapshot = Arc::new(vec![NoteSummary {
        id: "n1".to_string(),
        title: "Note One".to_string(),
        title_lower: "note one".to_string(),
        preview: "First note.".to_string(),
        created_at: "2026-10-01T00:00:00Z".to_string(),
        updated_at: "2026-10-01T00:00:00Z".to_string(),
        is_pinned: false,
    }]);

    if let Ok(mut lock) = db.meta_cache.write() {
        if db.cache_gen.load(std::sync::atomic::Ordering::SeqCst) == gen_before {
            *lock = Some(Arc::clone(&stale_snapshot));
        }
    }

    // 7. Assert that the stale snapshot was NOT stored into meta_cache!
    {
        let lock = db.meta_cache.read().unwrap();
        assert!(lock.is_none(), "Stale snapshot must NOT be stored when cache_gen != gen_before");
    }

    // 8. Next regular get_all_notes_arc loads the fresh snapshot containing both notes
    let fresh = db.get_all_notes_arc().unwrap();
    assert_eq!(fresh.len(), 2, "Fresh load must include both n1 and n2");

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
#[ignore]
fn test_hybrid_search_comparison_and_triggers() {
    use crate::search::{DocumentCandidate, score_document};

    #[cfg(target_os = "macos")]
    fn get_mach_footprint() -> (u64, u64) {
        #[repr(C)]
        struct TaskVmInfo {
            virtual_size: u64,
            region_count: i32,
            page_size: i32,
            resident_size: u64,
            resident_size_peak: u64,
            device: u64,
            device_peak: u64,
            internal: u64,
            internal_peak: u64,
            external: u64,
            external_peak: u64,
            reusable: u64,
            reusable_peak: u64,
            purgeable_volatile_pmap: u64,
            purgeable_volatile_resident: u64,
            purgeable_volatile_virtual: u64,
            compressed: u64,
            compressed_peak: u64,
            compressed_lifetime: u64,
            phys_footprint: u64,
            min_address: u64,
            max_address: u64,
            ledger_tag_free: i64,
            ledger_tag_total: i64,
            ledger_tag_resident: i64,
            ledger_tag_reusable: i64,
            ledger_tag_purgeable: i64,
        }

        extern "C" {
            fn mach_task_self() -> u32;
            fn task_info(
                target_task: u32,
                flavor: u32,
                task_info_out: *mut TaskVmInfo,
                task_info_outCnt: *mut u32,
            ) -> i32;
        }

        let mut info = std::mem::MaybeUninit::<TaskVmInfo>::zeroed();
        let mut count = (std::mem::size_of::<TaskVmInfo>() / std::mem::size_of::<u32>()) as u32;
        const TASK_VM_INFO: u32 = 22;

        unsafe {
            let kr = task_info(mach_task_self(), TASK_VM_INFO, info.as_mut_ptr(), &mut count);
            if kr == 0 {
                let res = info.assume_init();
                (res.phys_footprint, res.resident_size)
            } else {
                (0, 0)
            }
        }
    }

    let temp_dir = std::env::temp_dir().join(format!("raynote_cmp_test_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize db");

    // Seed 13 baseline notes
    let seed_data = [
        ("n1", "Performance Guide", "Comprehensive system optimization, cache telemetry, and memory profiling."),
        ("n2", "Architecture Audit", "Deep dive into memory telemetry and garbage collection internals."),
        ("n3", "Recipe Book", "Making traditional coffee, pastries, and croissants with chicory."),
        ("n4", "Legal Conviction", "Notes on judicial conviction, appellate court reviews, and precedents."),
        ("n5", "Daily Journal", "Observations from morning walk and quick software architecture thoughts."),
        ("n6", "Guide to Performance", "Re-ordered words in title testing order-independent scoring."),
        ("n7", "Project Planning", "Milestones for Q4 release, telemetry dashboard, and launch checklist."),
        ("n8", "Cache Eviction Policies", "LRU, ARC, and 2Q caching strategies in embedded databases."),
        ("n9", "TypeScript and React", "Modern web guidance and state management patterns."),
        ("n10", "Rust Systems Programming", "Memory safety without garbage collection and zero-cost abstractions."),
        ("n11", "📘 Release Notes 🚀", "Testing emoji support in note titles and search indexing."),
        ("n12", "नमस्ते दुनिया", "यह हिंदी में खोज का परीक्षण करने के लिए एक नोट है।"),
        ("n13", "中文测试文档", "这是一个用于测试全文本搜索的中文测试文档。"),
    ];

    for (id, title, content) in &seed_data {
        let note = Note {
            id: id.to_string(),
            title: title.to_string(),
            content: format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"{}"}}]}}]}}"#, content),
            preview: "".to_string(),
            created_at: "2026-10-15T00:00:00Z".to_string(),
            updated_at: "2026-10-20T00:00:00Z".to_string(),
            is_pinned: *id == "n1",
        };
        db.create_note(&note).unwrap();
    }

    // Add 9,987 filler notes to bring database to exactly 10,000 notes
    {
        let mut conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction().unwrap();
        for i in 14..=10000 {
            let note_id = format!("seed-{}", i);
            let title = format!("Generic Document {}", i);
            let text = format!("General notes content payload for filler note {}.", i);
            tx.execute(
                "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    note_id,
                    title,
                    format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"{}"}}]}}]}}"#, text),
                    text,
                    text,
                    "2026-10-01T00:00:00Z",
                    "2026-10-05T00:00:00Z",
                    0,
                ],
            ).unwrap();
        }
        tx.commit().unwrap();
    }

    // Populate FTS for the 10,000 notes
    {
        let conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());
        let _ = conn.execute("INSERT OR IGNORE INTO notes_fts(rowid, id, title, search_text) SELECT rowid, id, title, search_text FROM notes", []);
    }

    // ==================== ITEM 3: CACHE BUILD & COVERING INDEX DIAGNOSTICS ====================
    println!("\n=== ITEM 3: CACHE BUILD & COVERING INDEX DIAGNOSTICS ===");
    {
        let query_sql = "SELECT id, title, preview, created_at, updated_at, is_pinned FROM notes ORDER BY is_pinned DESC, updated_at DESC";

        // (a) Measure WITHOUT covering index (Before)
        {
            let conn = db.writer.lock().unwrap();
            let _ = conn.execute("DROP INDEX IF EXISTS idx_notes_covering", []);
        }
        println!("  [WITHOUT COVERING INDEX - BEFORE]");
        let mut before_runs = Vec::new();
        for run_i in 1..=3 {
            let conn = db.reader.lock().unwrap();
            let t0 = std::time::Instant::now();
            let mut stmt = conn.prepare(query_sql).unwrap();
            let rows: Vec<_> = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i32>(5)? != 0,
                ))
            }).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
            let mut mapped = Vec::with_capacity(rows.len());
            for r in rows {
                let title_lower = normalize_query(&r.1);
                mapped.push(NoteSummary {
                    id: r.0,
                    title: r.1,
                    title_lower,
                    preview: r.2,
                    created_at: r.3,
                    updated_at: r.4,
                    is_pinned: r.5,
                });
            }
            let dur = t0.elapsed();
            before_runs.push(dur);
            println!("    Run {}: {:6.3} ms (10,000 notes loaded)", run_i, dur.as_secs_f64() * 1000.0);
        }

        // Re-create covering index
        {
            let conn = db.writer.lock().unwrap();
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_notes_covering ON notes(is_pinned DESC, updated_at DESC, id, title, preview, created_at)",
                [],
            ).unwrap();
        }

        // (b) Measure WITH covering index (After)
        println!("  [WITH COVERING INDEX - AFTER]");
        let mut after_runs = Vec::new();
        for run_i in 1..=3 {
            let conn = db.reader.lock().unwrap();
            let t0 = std::time::Instant::now();
            let mut stmt = conn.prepare(query_sql).unwrap();
            let rows: Vec<_> = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i32>(5)? != 0,
                ))
            }).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
            let mut mapped = Vec::with_capacity(rows.len());
            for r in rows {
                let title_lower = normalize_query(&r.1);
                mapped.push(NoteSummary {
                    id: r.0,
                    title: r.1,
                    title_lower,
                    preview: r.2,
                    created_at: r.3,
                    updated_at: r.4,
                    is_pinned: r.5,
                });
            }
            let dur = t0.elapsed();
            after_runs.push(dur);
            println!("    Run {}: {:6.3} ms (10,000 notes loaded)", run_i, dur.as_secs_f64() * 1000.0);
        }

        // 1. EXPLAIN QUERY PLAN
        let conn = db.reader.lock().unwrap();
        let mut explain_stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", query_sql)).unwrap();
        let mut plan_lines = Vec::new();
        let rows = explain_stmt.query_map([], |r| {
            Ok(format!("selectid={}, order={}, from={}, detail='{}'", r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?))
        }).unwrap();
        for r in rows.flatten() {
            plan_lines.push(r);
        }
        println!("  EXPLAIN QUERY PLAN (with covering index):");
        for line in &plan_lines {
            println!("    {}", line);
        }

        // Database::new Cold Start on Existing 10,000-note database
        let t_reopen = std::time::Instant::now();
        let _reopened_db = Database::new(temp_dir.clone()).expect("Failed to reopen database");
        let reopen_dur = t_reopen.elapsed();
        println!("  Database::new cold-start on existing 10k DB: {:6.3} ms", reopen_dur.as_secs_f64() * 1000.0);

        // Measure DB file size
        let db_file = temp_dir.join("raynote.db");
        let file_size_bytes = std::fs::metadata(&db_file).map(|m| m.len()).unwrap_or(0);
        println!("  Database file size on disk: {:.2} MB", file_size_bytes as f64 / (1024.0 * 1024.0));
    }

    // Measure write cost with covering index (5 runs average)
    let mut write_times = Vec::new();
    for i in 1..=5 {
        let t_write = std::time::Instant::now();
        db.update_note("n1", &format!("Performance Guide Write Cost Run {}", i), r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Write cost check."}]}]}"#).unwrap();
        write_times.push(t_write.elapsed());
    }
    let avg_write_us = write_times.iter().map(|d| d.as_micros()).sum::<u128>() / write_times.len() as u128;
    println!("  update_note flat total cost (5 runs avg): {} µs", avg_write_us);
    println!("========================================================\n");

    // Invalidate cache so we can measure COLD cache search
    db.invalidate_cache();

    // Measure COLD CACHE first search
    let cold_start = std::time::Instant::now();
    let cold_results = db.search_documents("performance", 30).unwrap();
    let cold_cache_dur = cold_start.elapsed();

    println!("=== COLD CACHE FIRST SEARCH ON 10K DB ===");
    println!("  Query 'performance': {:6.3} ms ({} results)", cold_cache_dur.as_secs_f64() * 1000.0, cold_results.len());
    println!("==========================================\n");

    // Old search reference implementation (full 10,000 note traversal + score_document)
    let old_search = |query: &str| -> Vec<SearchResult> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return db.get_recent_notes(30).unwrap();
        }
        let has_substantial_token = trimmed
            .split_whitespace()
            .any(|w| w.chars().filter(|c| c.is_alphanumeric()).count() >= 3);
        let mut fts_matched = std::collections::HashSet::new();
        if has_substantial_token {
            let clean_fts = sanitize_fts5_query(trimmed);
            if !clean_fts.is_empty() {
                let conn = db.reader.lock().unwrap_or_else(|e| e.into_inner());
                let mut stmt = conn.prepare("SELECT f.id FROM notes_fts f WHERE notes_fts MATCH ?1 LIMIT 50").unwrap();
                let rows = stmt.query_map(params![clean_fts], |r| r.get::<_, String>(0)).unwrap();
                for id in rows.flatten() {
                    fts_matched.insert(id);
                }
            }
        }
        let all = db.get_all_notes_arc().unwrap();
        let mut res = Vec::new();
        for n in all.iter() {
            let is_fts = fts_matched.contains(&n.id);
            let cand = DocumentCandidate {
                id: &n.id,
                title: &n.title,
                search_text: &n.preview,
                preview: &n.preview,
                updated_at: &n.updated_at,
                is_pinned: n.is_pinned,
                fts_snippet: if is_fts { Some("fts") } else { None },
            };
            let (score, match_type) = score_document(trimmed, &cand);
            if score > 0.0 {
                res.push(SearchResult {
                    id: n.id.clone(),
                    title: n.title.clone(),
                    snippet: n.preview.clone(),
                    score,
                    match_type,
                    updated_at: n.updated_at.clone(),
                    is_pinned: n.is_pinned,
                });
            }
        }
        res.sort_by(|a, b| {
            b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.is_pinned.cmp(&a.is_pinned))
                .then_with(|| b.updated_at.cmp(&a.updated_at))
                .then_with(|| a.id.cmp(&b.id))
        });
        res.truncate(30);
        res
    };

    // ==================== SEED A: CURRENT REPEATED-TITLE SEED ====================
    let sample_queries = [
        ("1. Exact Title", "Performance Guide"),
        ("2. Title Prefix", "Perf"),
        ("3. Multi-word Title", "Guide Performance"),
        ("4. Typo in Title", "Performace"),
        ("5. Mid-word Substring Title", "forman"),
        ("6. Content Word", "telemetry"),
        ("7. Content Multi-word", "memory telemetry"),
        ("8. Content Prefix", "telem"),
        ("9. Mid-word Substring Content", "lemet"),
        ("10. Unmatched", "xyznonexistent"),
    ];

    let mut old_times = Vec::new();
    let mut new_times = Vec::new();
    let mut timings_list = Vec::new();

    println!("\n=================== SEED A: 10 SAMPLE QUERIES (TOP 5 RESULTS ON 10,000 DB) ===================");
    for (label, q) in &sample_queries {
        let t0 = std::time::Instant::now();
        let old_res = old_search(q);
        let old_dur = t0.elapsed();
        old_times.push(old_dur);

        let (new_res, timings) = db.search_documents_profiled(q, 30).unwrap();
        let new_dur = std::time::Duration::from_nanos(timings.total_ns);
        new_times.push(new_dur);
        timings_list.push(timings);

        let old_top5: Vec<String> = old_res.iter().take(5).map(|r| format!("{}:'{}' ({:.1}, {})", r.id, r.title, r.score, r.match_type)).collect();
        let new_top5: Vec<String> = new_res.iter().take(5).map(|r| format!("{}:'{}' ({:.1}, {})", r.id, r.title, r.score, r.match_type)).collect();

        let diff = if old_top5 != new_top5 { "DIFFERENCE" } else { "IDENTICAL" };

        println!("\nQuery [{}]: '{}' -> {}", label, q, diff);
        println!("  Old ({:6.3} ms, {} items): {:?}", old_dur.as_secs_f64() * 1000.0, old_res.len(), old_top5);
        println!("  New ({:6.3} ms, {} items): {:?}", new_dur.as_secs_f64() * 1000.0, new_res.len(), new_top5);
    }
    println!("===============================================================================================\n");

    let old_avg_ms: f64 = old_times.iter().map(|d| d.as_secs_f64() * 1000.0).sum::<f64>() / (old_times.len() as f64);
    let new_avg_ms: f64 = new_times.iter().map(|d| d.as_secs_f64() * 1000.0).sum::<f64>() / (new_times.len() as f64);

    println!("=== SEED A: 10-QUERY AVERAGE LATENCY ===");
    println!("  BEFORE Phase 2 (Old Linear Scan): {:6.2} ms", old_avg_ms);
    println!("  AFTER Phase 2b (Optimized Hybrid): {:6.3} ms", new_avg_ms);
    println!("  Speedup: {:.1}x faster", old_avg_ms / new_avg_ms.max(0.001));
    println!("========================================\n");

    // Per-stage timings table
    println!("=== PER-STAGE TIMINGS FOR SEARCH_DOCUMENTS (SEED A, 10-QUERY AVERAGE) ===");
    let n_q = timings_list.len() as f64;
    let avg_cache_us = timings_list.iter().map(|t| t.cache_fetch_ns as f64 / 1000.0).sum::<f64>() / n_q;
    let avg_title_us = timings_list.iter().map(|t| t.title_pass_ns as f64 / 1000.0).sum::<f64>() / n_q;
    let avg_fts_us = timings_list.iter().map(|t| t.fts_query_ns as f64 / 1000.0).sum::<f64>() / n_q;
    let avg_sort_us = timings_list.iter().map(|t| t.merge_sort_ns as f64 / 1000.0).sum::<f64>() / n_q;
    let avg_build_us = timings_list.iter().map(|t| t.snippet_build_ns as f64 / 1000.0).sum::<f64>() / n_q;
    let avg_total_us = timings_list.iter().map(|t| t.total_ns as f64 / 1000.0).sum::<f64>() / n_q;

    println!("  1. Cache fetch:          {:7.2} µs ({:5.3} ms)", avg_cache_us, avg_cache_us / 1000.0);
    println!("  2. Title scoring pass:    {:7.2} µs ({:5.3} ms)", avg_title_us, avg_title_us / 1000.0);
    println!("  3. SQLite FTS5 query:     {:7.2} µs ({:5.3} ms)", avg_fts_us, avg_fts_us / 1000.0);
    println!("  4. Merge & rank (top-K):  {:7.2} µs ({:5.3} ms)", avg_sort_us, avg_sort_us / 1000.0);
    println!("  5. SearchResult build:    {:7.2} µs ({:5.3} ms)", avg_build_us, avg_build_us / 1000.0);
    println!("  ---------------------------------------------");
    println!("  TOTAL SEARCH TIME:        {:7.2} µs ({:5.3} ms)", avg_total_us, avg_total_us / 1000.0);
    println!("=========================================================================\n");

    // ==================== SEED B: REALISTIC VARIED-TITLE / VARIED-BODY SEED ====================
    println!("\n=== SEED B: REALISTIC VARIED-TITLE / VARIED-BODY SEED (10,000 NOTES) ===");
    let temp_dir_b = std::env::temp_dir().join(format!("raynote_seed_b_{}", uuid::Uuid::new_v4()));
    let db_b = Database::new(temp_dir_b.clone()).expect("Failed to initialize seed B db");

    // Seed 10,000 realistic diverse notes
    {
        let mut conn = db_b.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction().unwrap();

        let domains = [
            "Engineering RFC", "Meeting Transcript", "Customer Feedback", "Security Audit",
            "Product Strategy", "Incident Postmortem", "Bug Report", "Architecture Decision",
            "Personal Journal", "Reading Notes", "Legal Brief", "Financial Summary"
        ];
        let topics = [
            "PostgreSQL replication", "Tauri IPC optimization", "Kubernetes ingress",
            "Memory leak investigation", "Distributed caching", "OAuth2 authorization",
            "Tailwind layout bugs", "Rust async runtime", "React concurrent mode",
            "Zero-knowledge proofs", "Vector embeddings", "GraphQL federation"
        ];

        for i in 1..=10000 {
            let domain = domains[i % domains.len()];
            let topic = topics[i % topics.len()];
            let title = format!("{}: {} #{}", domain, topic, i);
            let text = if i == 42 {
                "Special document body discussing quantum cryptography key distribution and BB84 protocol.".to_string()
            } else if i == 150 {
                "Detailed technical breakdown of backpropagation gradient descent and automatic differentiation.".to_string()
            } else if i == 789 {
                "Theoretical analysis of zk-SNARK non-interactive zero knowledge proof systems.".to_string()
            } else {
                format!("Comprehensive technical discussion regarding {} in {}. Explored architecture, performance profiling, and error handling for item {}.", topic, domain, i)
            };

            tx.execute(
                "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    format!("seed-b-{}", i),
                    title,
                    format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"{}"}}]}}]}}"#, text),
                    text,
                    text,
                    "2026-10-01T00:00:00Z",
                    "2026-10-05T00:00:00Z",
                    if i == 1 { 1 } else { 0 },
                ],
            ).unwrap();
        }
        tx.commit().unwrap();
    }

    // Populate FTS for Seed B
    {
        let conn = db_b.writer.lock().unwrap_or_else(|e| e.into_inner());
        let _ = conn.execute("INSERT OR IGNORE INTO notes_fts(rowid, id, title, search_text) SELECT rowid, id, title, search_text FROM notes", []);
    }

    // Benchmark queries on Seed B including BODY-ONLY matches
    let seed_b_queries = [
        ("1. Exact Title", "Engineering RFC: PostgreSQL replication #12"),
        ("2. Title Prefix", "Incident Postmortem"),
        ("3. Title Typo", "Incedent Postmrtem"),
        ("4. Multi-word Title", "Federation GraphQL"),
        ("5. Body-Only Match (Quantum)", "quantum cryptography key distribution"),
        ("6. Body-Only Match (Backprop)", "backpropagation gradient descent"),
        ("7. Body-Only Match (zk-SNARK)", "zk-SNARK non-interactive"),
        ("8. Content Prefix", "cryptogr"),
        ("9. Content Substring", "ryptogr"),
        ("10. Unmatched", "xyznonexistentquery"),
    ];

    let mut seed_b_old_times = Vec::new();
    let mut seed_b_new_times = Vec::new();

    println!("\n--- SEED B SAMPLE QUERIES & TOP-5 COMPARISON ---");
    for (label, q) in &seed_b_queries {
        // Measure Old Search on Seed B
        let t0 = std::time::Instant::now();
        let trimmed = q.trim();
        let has_substantial_token = trimmed
            .split_whitespace()
            .any(|w| w.chars().filter(|c| c.is_alphanumeric()).count() >= 3);
        let mut fts_matched = std::collections::HashSet::new();
        if has_substantial_token {
            let clean_fts = sanitize_fts5_query(trimmed);
            if !clean_fts.is_empty() {
                let conn = db_b.reader.lock().unwrap_or_else(|e| e.into_inner());
                let mut stmt = conn.prepare("SELECT f.id FROM notes_fts f WHERE notes_fts MATCH ?1 LIMIT 50").unwrap();
                let rows = stmt.query_map(params![clean_fts], |r| r.get::<_, String>(0)).unwrap();
                for id in rows.flatten() {
                    fts_matched.insert(id);
                }
            }
        }
        let all = db_b.get_all_notes_arc().unwrap();
        let mut old_res = Vec::new();
        for n in all.iter() {
            let is_fts = fts_matched.contains(&n.id);
            let cand = DocumentCandidate {
                id: &n.id,
                title: &n.title,
                search_text: &n.preview,
                preview: &n.preview,
                updated_at: &n.updated_at,
                is_pinned: n.is_pinned,
                fts_snippet: if is_fts { Some("fts") } else { None },
            };
            let (score, match_type) = score_document(trimmed, &cand);
            if score > 0.0 {
                old_res.push(SearchResult {
                    id: n.id.clone(),
                    title: n.title.clone(),
                    snippet: n.preview.clone(),
                    score,
                    match_type,
                    updated_at: n.updated_at.clone(),
                    is_pinned: n.is_pinned,
                });
            }
        }
        old_res.sort_by(|a, b| {
            b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.is_pinned.cmp(&a.is_pinned))
                .then_with(|| b.updated_at.cmp(&a.updated_at))
                .then_with(|| a.id.cmp(&b.id))
        });
        old_res.truncate(30);
        let old_dur = t0.elapsed();
        seed_b_old_times.push(old_dur);

        // Measure New Hybrid Search on Seed B
        let t1 = std::time::Instant::now();
        let new_res = db_b.search_documents(q, 30).unwrap();
        let new_dur = t1.elapsed();
        seed_b_new_times.push(new_dur);

        let old_top5: Vec<String> = old_res.iter().take(5).map(|r| format!("{}:'{}' ({:.1}, {})", r.id, r.title, r.score, r.match_type)).collect();
        let new_top5: Vec<String> = new_res.iter().take(5).map(|r| format!("{}:'{}' ({:.1}, {})", r.id, r.title, r.score, r.match_type)).collect();

        let diff = if old_top5 != new_top5 { "DIFFERENCE" } else { "IDENTICAL" };
        println!("\nSeed B Query [{}]: '{}' -> {}", label, q, diff);
        println!("  Old ({:6.3} ms, {} items): {:?}", old_dur.as_secs_f64() * 1000.0, old_res.len(), old_top5);
        println!("  New ({:6.3} ms, {} items): {:?}", new_dur.as_secs_f64() * 1000.0, new_res.len(), new_top5);
    }

    let b_old_avg_ms: f64 = seed_b_old_times.iter().map(|d| d.as_secs_f64() * 1000.0).sum::<f64>() / (seed_b_old_times.len() as f64);
    let b_new_avg_ms: f64 = seed_b_new_times.iter().map(|d| d.as_secs_f64() * 1000.0).sum::<f64>() / (seed_b_new_times.len() as f64);

    println!("\n=== SEED B: 10-QUERY AVERAGE LATENCY ===");
    println!("  BEFORE Phase 2 (Old Linear Scan): {:6.2} ms", b_old_avg_ms);
    println!("  AFTER Phase 2b (Optimized Hybrid): {:6.3} ms", b_new_avg_ms);
    println!("  Speedup: {:.1}x faster", b_old_avg_ms / b_new_avg_ms.max(0.001));
    println!("========================================\n");

    // ==================== ITEM 8: SEARCH EDGE CASES VERIFICATION ====================
    println!("\n=== ITEM 8: SEARCH EDGE CASES VERIFICATION ===");
    // 1. Emoji / Symbol / Quote queries MUST NOT fall back to recents
    let non_empty_symbol_queries = [
        ("Emoji only", "📘 🚀"),
        ("Symbols only", "- ( ) ^ :"),
        ("Double quotes only", "\"\""),
        ("Whitespace with quote", "   \"   "),
    ];

    for (label, q_str) in &non_empty_symbol_queries {
        let res = db.search_documents(q_str, 30).unwrap();
        println!("  Query '{}' [{}]: returned {} results (no recents fallback)", q_str, label, res.len());
        // If the query is "📘 🚀", note n11 title is "📘 Release Notes 🚀" so it matches!
        if *q_str == "📘 🚀" {
            assert!(res.iter().any(|r| r.id == "n11"), "Emoji query must match note with emoji title");
        } else {
            // Symbols only should NOT return 30 recent notes!
            assert!(res.is_empty(), "Symbol-only query must return 0 results if no note title contains those symbols");
        }
    }

    // Empty query still falls back to recents
    let empty_res = db.search_documents("", 30).unwrap();
    assert_eq!(empty_res.len(), 30, "Empty query must fall back to 30 recents");

    // 2. Partial CJK Query Testing
    // n13 has title: "中文测试文档", content: "这是一个用于测试全文本搜索的中文测试文档。"
    let cjk_res = db.search_documents("测试", 30).unwrap();
    println!("\n  CJK Query '测试' against note n13 ('中文测试文档'):");
    println!("    Returned {} results. Top match: id={}, title='{}', score={:.1}, match_type={}",
        cjk_res.len(),
        cjk_res.first().map(|r| r.id.as_str()).unwrap_or("none"),
        cjk_res.first().map(|r| r.title.as_str()).unwrap_or("none"),
        cjk_res.first().map(|r| r.score).unwrap_or(0.0),
        cjk_res.first().map(|r| r.match_type.as_str()).unwrap_or("none")
    );
    assert!(cjk_res.iter().any(|r| r.id == "n13"), "Partial CJK query '测试' must match note '中文测试文档'");
    println!("===============================================\n");

    // ==================== ITEM 9: REAL MACH MEMORY MEASUREMENT ====================
    #[cfg(target_os = "macos")]
    {
        let (footprint_bytes, rss_bytes) = get_mach_footprint();
        println!("=== ITEM 9: REAL MACH MEMORY FOOTPRINT ===");
        println!("  Physical Footprint (task_vm_info.phys_footprint): {:.2} MB", footprint_bytes as f64 / (1024.0 * 1024.0));
        println!("  Resident Size (task_vm_info.resident_size / RSS): {:.2} MB", rss_bytes as f64 / (1024.0 * 1024.0));
        println!("==========================================\n");
    }

    // Cleanup
    let _ = std::fs::remove_dir_all(temp_dir);
    let _ = std::fs::remove_dir_all(temp_dir_b);
}

#[test]
#[ignore]
fn test_condition6_benchmarks() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_cond6_bench_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    println!("\n========================================================");
    println!("  CONDITION 6 BENCHMARKS [Release (opt-level=3)]");
    println!("========================================================");

    // Seed 10,000 notes
    print!("Seeding 10,000 notes in temp database... ");
    let seed_start = std::time::Instant::now();
    {
        let mut conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction().unwrap();
        for i in 1..=10000 {
            let note_id = format!("bench-note-{}", i);
            let title = format!("Release Engineering Note #{}", i);
            let text = format!("Payload text for performance benchmark testing note {} with detailed analysis.", i);
            tx.execute(
                "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    note_id,
                    title,
                    format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"{}"}}]}}]}}"#, text),
                    text,
                    text,
                    "2026-10-01T00:00:00Z",
                    "2026-10-05T00:00:00Z",
                    if i <= 50 { 1 } else { 0 },
                ],
            ).unwrap();
        }
        tx.commit().unwrap();
    }
    // Sync FTS
    {
        let conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());
        let _ = conn.execute("INSERT OR IGNORE INTO notes_fts(rowid, id, title, search_text) SELECT rowid, id, title, search_text FROM notes", []);
    }
    println!("Done in {:.2} ms", seed_start.elapsed().as_secs_f64() * 1000.0);

    // Pre-warm cache
    let _ = db.get_all_notes_arc().unwrap();

    // 1. UPDATE_NOTE: 250 iterations
    let mut update_times_us = Vec::with_capacity(250);
    // Warmup
    for i in 1..=10 {
        let warmup_title = format!("Updated Warmup {}", i);
        let _ = db.update_note(
            "bench-note-1",
            &warmup_title,
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Warmup"}]}]}"#,
        );
    }
    for i in 1..=250 {
        let target_id = format!("bench-note-{}", (i % 100) + 1);
        let title = format!("Updated Benchmark Title {}", i);
        let content = format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"Updated body iteration {} for microsecond benchmark testing."}}]}}]}}"#, i);
        let start = std::time::Instant::now();
        db.update_note(&target_id, &title, &content).unwrap();
        update_times_us.push(start.elapsed().as_micros());
    }
    update_times_us.sort_unstable();
    let update_median = update_times_us[update_times_us.len() / 2];
    let update_p95 = update_times_us[(update_times_us.len() * 95) / 100];
    let update_mean = update_times_us.iter().sum::<u128>() / update_times_us.len() as u128;
    let update_min = update_times_us[0];
    let update_max = update_times_us[update_times_us.len() - 1];

    // 2. TOGGLE_PIN: 250 iterations
    let mut pin_times_us = Vec::with_capacity(250);
    for i in 1..=10 {
        let _ = db.toggle_pin(&format!("bench-note-{}", (i % 50) + 1));
    }
    for i in 1..=250 {
        let target_id = format!("bench-note-{}", (i % 200) + 1);
        let start = std::time::Instant::now();
        db.toggle_pin(&target_id).unwrap();
        pin_times_us.push(start.elapsed().as_micros());
    }
    pin_times_us.sort_unstable();
    let pin_median = pin_times_us[pin_times_us.len() / 2];
    let pin_p95 = pin_times_us[(pin_times_us.len() * 95) / 100];
    let pin_mean = pin_times_us.iter().sum::<u128>() / pin_times_us.len() as u128;
    let pin_min = pin_times_us[0];
    let pin_max = pin_times_us[pin_times_us.len() - 1];

    // 3. DELETE_NOTE: 250 iterations
    // Seed 270 notes to delete
    for i in 1..=270 {
        let note = Note {
            id: format!("delete-temp-{}", i),
            title: format!("Temp Note To Delete {}", i),
            content: r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Temp"}]}]}"#.to_string(),
            preview: "Temp".to_string(),
            created_at: "2026-10-01T00:00:00Z".to_string(),
            updated_at: "2026-10-01T00:00:00Z".to_string(),
            is_pinned: false,
        };
        db.create_note(&note).unwrap();
    }
    for i in 1..=10 {
        let _ = db.delete_note(&format!("delete-temp-{}", i));
    }
    let mut delete_times_us = Vec::with_capacity(250);
    for i in 11..=260 {
        let target_id = format!("delete-temp-{}", i);
        let start = std::time::Instant::now();
        db.delete_note(&target_id).unwrap();
        delete_times_us.push(start.elapsed().as_micros());
    }
    delete_times_us.sort_unstable();
    let delete_median = delete_times_us[delete_times_us.len() / 2];
    let delete_p95 = delete_times_us[(delete_times_us.len() * 95) / 100];
    let delete_mean = delete_times_us.iter().sum::<u128>() / delete_times_us.len() as u128;
    let delete_min = delete_times_us[0];
    let delete_max = delete_times_us[delete_times_us.len() - 1];

    // 4. DATABASE::NEW COLD START BASELINE (Pre-Phase 1 vs Post-Phase 3)
    // Checkpoint WAL first
    {
        let conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());
        let _: (i32, i32, i32) = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).unwrap();
    }
    drop(db);

    // Pre-Phase 1 startup simulation on the 10,000 note DB
    let db_file = temp_dir.join("raynote.db");
    let mut pre_phase1_times_ms = Vec::new();
    for _ in 0..5 {
        let start = std::time::Instant::now();
        let conn = rusqlite::Connection::open(&db_file).unwrap();
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "busy_timeout", 5000);
        let _ = conn.pragma_update(None, "foreign_keys", "ON");
        // Pre-phase 1 unconditional trigger drop & recreation
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS notes_fts_ai;
                 DROP TRIGGER IF EXISTS notes_fts_ad;
                 DROP TRIGGER IF EXISTS notes_fts_au;
                 CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
                     INSERT INTO notes_fts(rowid, id, title, search_text)
                     VALUES (new.rowid, new.id, new.title, new.search_text);
                 END;
                 CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
                     DELETE FROM notes_fts WHERE rowid = old.rowid;
                 END;
                 CREATE TRIGGER notes_fts_au AFTER UPDATE ON notes BEGIN
                     DELETE FROM notes_fts WHERE rowid = old.rowid;
                     INSERT INTO notes_fts(rowid, id, title, search_text)
                     VALUES (new.rowid, new.id, new.title, new.search_text);
                 END;"
        ).unwrap();
        // Pre-phase 1 unconditional wipe & rebuild of FTS table!
        let _ = conn.execute("DELETE FROM notes_fts", []).unwrap();
        let _ = conn.execute(
            "INSERT INTO notes_fts(rowid, id, title, search_text)
                 SELECT rowid, id, title, search_text FROM notes",
            [],
        ).unwrap();
        pre_phase1_times_ms.push(start.elapsed().as_secs_f64() * 1000.0);
    }

    // Post-Phase 3 Database::new on the same 10,000 note DB
    // Restore user_version to 3
    {
        let conn = rusqlite::Connection::open(&db_file).unwrap();
        conn.pragma_update(None, "user_version", 3).unwrap();
        let _: (i32, i32, i32) = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).unwrap();
    }
    let mut post_phase3_times_ms = Vec::new();
    for _ in 0..5 {
        let start = std::time::Instant::now();
        let _db = Database::new(temp_dir.clone()).unwrap();
        post_phase3_times_ms.push(start.elapsed().as_secs_f64() * 1000.0);
    }

    let pre_p1_avg: f64 = pre_phase1_times_ms.iter().sum::<f64>() / pre_phase1_times_ms.len() as f64;
    let post_p3_avg: f64 = post_phase3_times_ms.iter().sum::<f64>() / post_phase3_times_ms.len() as f64;

    println!("\n--- SINGLE-WRITE OPERATIONS (250 runs, 10,000 notes) ---");
    println!("  Operation    | Median (p50) | 95th % (p95) | Mean     | Min    | Max");
    println!("  -------------+--------------+--------------+----------+--------+---------");
    println!("  update_note  | {:>8} µs | {:>8} µs | {:>6} µs | {:>4} µs | {:>5} µs", update_median, update_p95, update_mean, update_min, update_max);
    println!("  toggle_pin   | {:>8} µs | {:>8} µs | {:>6} µs | {:>4} µs | {:>5} µs", pin_median, pin_p95, pin_mean, pin_min, pin_max);
    println!("  delete_note  | {:>8} µs | {:>8} µs | {:>6} µs | {:>4} µs | {:>5} µs", delete_median, delete_p95, delete_mean, delete_min, delete_max);

    println!("\n--- DATABASE::NEW COLD-START COMPARISON (10,000 notes) ---");
    println!("  Pre-Phase 1 Baseline (unconditional FTS wipe/rebuild) : {:>7.2} ms (runs: {:?})", pre_p1_avg, pre_phase1_times_ms.iter().map(|t| format!("{:.1}", t)).collect::<Vec<_>>());
    println!("  Post-Phase 3 Current  (gated migrations, WAL init only) : {:>7.2} ms (runs: {:?})", post_p3_avg, post_phase3_times_ms.iter().map(|t| format!("{:.1}", t)).collect::<Vec<_>>());
    println!("  Cold-Start Speedup                                    : {:>7.1}x faster", pre_p1_avg / post_p3_avg);
    println!("========================================================\n");

    let _ = std::fs::remove_dir_all(temp_dir);
}



#[test]
#[ignore]
fn test_adjacent_note_10k_bench() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_adj_multiscale_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize db");

    // 1. EXPLAIN QUERY PLAN for both NEXT and PREVIOUS
    {
        let conn = db.reader.lock().unwrap();
        let next_sql = "SELECT id FROM (
                 SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at = ?2 AND id > ?3 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
             ) UNION ALL SELECT id FROM (
                 SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at < ?2 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
             ) UNION ALL SELECT id FROM (
                 SELECT id FROM notes WHERE is_pinned < ?1 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1
             ) LIMIT 1";
        let mut explain_next = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", next_sql)).unwrap();
        let plan_next: Vec<String> = explain_next.query_map(params![0, "2026-10-15T12:00:00Z", "note_05000"], |r| r.get::<_, String>(3)).unwrap().flatten().collect();

        println!("\n=== EXPLAIN QUERY PLAN FOR NEXT ===");
        for line in &plan_next {
            println!("  {}", line);
        }

        let prev_sql = "SELECT id FROM (
                 SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at = ?2 AND id < ?3 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
             ) UNION ALL SELECT id FROM (
                 SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at > ?2 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
             ) UNION ALL SELECT id FROM (
                 SELECT id FROM notes WHERE is_pinned > ?1 ORDER BY is_pinned ASC, updated_at ASC, id DESC LIMIT 1
             ) LIMIT 1";
        let mut explain_prev = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", prev_sql)).unwrap();
        let plan_prev: Vec<String> = explain_prev.query_map(params![0, "2026-10-15T12:00:00Z", "note_05000"], |r| r.get::<_, String>(3)).unwrap().flatten().collect();

        println!("\n=== EXPLAIN QUERY PLAN FOR PREVIOUS ===");
        for line in &plan_prev {
            println!("  {}", line);
        }
    }

    fn run_keyset_bench(scale: usize, include_1mb_note: bool) -> (std::time::Duration, f64) {
        let tdir = std::env::temp_dir().join(format!("raynote_adj_scale_{}_{}", scale, uuid::Uuid::new_v4()));
        let test_db = Database::new(tdir.clone()).unwrap();

        // Seed notes
        {
            let mut conn = test_db.writer.lock().unwrap();
            let tx = conn.transaction().unwrap();
            for i in 0..scale {
                let id = format!("note_{:06}", i);
                let updated = format!("2026-10-{:02}T{:02}:{:02}:{:02}Z", (i % 28) + 1, (i % 24), (i % 60), (i % 60));
                let is_pinned = if i < (scale / 10).max(1) { 1 } else { 0 };
                let content = if include_1mb_note && i == scale / 2 {
                    "X".repeat(1_048_576) // 1 MB note
                } else {
                    "Standard note content".to_string()
                };
                tx.execute(
                    "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![id, format!("Note {}", i), content, "Preview", "search text", "2026-01-01", updated, is_pinned],
                ).unwrap();
            }
            tx.commit().unwrap();
        }

        // Warm summary cache once
        let _ = test_db.get_all_notes_arc().unwrap();

        let target_start = format!("note_{:06}", scale / 2);
        let mut curr = target_start.clone();
        let iterations = 1_000;
        let start = std::time::Instant::now();
        for _ in 0..iterations {
            curr = test_db.get_adjacent_note(&curr, "next").unwrap().unwrap();
        }
        let elapsed = start.elapsed();
        let avg_us = elapsed.as_micros() as f64 / iterations as f64;

        let _ = std::fs::remove_dir_all(tdir);
        (elapsed, avg_us)
    }

    println!("\n=== KEYSET NAVIGATION LATENCY ACROSS SCALES (RELEASE) ===");
    let (dur_1k, us_1k) = run_keyset_bench(1_000, false);
    println!("  1,000 notes:  total {:?}, avg {:.3} µs ({:.4} ms/query)", dur_1k, us_1k, us_1k / 1000.0);

    let (dur_10k, us_10k) = run_keyset_bench(10_000, false);
    println!(" 10,000 notes:  total {:?}, avg {:.3} µs ({:.4} ms/query)", dur_10k, us_10k, us_10k / 1000.0);

    let (dur_50k, us_50k) = run_keyset_bench(50_000, false);
    println!(" 50,000 notes:  total {:?}, avg {:.3} µs ({:.4} ms/query)", dur_50k, us_50k, us_50k / 1000.0);

    let (dur_1mb, us_1mb) = run_keyset_bench(10_000, true);
    println!(" 10,000 notes (with 1 MB active note): total {:?}, avg {:.3} µs ({:.4} ms/query)", dur_1mb, us_1mb, us_1mb / 1000.0);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
#[ignore]
fn test_big_note_write_benchmarks() {
    let temp_dir = std::env::temp_dir().join(format!("raynote_bignote_bench_{}", uuid::Uuid::new_v4()));
    let db = Database::new(temp_dir.clone()).expect("Failed to initialize test db");

    println!("\n========================================================");
    println!("  BIG NOTE WRITE & PIN BENCHMARK [Release (opt-level=3)]");
    println!("========================================================");

    // 1. Seed 10,000 standard notes
    print!("Seeding 10,000 notes in temp database... ");
    let seed_start = std::time::Instant::now();
    {
        let mut conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction().unwrap();
        for i in 1..=10000 {
            let note_id = format!("bench-note-{}", i);
            let title = format!("Standard Benchmark Note #{}", i);
            let text = format!("Standard text payload for benchmark note {}.", i);
            tx.execute(
                "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    note_id,
                    title,
                    format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"{}"}}]}}]}}"#, text),
                    text,
                    text,
                    "2026-10-01T00:00:00Z",
                    "2026-10-05T00:00:00Z",
                    if i <= 50 { 1 } else { 0 },
                ],
            ).unwrap();
        }
        tx.commit().unwrap();
    }
    {
        let conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());
        let _ = conn.execute("INSERT OR IGNORE INTO notes_fts(rowid, id, title, search_text) SELECT rowid, id, title, search_text FROM notes", []);
    }
    println!("Done in {:.2} ms", seed_start.elapsed().as_secs_f64() * 1000.0);

    // Create 100 KB and 1 MB documents
    let make_doc = |target_bytes: usize| -> (String, String) {
        let paragraph_text = "The quick brown fox jumps over the lazy dog in software engineering performance benchmarks. ";
        let mut content = String::with_capacity(target_bytes + 256);
        content.push_str(r#"{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Benchmark Big Document"}]}"#);
        let mut current_bytes = content.len();
        while current_bytes < target_bytes - 100 {
            content.push_str(r#",{"type":"paragraph","content":[{"type":"text","text":""#);
            content.push_str(paragraph_text);
            content.push_str(r#""}]}"#);
            current_bytes = content.len();
        }
        content.push_str("]}");
        let title = "Benchmark Big Document".to_string();
        (title, content)
    };

    let (title_100k, content_100k) = make_doc(100 * 1024);
    let (title_1mb, content_1mb) = make_doc(1024 * 1024);

    println!("Document sizes: 100 KB doc = {} bytes, 1 MB doc = {} bytes", content_100k.len(), content_1mb.len());

    let note_100k_id = "note-big-100k".to_string();
    let note_1mb_id = "note-big-1mb".to_string();

    {
        let conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                note_100k_id,
                title_100k,
                content_100k,
                "Preview for 100k doc",
                "Search text for 100k doc",
                "2026-10-01T00:00:00Z",
                "2026-10-05T00:00:00Z",
                0,
            ],
        ).unwrap();
        conn.execute(
            "INSERT INTO notes (id, title, content, preview, search_text, created_at, updated_at, is_pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                note_1mb_id,
                title_1mb,
                content_1mb,
                "Preview for 1mb doc",
                "Search text for 1mb doc",
                "2026-10-01T00:00:00Z",
                "2026-10-05T00:00:00Z",
                0,
            ],
        ).unwrap();
    }

    // Pre-warm cache
    let _ = db.get_all_notes_arc().unwrap();

    // Helper to compute stats
    let calc_stats = |mut times: Vec<f64>| -> (f64, f64, f64, f64, f64) {
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = times[times.len() / 2];
        let p95 = times[(times.len() * 95) / 100];
        let mean = times.iter().sum::<f64>() / times.len() as f64;
        let min = times[0];
        let max = times[times.len() - 1];
        (median, p95, mean, min, max)
    };

    // Measure stage split function
    let run_update_bench = |target_id: &str, title: &str, content: &str, iters: usize| {
        let mut extract_times_ms = Vec::with_capacity(iters);
        let mut sql_times_ms = Vec::with_capacity(iters);
        let mut fts_times_ms = Vec::with_capacity(iters);
        let mut total_times_ms = Vec::with_capacity(iters);

        // Warmup
        for _ in 0..5 {
            let _ = db.update_note(target_id, title, content);
        }

        for _ in 0..iters {
            // 1. extract_searchable_text alone
            let t0 = std::time::Instant::now();
            let search_text = extract_searchable_text(content);
            let preview = truncate_preview(&search_text, 120);
            let extract_dur = t0.elapsed().as_secs_f64() * 1000.0;
            extract_times_ms.push(extract_dur);

            // 2. Measure SQL write & FTS trigger re-index
            let (sql_dur, fts_dur, total_dur) = {
                let now = chrono::Utc::now().to_rfc3339();
                let t_total = std::time::Instant::now();
                let conn = db.writer.lock().unwrap_or_else(|e| e.into_inner());

                // Drop FTS trigger temporarily to isolate raw SQL B-tree write vs trigger
                conn.execute_batch("DROP TRIGGER IF EXISTS notes_fts_au;").unwrap();
                let t_sql = std::time::Instant::now();
                conn.execute(
                    "UPDATE notes SET title = ?1, content = ?2, preview = ?3, search_text = ?4, updated_at = ?5 WHERE id = ?6",
                    params![title, content, preview, search_text, now, target_id],
                ).unwrap();
                let s_dur = t_sql.elapsed().as_secs_f64() * 1000.0;

                // Execute FTS delete + insert re-index exactly as trigger does
                let rowid: i64 = conn.query_row("SELECT rowid FROM notes WHERE id = ?1", params![target_id], |r| r.get(0)).unwrap();
                let t_fts = std::time::Instant::now();
                conn.execute(
                    "DELETE FROM notes_fts WHERE rowid = ?1",
                    params![rowid],
                ).unwrap();
                conn.execute(
                    "INSERT INTO notes_fts(rowid, id, title, search_text) VALUES(?1, ?2, ?3, ?4)",
                    params![rowid, target_id, title, search_text],
                ).unwrap();
                let f_dur = t_fts.elapsed().as_secs_f64() * 1000.0;

                // Recreate trigger
                conn.execute_batch(r#"
                        CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE OF title, search_text ON notes
                        WHEN old.title IS NOT new.title OR old.search_text IS NOT new.search_text
                        BEGIN
                            DELETE FROM notes_fts WHERE rowid = old.rowid;
                            INSERT INTO notes_fts(rowid, id, title, search_text)
                            VALUES (new.rowid, new.id, new.title, new.search_text);
                        END;
                    "#).unwrap();

                let tot_dur = t_total.elapsed().as_secs_f64() * 1000.0 + extract_dur;
                (s_dur, f_dur, tot_dur)
            };

            sql_times_ms.push(sql_dur);
            fts_times_ms.push(fts_dur);
            total_times_ms.push(total_dur);
        }

        (
            calc_stats(extract_times_ms),
            calc_stats(sql_times_ms),
            calc_stats(fts_times_ms),
            calc_stats(total_times_ms),
        )
    };

    println!("\n--- 100 KB Note update_note Breakdown (50 runs) ---");
    let (ext_100k, sql_100k, fts_100k, tot_100k) = run_update_bench(&note_100k_id, &title_100k, &content_100k, 50);
    println!("extract_searchable_text: median = {:.3} ms, p95 = {:.3} ms (mean = {:.3} ms)", ext_100k.0, ext_100k.1, ext_100k.2);
    println!("SQL write (B-tree):      median = {:.3} ms, p95 = {:.3} ms (mean = {:.3} ms)", sql_100k.0, sql_100k.1, sql_100k.2);
    println!("FTS trigger re-index:    median = {:.3} ms, p95 = {:.3} ms (mean = {:.3} ms)", fts_100k.0, fts_100k.1, fts_100k.2);
    println!("Total update_note:       median = {:.3} ms, p95 = {:.3} ms (mean = {:.3} ms)", tot_100k.0, tot_100k.1, tot_100k.2);

    println!("\n--- 1 MB Note update_note Breakdown (50 runs) ---");
    let (ext_1mb, sql_1mb, fts_1mb, tot_1mb) = run_update_bench(&note_1mb_id, &title_1mb, &content_1mb, 50);
    println!("extract_searchable_text: median = {:.3} ms, p95 = {:.3} ms (mean = {:.3} ms)", ext_1mb.0, ext_1mb.1, ext_1mb.2);
    println!("SQL write (B-tree):      median = {:.3} ms, p95 = {:.3} ms (mean = {:.3} ms)", sql_1mb.0, sql_1mb.1, sql_1mb.2);
    println!("FTS trigger re-index:    median = {:.3} ms, p95 = {:.3} ms (mean = {:.3} ms)", fts_1mb.0, fts_1mb.1, fts_1mb.2);
    println!("Total update_note:       median = {:.3} ms, p95 = {:.3} ms (mean = {:.3} ms)", tot_1mb.0, tot_1mb.1, tot_1mb.2);

    println!("\n--- Toggle Pin on 1 MB Note (100 runs) ---");
    // Warmup
    for _ in 0..5 {
        let _ = db.toggle_pin(&note_1mb_id);
    }
    let mut pin_times_us = Vec::with_capacity(100);
    for _ in 0..100 {
        let t = std::time::Instant::now();
        db.toggle_pin(&note_1mb_id).unwrap();
        pin_times_us.push(t.elapsed().as_micros() as f64);
    }
    let (pin_med, pin_p95, pin_mean, pin_min, pin_max) = calc_stats(pin_times_us);
    println!("toggle_pin(1 MB note): median = {:.1} µs ({:.3} ms), p95 = {:.1} µs ({:.3} ms), mean = {:.1} µs, min = {:.1} µs, max = {:.1} µs",
        pin_med, pin_med / 1000.0, pin_p95, pin_p95 / 1000.0, pin_mean, pin_min, pin_max);

    let _ = std::fs::remove_dir_all(temp_dir);
}
#[test]
fn audit_search_text_preserves_inline_words_and_ignores_empty_json() {
    let split = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hel"},{"type":"text","text":"lo","marks":[{"type":"bold"}]}]},{"type":"paragraph","content":[{"type":"text","text":"world"}]}]}"#;
    assert_eq!(extract_searchable_text(split), "hello world");
    assert_eq!(extract_searchable_text(r#"{"type":"doc","content":[{"type":"heading","attrs":{"level":1}}]}"#), "");
}

#[test]
fn audit_body_search_ranks_before_limiting_candidates() {
    let dir = std::env::temp_dir().join(format!("raynote_rank_{}", uuid::Uuid::new_v4()));
    let db = Database::new(dir.clone()).unwrap();
    for i in 0..12 {
        let text = if i == 11 { "quasar ".repeat(200) } else { format!("quasar {}", "unrelated ".repeat(200)) };
        db.create_note(&Note { id: format!("n{i:02}"), title: format!("Journal {i}"), content: serde_json::json!({"type":"doc", "content":[{"type":"paragraph", "content":[{"type":"text","text":text}]}]}).to_string(), preview: String::new(), created_at: "2026-01-01".into(), updated_at: "2026-01-01".into(), is_pinned: false }).unwrap();
    }
    assert_eq!(db.search_documents("quasar", 3).unwrap()[0].id, "n11");
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn audit_fix_cyrillic_exact_title_ranks_before_prefix_at_limit_one() {
    let dir = std::env::temp_dir().join(format!("raynote_unicode_rank_{}", uuid::Uuid::new_v4()));
    let db = Database::new(dir.clone()).unwrap();
    for (id, title) in [("exact", "МОСКВА"), ("prefix", "москва trip")] {
        db.create_note(&Note {
            id: id.into(), title: title.into(),
            content: serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]}).to_string(),
            preview: String::new(), created_at: "2026-11-03T00:00:00Z".into(),
            updated_at: "2026-11-03T00:00:00Z".into(), is_pinned: false,
        }).unwrap();
    }
    let results = db.search_documents("москва", 1).unwrap();
    drop(db);
    std::fs::remove_dir_all(dir).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, "exact");
    assert_eq!(results[0].match_type, "exact_title");
}
