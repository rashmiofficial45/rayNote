# rayNote Architecture, Database & Feature File Map

This document serves as the persistent memory and authoritative architectural reference for rayNote (formerly NoteFast). All agents working in this repository should consult this reference.

---

## 1. Database Architecture & Persistence Layer

### Embedded SQLite & Connection Topology
- **File**: Located at macOS Application Support `com.raynote.desktop/notefast.db` (or test/bench path).
- **Dual Connections (Reader / Writer)** in WAL mode:
  - Writer: `Mutex<Connection>` with PRAGMA `synchronous = NORMAL`, `cache_size = -1000`, `temp_store = MEMORY`, `journal_size_limit = 8388608`.
  - Reader: `Mutex<Connection>` opened read-only (`SQLITE_OPEN_READ_ONLY`) with PRAGMA `query_only = true`.
- **In-Memory Metadata Cache**:
  - `RwLock<Option<Arc<Vec<NoteSummary>>>>` + `cache_gen: AtomicU64` in `Database`.
  - Maintained in-place across insertions, updates, and pin toggles with canonical sorting (`is_pinned DESC`, `updated_at DESC`, `id ASC`).
  - Precomputes lowercase titles to provide zero-alloc search & list queries.

### Schemas & Migrations (Gated by `PRAGMA user_version`)
1. **`notes` Table**:
   - `id TEXT PRIMARY KEY`: UUID v4.
   - `title TEXT NOT NULL DEFAULT ''`: Extracted first-line title.
   - `content TEXT NOT NULL DEFAULT ''`: TipTap JSON document representation or plain text.
   - `preview TEXT NOT NULL DEFAULT ''`: Plain-text preview truncated to 120 chars.
   - `search_text TEXT NOT NULL DEFAULT ''`: Extracted human-readable plain text stripping JSON/HTML tokens.
   - `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`: ISO 8601 strings.
   - `is_pinned INTEGER NOT NULL DEFAULT 0`: Pinned status boolean.
   - **Covering Indexes**: `idx_notes_covering` on `(is_pinned DESC, updated_at DESC, id, title, preview, created_at)` and `idx_notes_updated_at` on `(updated_at DESC)`.

2. **`trashed_notes` Table**:
   - Contains soft-deleted notes with `trashed_at TEXT NOT NULL`.
   - Supports restore (`restore_trashed_note`) and permanent purge (`purge_trashed_note`).

3. **`notes_fts` Virtual Table (FTS5)**:
   - `USING fts5(id UNINDEXED, title, search_text, tokenize='unicode61')`.
   - Triggers: `notes_fts_ai` (AFTER INSERT), `notes_fts_ad` (AFTER DELETE), `notes_fts_au` (AFTER UPDATE of title/search_text).
   - Startup self-heal check verifies `notes_count == notes_fts_count`.

---

## 2. Feature-to-File Matrix

