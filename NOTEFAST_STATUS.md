# NoteFast — Feature Status & Architecture Report

> Generated: 2026-10-01 | Version: 0.1.0

---

## Project Structure

```
NoteFast/
├── src/                          # Frontend (React + Tiptap)
│   ├── App.tsx                   # Main app shell, state management, keyboard shortcuts
│   ├── main.tsx                  # React entry point
│   ├── index.css                 # All styles (1300+ lines, dark theme)
│   ├── vite-env.d.ts
│   ├── components/
│   │   ├── TitleBar.tsx          # Custom title bar with red X, delete, command menu
│   │   ├── BottomToolbar.tsx     # Single bottom-right format button with popover palette
│   │   ├── CommandPalette.tsx    # ⌘K command palette + ⌘P note browser
│   │   ├── FindBar.tsx           # ⌘F in-note search with replace
│   │   ├── NoteEditor.tsx        # Wrapper that passes note data to Editor
│   │   ├── NoteList.tsx          # Browse notes list view
│   │   ├── ShortcutsModal.tsx    # ⌘/ keyboard shortcuts cheatsheet
│   │   ├── SmoothCaret.tsx       # VS Code-style smooth blinking caret
│   │   └── Toast.tsx             # HUD toast notification
│   ├── editor/
│   │   ├── Editor.tsx            # Tiptap editor instance, debounced saves
│   │   ├── extensions.ts         # All Tiptap extensions config
│   │   ├── SlashCommand.tsx      # Slash command menu (/ trigger)
│   │   ├── shortcutsExtension.ts # Custom keyboard shortcuts (⌘B, ⌘I, etc.)
│   │   ├── horizontalRuleExtension.ts  # Smart HR (--- auto-convert)
│   │   └── searchExtension.ts    # In-note search highlight marks
│   └── lib/
│       ├── db.ts                 # Frontend DB API (invoke wrappers)
│       └── utils.ts              # MD export, title extraction, helpers
├── src-tauri/                    # Backend (Rust + Tauri 2)
│   ├── src/
│   │   ├── main.rs               # Binary entry point
│   │   ├── lib.rs                # App setup, NSPanel, global shortcuts
│   │   ├── commands.rs           # Tauri commands (CRUD, drag, hide)
│   │   └── database.rs           # SQLite WAL storage layer
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Window config (380×600, no decorations)
│   └── Info.plist                # macOS bundle metadata
├── package.json                  # Node dependencies
├── vite.config.ts                # Vite + React + Tauri dev server
├── tsconfig.json                 # TypeScript config
└── postcss.config.js             # PostCSS (Tailwind v4)
```

---

## Feature Checklist

### 1. Native Window Behavior

| Feature | Status | Notes |
|---------|--------|-------|
| Always on top (level 1000) | ✅ Working | NSPanel with `setLevel: 1000` |
| Visible on fullscreen apps | ✅ Working | `FullScreenAuxiliary` + `CanJoinAllSpaces` collection behavior |
| Visible across all Spaces | ✅ Working | `CanJoinAllSpaces` bit set |
| First drag (no jump) | ✅ Fixed | Custom `start_native_drag` with `convertPointFromScreen` |
| Repeated drag | ✅ Working | Consistent after the coordinate fix |
| Hide/Show toggle | ✅ Working | `⌘⇧Space` or `⌘⇧N` toggles panel visibility |
| Red X hides (not quit) | ✅ Working | Calls `hide_window` → panel.hide(), app stays alive |
| Sleep/Wake persistence | ⚠️ Untested | NSPanel should persist, but `setHidesOnDeactivate: false` is set |
| Non-activating panel | ✅ Working | `NSWindowStyleMaskNonactivatingPanel` bit set |
| Accessory activation policy | ✅ Working | No Dock icon, lives in background |
| Window position & size persistence | ✅ Working | Saved on drag/resize to `window_state.json`, restored on restart |

### 2. Editor Features

