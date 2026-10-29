use std::path::PathBuf;
use std::time::Instant;
use raynote_lib::database::Database;

fn main() {
    let db_dir = PathBuf::from("/tmp/current_bench_dir");
    std::fs::create_dir_all(&db_dir).unwrap();
    let db_path = db_dir.join("raynote.db");

    println!("=========================================================");
    println!("  CURRENT TREE (ROUND 3) RUST DATABASE BENCHMARK");
    println!("=========================================================");

    for run_i in 1..=5 {
        // Fresh copy per run: remove DB and all WAL/SHM artifacts
        for suffix in &["", "-wal", "-shm"] {
            let f = db_dir.join(format!("raynote.db{}", suffix));
            let _ = std::fs::remove_file(f);
        }
        std::fs::copy("/tmp/synthetic_benchmark.db", &db_path).unwrap();

        // 1. Cold open (Database::new)
        let t0 = Instant::now();
        let db = Database::new(db_dir.clone()).expect("Failed to open database");
        let cold_open_ms = t0.elapsed().as_secs_f64() * 1000.0;

        // 2. update_note: 200 updates cycling across 100 distinct notes
        let mut update_times_us = Vec::with_capacity(200);
        for i in 1..=200 {
            let note_id = format!("note-{:05}", (i % 100) + 1);
            let title = format!("Updated Title {}", i);
            let content = format!(
                r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"Updated body iteration {} for microsecond benchmark testing."}}]}}]}}"#,
                i
            );
            let t = Instant::now();
            let _ = db.update_note(&note_id, &title, &content).unwrap();
            update_times_us.push(t.elapsed().as_micros() as f64);
        }
        update_times_us.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p50_us = update_times_us[update_times_us.len() / 2];
        let p95_us = update_times_us[(update_times_us.len() * 95) / 100];
        let min_us = update_times_us[0];
        let max_us = update_times_us[update_times_us.len() - 1];

        // 3. Search queries (10 queries across 10,000 notes, limit 30)
        let queries = ["performance", "architecture", "telemetry", "database", "knowledge", "note", "system", "prosemirror", "cache", "nonexistent"];
        let mut search_times_ms = Vec::new();
        for q in &queries {
            let t = Instant::now();
            let _ = db.search_documents(q, 30).unwrap();
            search_times_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        let avg_search_ms: f64 = search_times_ms.iter().sum::<f64>() / queries.len() as f64;

        // 4. Keyset navigation next/prev across 1,000 iterations on 10,000 notes
        let mut curr = "note-05000".to_string();
        let t_keyset = Instant::now();
        for _ in 0..1000 {
            if let Ok(Some(next_id)) = db.get_adjacent_note(&curr, "next") {
                curr = next_id;
            } else {
                break;
            }
        }
        let keyset_avg_us = t_keyset.elapsed().as_micros() as f64 / 1000.0;

        println!("RUN {}: ColdOpen={:.3} ms | update_note p50={:.1} µs, p95={:.1} µs (min={:.1}, max={:.1}) | Search 10q_avg={:.3} ms | KeysetNav={:.2} µs/step",
            run_i, cold_open_ms, p50_us, p95_us, min_us, max_us, avg_search_ms, keyset_avg_us);
    }
}
