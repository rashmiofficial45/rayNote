# rayNote Automated Test Results & Stability Report

> **Audit Date:** October 30, 2026
> **Environment:** macOS 27.2 (Darwin 26B123) | Apple M3 (8 GB Unified Memory)
> **Target Commit:** `dff544900680a1d91e4aa347b5dadfb641f6d00f`
> **Test Status:** **PASS** (100% Suites Passed)

---

## 1. Test Suite Execution Summary

| Suite / Check | Toolchain | Total Tests | Passed | Failed | Skipped / Ignored | Duration | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript Type Check** | `tsc v5.9.3` (`--noEmit`) | Full Project | 0 errors | 0 | 0 | 2,669 ms | **PASS** |
| **Frontend Unit & Integration** | `vitest v5.0.3` (happy-dom) | 366 tests (39 files) | 366 | 0 | 0 | 5,649 ms | **PASS** |
| **Native Rust Unit Tests** | `cargo test` (`rustc 1.98.1`) | 33 tests | 28 | 0 | 5 benchmarks | 1,578 ms | **PASS** |
| **Production Frontend Build** | `vite build` (`v8.3.1`) | 2,267 modules | 2,267 | 0 | 0 | 917 ms | **PASS** |

---

## 2. Frontend Test Suite Breakdown (`vitest`)

The Vitest suite executes across 39 test files validating core editor invariants, storage safety, markdown serialization, and UI workflows:

- **Markdown Serialization & Roundtripping**: 16 tests passing, including 100 KB and 1 MB realistic document serialization benchmarks.
- **Save Path Rejection Recovery & `lastSavedDocRef` Invariants**: 8 tests passing, verifying retry behavior on SQLite lock and dirty state preservation.
- **Transaction Audit & Extension Profiling**: 2 tests passing, confirming `Placeholder` with `showOnlyCurrent: true` avoids $O(N)$ document traversals.
- **In-Memory LRU Cache (`NoteLRUCache`)**: Dual-bounded eviction (25 entries / 8 MB ceiling) verified.
- **Smart Search & Ranking Algorithms**: 18 tests passing, including Damerau-Levenshtein typo tolerance, diacritics stripping, and exact-prefix boosting.
- **Storage Quota & Write Coalescing**: 4 tests passing, verifying graceful handling of `QuotaExceededError`.
- **Theme, Shortcuts, and Window Management**: 52 tests passing.

---

## 3. Native Rust Test Suite Breakdown (`cargo test`)

Executed against `src-tauri/src/lib.rs`:

```
running 33 tests
test commands::tests::test_database_update_missing_row_mapped_returns_note_not_found ... ok
test commands::tests::test_map_update_note_error_maps_query_returned_no_rows_to_note_not_found ... ok
test commands::tests::test_map_update_note_error_preserves_other_errors ... ok
test commands::tests::test_pbcopy_utf8_roundtrip_with_unset_lang_and_lc_all ... ok
test database::tests::test_cache_race_stale_snapshot_not_cached ... ok
test database::tests::test_cache_sort_order_invariants ... ok
test database::tests::test_concurrent_updates_integrity ... ok
test database::tests::test_create_note_idempotent_no_duplicates ... ok
test database::tests::test_database_search_lifecycle ... ok
test database::tests::test_extract_searchable_text_markdown_and_html ... ok
test database::tests::test_extract_searchable_text_tiptap_json ... ok
test database::tests::test_get_adjacent_note_keyset_navigation ... ok
test database::tests::test_summary_query_uses_covering_index ... ok
test database::tests::test_update_note_empty_title_preserves_existing_title ... ok
test database::tests::test_update_note_missing_id_returns_err_and_preserves_cache ... ok
test database::tests::test_update_note_returned_timestamp_equals_stored_updated_at ... ok
test search::tests::test_damerau_levenshtein ... ok
test search::tests::test_deterministic_ranking ... ok
test search::tests::test_diacritics_matching_bidirectional ... ok
test search::tests::test_empty_and_whitespace_query_fallbacks ... ok
test search::tests::test_normalization ... ok
test search::tests::test_order_independent_words_in_title ... ok
test search::tests::test_ranking_exact_title_ranks_first ... ok
test search::tests::test_ranking_title_prefix_outranks_content_match ... ok
test search::tests::test_snippet_generation_boundary_conditions ... ok
test search::tests::test_snippet_multibyte_utf8_boundary ... ok
test search::tests::test_typo_tolerant_match ... ok
test search::tests::test_unrelated_query_is_unmatched ... ok
test database::tests::test_adjacent_note_10k_bench ... ignored
test database::tests::test_big_note_write_benchmarks ... ignored
test database::tests::test_condition6_benchmarks ... ignored
test database::tests::test_hybrid_search_comparison_and_triggers ... ignored
test database::tests::test_real_db_search_benchmark ... ignored

test result: ok. 28 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.08s
```

---

## 4. Stability Evaluation
No crashes, segmentation faults, race conditions, or unhandled panics were encountered across the entire automated test suites.

