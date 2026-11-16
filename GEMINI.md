# rayNote Agent Guidelines & Memory

See [AGENTS.md](file:///Users/rashmipersonal/Desktop/MAC Apps/rayNote/AGENTS.md) for full architectural maps, database schemas, and feature-to-file mappings.

## Core Rules for rayNote:
1. **Database & Persistence**:
   - SQLite WAL mode with dual reader/writer connections in [src-tauri/src/database.rs](file:///Users/rashmipersonal/Desktop/MAC Apps/rayNote/src-tauri/src/database.rs).
   - In-memory metadata cache is maintained in-place with precomputed lowercase titles (`title_lower`). Never invalidate without updating `cache_gen`.
   - All migrations are versioned under `PRAGMA user_version` (currently v6).
2. **Editor Performance**:
   - In-memory note caching ([src/lib/noteCache.ts](file:///Users/rashmipersonal/Desktop/MAC Apps/rayNote/src/lib/noteCache.ts)) ensures 0ms note switching.
   - Saves are debounced and coordinated via [src/lib/editorFlush.ts](file:///Users/rashmipersonal/Desktop/MAC Apps/rayNote/src/lib/editorFlush.ts) and [src/lib/saveStatusStore.ts](file:///Users/rashmipersonal/Desktop/MAC Apps/rayNote/src/lib/saveStatusStore.ts).
3. **UI / Design**:
   - Adheres to Apple Liquid Glass design language ([LIQUID_GLASS_DESIGN_SYSTEM.md](file:///Users/rashmipersonal/Desktop/MAC Apps/rayNote/LIQUID_GLASS_DESIGN_SYSTEM.md)).