| Feature | Status | Notes |
|---------|--------|-------|
| Notion-like title (first line) | ✅ Working | First line auto-styled as title via CSS, not forced H1 |
| Smooth caret animation | ✅ Working | VS Code-style with `cubic-bezier` transitions |
| Slash commands (`/`) | ✅ Working | h1, h2, h3, todo, bullet, ordered, blockquote, code, hr |
| Headings (H1/H2/H3) | ✅ Working | Via slash commands and keyboard shortcuts |
| Task lists | ✅ Working | `⌘⇧9` or `/todo`, checkbox toggle with `⌘Enter` |
| Bold/Italic/Strike/Underline | ✅ Working | Standard shortcuts |
| Code blocks (syntax highlight) | ✅ Working | lowlight + CodeBlockLowlight |
| Inline code | ✅ Working | `⌘E` |
| Blockquote | ✅ Working | `⌘⇧B` |
| Links | ✅ Working | `⌘L`, autolink enabled |
| Highlight | ✅ Working | `⌘⇧H` |
| Horizontal rule | ✅ Working | `---` auto-converts, smooth hover glow |
| Typography (smart quotes) | ✅ Working | Tiptap Typography extension |
| Undo/Redo (50 depth) | ✅ Working | Configured in StarterKit |
| Default zoom 120% | ✅ Working | Persisted in localStorage |
| Zoom in/out/reset | ✅ Working | `⌘+`, `⌘-`, `⌘0` |

### 3. Note Management

| Feature | Status | Notes |
|---------|--------|-------|
| Create note | ✅ Working | `⌘N`, starts with empty paragraph |
| Delete note (with confirmation) | ✅ Working | Checkbox confirmation dialog before delete |
| Duplicate note | ✅ Working | `⌘D` |
| Pin/Unpin note | ✅ Working | `⇧⌘P`, pinned notes sort to top |
| Browse notes | ✅ Working | `⌘P` opens note browser |
| Navigate notes (⌥↑/↓) | ✅ Working | Next/previous note |
| History navigation (⌘[/]) | ✅ Working | Back/forward in note history |
| Auto-save (debounced 300ms) | ✅ Working | Flushes on unmount to prevent data loss |
| Title extraction from content | ✅ Working | First line text = title |
| Persist active note across relaunch | ✅ Working | localStorage saves active note ID |

### 4. Export & Copy

| Feature | Status | Notes |
|---------|--------|-------|
| Copy as Markdown | ✅ Working | `⇧⌘C` |
| Copy as Plain Text | ✅ Working | Via command palette |
| Copy deeplink | ✅ Working | `⇧⌘D` → `notefast://note/<id>` |
| Export single note (.md) | ✅ Working | `⇧⌘E` |
| Export all notes (.md) | ✅ Working | Via command palette |

### 5. UI/UX