| Feature Domain | Feature Name | Core Files | Description |
| :--- | :--- | :--- | :--- |
| **Database & Persistence** | SQLite Engine & Migrations | `src-tauri/src/database.rs` | Connection pool, migrations v0-v6, WAL mode, schema definitions, FTS triggers. |
| | Native IPC Commands | `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` | Tauri commands for CRUD, search, trash, window geometry, export, clipboard. |
| | Frontend DB Bridge | `src/lib/db.ts` | Type-safe wrappers invoking Tauri commands, active note snapshot clearing, keyset paging. |
| | LocalStorage & Recovery | `src/lib/storage.ts` | Safe localStorage access, emergency snapshots, coalesced writes. |
| | In-Memory LRU Cache | `src/lib/noteCache.ts` | 0ms instant note switching cache layer. |
| | Save Status State | `src/lib/saveStatusStore.ts` | Reactive listeners for unsaved/saving/saved status. |
| | Save Queue & Flush | `src/lib/editorFlush.ts` | Debounced autosave, emergency exit flush, handoffs. |
| | Note Deletion & Purge | `src/lib/noteDeletion.ts` | Safe deletion dispatch and IPC wiring. |
| | Search Ranking | `src/lib/searchRanking.ts`, `src-tauri/src/search.rs` | Multi-pass BM25 + fuzzy title prefix scoring with recency boost. |
| **Editor (TipTap/ProseMirror)** | Core Editor Component | `src/editor/Editor.tsx` | TipTap instance lifecycle, keybindings, event handling, paste normalizer. |
| | Extensions Pipeline | `src/editor/extensions.ts` | Bundles StarterKit, task lists, code block highlight, search, images, etc. |
| | Image Support, Resizing & Crop | `src/editor/ImageExtension.ts`, `src/editor/ImageComponent.tsx`, `src/editor/ImageCropModal.tsx` | Notion-style resizable image block, pixel-fixed resizing with edge pill handles, full-screen crop modal with aspect ratio presets (1:1, 4:3, 16:9, etc.) and canvas export, alignment, download, and deletion. |
| | Code Blocks & Syntax | `src/editor/CodeBlockComponent.tsx`, `src/editor/FloatingCodeBlockToolbar.tsx`, `src/editor/useCodeLanguageMenuLayout.ts` | Custom React NodeView, dynamic Lowlight syntax highlighting, language selector. |
| | Fullscreen Block Zoom | `src/editor/FullscreenBlockControls.tsx`, `src/editor/fullscreenBlockActions.ts` | Isolates current block (code, table, text) into full-focus modal. |
| | Context Menu | `src/editor/EditorContextMenu.tsx`, `src/editor/contextMenuUtils.ts` | Native-feeling right-click context menu with formatting and export shortcuts. |
| | Slash Command Menu | `src/editor/SlashCommand.tsx` | Notion-style `/` menu for inserting headings, lists, tables, code blocks. |
| | Block Drag & Selection | `src/extensions/BlockSelection.ts`, `src/extensions/useBlockDrag.ts`, `src/extensions/useAutoScroll.ts` | ProseMirror plugins for visual block selection and drag-and-drop reordering. |
| | Smooth Caret | `src/components/SmoothCaret.tsx` | Animated, fluid cursor movement matching macOS text engines. |
| | Markdown Parsing & Utils | `src/editor/markdownUtils.ts`, `src/lib/utils.ts` | Markdown import/export, title extraction, HTML/JSON serialization. |
| | Editor Shortcuts | `src/editor/shortcutsExtension.ts`, `src/editor/clickSelectionExtension.ts`, `src/editor/horizontalRuleExtension.ts` | Rich text keyboard shortcuts, triple-click line selection, HR divider support. |
| **UI Components & Windows** | Main App Shell | `src/App.tsx`, `src/main.tsx` | Master view orchestrator, global shortcut coordinator, drop-zone handler. |
| | Title Bar & Window Chrome | `src/components/TitleBar.tsx`, `src/components/WindowResizeHandles.tsx` | Liquid Glass frameless titlebar, native macOS drag-handle, window resizing. |
| | Bottom Toolbar | `src/components/BottomToolbar.tsx` | Word/char counter, save status indicator, lock/pin/trash quick toggles. |
| | Smart Search (⌘P) | `src/components/SmartSearch.tsx` | Raycast-style instant note search dialog with keyboard navigation. |
| | Command Palette (⌘K) | `src/components/CommandPalette.tsx`, `src/components/PaletteSubViews.tsx` | Global command dispatcher (export, zoom, settings, actions, aliases). |
| | In-Editor Find Bar (⌘F) | `src/components/FindBar.tsx`, `src/editor/searchExtension.ts` | In-document find and replace bar with match highlights. |
| | Document Navigation Slider | `src/components/DocumentTickSlider.tsx` | Mini document overview slider for scrubbing long notes. |
| | Trash Management | `src/components/TrashDialog.tsx`, `src/components/MoveToTrashDialog.tsx` | Review, restore, or permanently purge soft-deleted notes. |
| | Switch Conflict Guard | `src/components/SwitchConflictModal.tsx` | Prevents data loss when navigating notes while background saves are pending. |
| | Markdown File Viewer | `src/components/MarkdownViewerModal.tsx` | Zero-write preview modal for external markdown files dropped onto the app. |
| | Keyboard Shortcuts Cheat Sheet | `src/components/ShortcutsModal.tsx` | Overlay showing all active app hotkeys. |
| | Fullscreen & Window Mode | `src/components/TitleBar.tsx`, `src/App.tsx`, `src-tauri/src/commands.rs` | Toggle fullscreen shortcut (`⌃F` / `Control+F` or `✦F`), green window button tooltip, native Cocoa panel zoom. |
| | Settings Window | `src/SettingsApp.tsx` | Multi-tab settings panel (Appearance, Shortcuts, Database, About). |
| **Styling & System Integration** | Liquid Glass Theme System | `src/lib/theme.ts`, `src/index.css`, `.agents/skills/liquid-glass-design/SKILL.md` | Apple Liquid Glass translucent materials, dark/light modes, accent colors. |
| | Settings Sync Bus & Hyper Key | `src/lib/settingsSync.ts`, `src/lib/commandsConfig.ts` | Cross-window broadcast channel, hotkey parsing, Hyper key engine (`✦`, Caps Lock modifier tracking, Karabiner 4-mod support). |
| | Zoom & Typography | `src/lib/zoom.ts` | Document and UI zoom scaling with memory persistence. |
| | Native macOS Window Controls | `src-tauri/src/window_geometry.rs` | Frameless window geometry caching, screen snapping, and borderless dragging. |