| Feature | Status | Notes |
|---------|--------|-------|
| Custom title bar (no decorations) | ✅ Working | 44px height, rounded corners |
| Single red X close button | ✅ Working | 16px, shows × icon, hides panel |
| Delete button (trash icon) | ✅ Working | Opens confirmation dialog |
| Command button (⌘ icon) | ✅ Working | Popover with Duplicate/New/Command Palette |
| Double-click title bar (no text select) | ✅ Fixed | `user-select: none` on all children |
| Bottom formatting toolbar | ✅ Working | Compact pill with expand on click |
| Command palette (⌘K) | ✅ Working | Actions view with search |
| Note browser (⌘P) | ✅ Working | Browse/switch notes with search |
| Keyboard shortcuts modal (⌘/) | ✅ Working | Searchable grid of all shortcuts |
| Toast notifications | ✅ Working | HUD-style bottom center |
| Find in note (⌘F) | ✅ Working | Find bar with match count, navigation |
| Find & Replace | ✅ Working | Replace one / replace all |
| Rounded border (28px) | ✅ Working | App shell has 28px border-radius |
| Dark theme | ✅ Working | Matte obsidian (#18181b) |
| Scrollbar styling | ✅ Working | 6px thin, dark theme |

### 6. Storage

| Feature | Status | Notes |
|---------|--------|-------|
| SQLite database | ✅ Working | WAL mode, app data dir |
| All data on-device | ✅ Working | No network, no cloud |
| Indexes (updated_at, pinned) | ✅ Working | Fast sorting |
| PRAGMA optimizations | ✅ Working | WAL, NORMAL sync, memory temp store |

---

## Not Yet Implemented

### 3. Search — SQLite FTS5
| Feature | Status | Notes |
|---------|--------|-------|
| Full-text search (FTS5) | ❌ Not implemented | Currently search is in-note only (ProseMirror marks) |
| Cross-note search | ❌ Not implemented | Requires FTS5 virtual table in SQLite |

### 4. Settings
| Feature | Status | Notes |
|---------|--------|-------|
| Settings panel | ❌ Not implemented | No UI for preferences |
| Theme toggle | ❌ Not implemented | Dark mode only |
| Font size config | ❌ Not implemented | Only zoom level |
| Startup behavior config | ❌ Not implemented | Always starts as Accessory |

### 5. Menu Bar Integration
| Feature | Status | Notes |
|---------|--------|-------|
| macOS menu bar icon | ❌ Not implemented | App runs as Accessory (no Dock/menu bar) |
| System tray / status item | ❌ Not implemented | Would need `tauri-plugin-system-tray` |
| Quick capture from menu bar | ❌ Not implemented | Planned for Phase 4 |

### 6. Production Packaging
| Feature | Status | Notes |
|---------|--------|-------|
| Signed .app bundle | ❌ Not done | `tauri.conf.json` has bundle targets configured |
| Notarized .dmg | ❌ Not done | Requires Apple Developer ID |
| Auto-update | ❌ Not implemented | No update mechanism |
| App icon | ⚠️ Placeholder | Default Tauri icons |

---

## Performance Profile (Estimated)

| Metric | Expected | Notes |
|--------|----------|-------|
| Idle RAM | ~30-50 MB | 1 WebView + 1 React root + 1 Tiptap |
| Typing RAM | ~40-60 MB | Debounced saves, no unnecessary re-renders |
| CPU (idle) | ~0% | No polling, no background network |
| Startup time | < 1s | Pre-compiled Rust, minimal JS bundle |
| Hide/Show latency | < 50ms | Native `panel.show_and_make_key()` |

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Tauri 2 | ^2 |
| UI Framework | React | ^19.1.0 |
| Editor | Tiptap | ^3.31.3 |
| Database | rusqlite (SQLite) | 0.31 (bundled) |
| Styling | Tailwind CSS v4 + Vanilla CSS | ^4.3.3 |
| Build Tool | Vite | ^8.0.16 |
| Language (frontend) | TypeScript | ~6.0.3 |
| Language (backend) | Rust | 2021 edition |
| Window Manager | tauri-nspanel | 2.1 |
| Icons | lucide-react | ^1.48.0 |
| Syntax Highlighting | lowlight | ^3.3.0 |

---

## Architecture Diagram

```
┌──────────────────────────────────────────┐
│              macOS (NSPanel)             │
│  level=1000 | CanJoinAllSpaces | NonAct  │
├──────────────────────────────────────────┤
│           Tauri 2 (Rust)                 │
│  ┌─────────────┐  ┌──────────────────┐   │
│  │  commands.rs │  │   database.rs    │   │
│  │  - CRUD      │  │  - SQLite WAL    │   │
│  │  - drag      │  │  - Notes table   │   │
│  │  - hide      │  │  - Indexes       │   │
│  └─────────────┘  └──────────────────┘   │
├──────────────────────────────────────────┤
│          WebView (WKWebView)             │
│  ┌──────────────────────────────────┐    │
│  │          React 19                │    │
│  │  ┌────────────────────────────┐  │    │
│  │  │      Tiptap Editor         │  │    │
│  │  │  - StarterKit              │  │    │
│  │  │  - SlashCommand            │  │    │
│  │  │  - SmoothCaret             │  │    │
│  │  │  - HorizontalRule          │  │    │
│  │  │  - Search marks            │  │    │
│  │  └────────────────────────────┘  │    │
│  │  ┌─────────┐ ┌────────────────┐  │    │
│  │  │TitleBar │ │CommandPalette  │  │    │
│  │  │BottomBar│ │FindBar | Toast │  │    │
│  │  └─────────┘ └────────────────┘  │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

---

## Remaining Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Tauri + Rust + NSPanel + Always-on-top | ✅ Complete |
| Phase 2 | React + Tiptap + SQLite | ✅ Complete |
| Phase 3 | Slash command palette | ✅ Complete |
| Phase 4 | Quick Capture (⌘⇧Space) | ✅ Complete (toggle) |
| Phase 5 | Search (SQLite FTS5) | ❌ Not started |
| Phase 6 | Menu bar + Settings + Polish | ❌ Not started |
| Production | Signed/notarized .dmg | ❌ Not started |
