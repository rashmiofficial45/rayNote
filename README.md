# rayNote

> **A minimal, always-on-top floating note-taking app for macOS — inspired by Raycast Notes.**

rayNote is a hyper-fast, distraction-free notes companion built with **Tauri v2 (Rust) + React 19 + TypeScript + TipTap v3 + SQLite FTS5**. It floats above every app — including fullscreen spaces — and is summoned in milliseconds via a global hotkey.

---

## ✨ Highlights

- 🚀 **~240ms cold start**, **<10ms hotkey toggle**, **~42MB idle RAM**
- 📌 **Always-on-top NSPanel** at window level 1000 — above fullscreen Xcode, Chrome, Final Cut Pro
- ⌨️ **Global hotkeys** `⌘⇧Space` / `⌘⇧N` to toggle from anywhere in macOS
- 📝 **TipTap v3** rich-text editor with Slash commands, task lists, code highlighting (20+ languages)
- 💾 **SQLite + FTS5** with WAL mode — sub-millisecond full-text search across all notes
- 🎨 **6 accent themes**, 3 color modes (Dark / Light / System), 6 typography families
- 🔒 **Zero data loss** triple-save architecture (300ms debounce + blur + unmount)

---

## 🏗️ Tech Stack

| Layer | Technologies |
|---|---|
| **Native Backend** | Rust 2021 · Tauri v2 · objc2 · tauri-nspanel |
| **Database** | SQLite 3 (bundled) · rusqlite 0.31 · FTS5 |
| **Frontend** | React 19 · TypeScript 6 · Vite 8 |
| **Editor** | TipTap v3 · ProseMirror |
| **Styling** | Tailwind CSS v4 · Vanilla CSS tokens |
| **Package Manager** | pnpm |

---

## 📋 Prerequisites

Before running rayNote locally, ensure you have all of the following installed:

### 1. Rust & Cargo
```bash
# Install via rustup (recommended)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify installation
rustc --version   # rustc 1.78.0 or later
cargo --version
```

### 2. Node.js
```bash
# Install via nvm (recommended) or from https://nodejs.org
nvm install --lts
node --version   # v20 or later
```

### 3. pnpm
```bash
# Install globally via npm
npm install -g pnpm

# Verify installation
pnpm --version   # v9 or later
```

### 4. Tauri CLI v2
```bash
# Installed automatically as a dev dependency, but also available globally
cargo install tauri-cli --version "^2"
```

### 5. macOS System Requirements
- **macOS 10.15 Catalina or later** (Sonoma / Sequoia recommended)
- **Xcode Command Line Tools:**
  ```bash
  xcode-select --install
  ```
- Apple Silicon (M1/M2/M3) or Intel Mac

> **Note:** rayNote uses macOS-exclusive APIs (`NSPanel`, `NSWindowCollectionBehavior`, Objective-C runtime via `objc2`). **Windows and Linux are not supported.**

---

## 🚀 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/your-username/rayNote.git
cd rayNote
```

### 2. Install frontend dependencies
```bash
pnpm install
```

### 3. Run in Development Mode (recommended)
```bash
pnpm tauri dev
```

This command:
- Starts the **Vite dev server** on `http://localhost:1420` (with Hot Module Replacement)
- Compiles the **Rust backend** in debug mode
- Opens the rayNote floating window with DevTools accessible

> **First run takes longer** (~2–5 min) while Cargo downloads and compiles all Rust crates. Subsequent runs are fast.

---

## 🌍 Running for Different Environments

### Development (`dev`)

Fast iteration with HMR, Rust debug symbols, and verbose logging.

```bash
pnpm tauri dev
```

| Property | Value |
|---|---|
| Frontend URL | `http://localhost:1420` |
| HMR WebSocket | `ws://localhost:1421` |
| Rust build profile | `debug` |
| Binary size | ~50–80 MB (unoptimized) |
| Rust logs | Printed to terminal via `eprintln!` |
| DevTools | Enabled (right-click → Inspect) |

**Environment variables for dev:**
```bash
# Optionally set a remote dev host (for remote Tauri development)
TAURI_DEV_HOST=<your-ip> pnpm tauri dev
```

---

### Production Build (`build`)

Fully optimized binary with LTO, stripped debug symbols, and bundled `.dmg`/`.app`.

```bash
pnpm tauri build
```

| Property | Value |
|---|---|
| Frontend | Vite production build into `dist/` |
| Rust build profile | `release` (LTO · codegen-units=1 · opt-level=3 · stripped) |
| Output artifacts | `src-tauri/target/release/bundle/` |
| Bundle targets | `.dmg` and `.app` (macOS) |
| Binary size | ~10–15 MB (optimized) |

**Output locations after build:**
```
src-tauri/target/release/bundle/
├── dmg/
│   └── rayNote_0.1.0_aarch64.dmg   # Distributable disk image
└── macos/
    └── rayNote.app                 # App bundle (drag to /Applications)
```

To build only the frontend (no Tauri bundle):
```bash
pnpm build        # Runs: tsc && vite build → output in dist/
```

To preview the built frontend in a browser (no Tauri):
```bash
pnpm preview
```

---

### Debug Build (verbose Rust output)

To run with extra Rust diagnostic output logged to the terminal:

```bash
RUST_LOG=debug pnpm tauri dev
```

To see only rayNote-specific logs:
```bash
RUST_LOG=raynote=debug pnpm tauri dev
```

> Diagnostic panel configuration info is also printed in `debug_assertions` mode automatically (visible in terminal during `pnpm tauri dev`).

---

### Build for a Specific Target Architecture

```bash
# Apple Silicon (ARM64)
pnpm tauri build --target aarch64-apple-darwin

# Intel Mac (x86_64)
pnpm tauri build --target x86_64-apple-darwin

# Universal Binary (both architectures — works on all Macs)
pnpm tauri build --target universal-apple-darwin
```

> **Universal Binary** requires both Rust targets to be installed:
> ```bash
> rustup target add aarch64-apple-darwin x86_64-apple-darwin
> ```

---

## 📁 Project Structure

```
rayNote/
├── src/                          # React + TypeScript frontend
│   ├── main.tsx                  # Entry point — routes to App or SettingsApp
│   ├── App.tsx                   # Main floating notes window
│   ├── SettingsApp.tsx           # Settings window (multi-pane)
│   ├── index.css                 # Global styles, Tailwind v4, CSS tokens
│   ├── components/               # Reusable UI components
│   ├── editor/                   # TipTap editor, extensions, SlashCommand
│   ├── lib/                      # theme.ts, settingsSync.ts, aliases.ts
│   └── assets/                   # Fonts, icons
│
├── src-tauri/                    # Rust + Tauri backend
│   ├── src/
│   │   ├── main.rs               # Binary entry point
│   │   ├── lib.rs                # Tauri setup, NSPanel config, global shortcuts
│   │   ├── commands.rs           # All Tauri IPC command handlers
│   │   └── database.rs           # SQLite + FTS5 persistence layer
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri app configuration
│   ├── capabilities/             # Tauri v2 permission scopes
│   └── icons/                    # App icons (PNG, ICNS, ICO)
│
├── public/                       # Static assets served as-is
├── index.html                    # HTML shell
├── vite.config.ts                # Vite + Tailwind configuration
├── tsconfig.json                 # TypeScript config
├── package.json                  # npm scripts and JS dependencies
└── pnpm-lock.yaml                # Lockfile
```

---

## 🗄️ Data Storage

rayNote stores all data **locally on your Mac**. No cloud, no telemetry.

| File | Location | Purpose |
|---|---|---|
| `raynote.db` | `~/Library/Application Support/com.raynote.desktop/` | SQLite database (all notes + FTS5 index) |
| `window_state.json` | Same directory | Saved window position and size |
| `window_size.json` | Same directory | Saved window dimensions (legacy fallback) |
| `menubar_preference.json` | Same directory | Menu bar icon preference |

To open the data folder from within the app: **Settings (`⌘,`) → Storage → Open in Finder**

---

## ⌨️ Key Shortcuts (Quick Reference)

| Action | Shortcut |
|---|---|
| **Toggle window (global)** | `⌘⇧Space` or `⌘⇧N` |
| **New note** | `⌘N` |
| **Quick Open / Browse notes** | `⌘P` |
| **Command Palette** | `⌘K` |
| **Find & Replace in note** | `⌘F` |
| **Open Settings** | `⌘,` |
| **Export note as Markdown** | `⇧⌘E` |
| **Pin / Unpin note** | `⇧⌘P` |
| **Hide window** | `⌘W` |
| **Quit** | `⌘Q` |

> Full shortcut reference: **In-app `⌘/`** or see [`NOTEFAST_APP_DOCUMENTATION.md`](./NOTEFAST_APP_DOCUMENTATION.md).

---

## 🛠️ Troubleshooting

### Port 1420 already in use
Vite requires port 1420 to be free (strict mode). Kill whatever is using it:
```bash
lsof -ti :1420 | xargs kill -9
```

### Rust compilation errors on first run
Make sure Xcode CLT are installed and up to date:
```bash
xcode-select --install
sudo xcode-select --switch /Library/Developer/CommandLineTools
```

### `tauri: command not found`
Install the Tauri CLI globally or use the local dev dependency:
```bash
# Option A — via cargo
cargo install tauri-cli --version "^2"

# Option B — use pnpm dlx
pnpm dlx @tauri-apps/cli dev
```

### Window does not appear on first launch
The app runs as a macOS **Accessory** (no Dock icon by design). Use the global shortcut `⌘⇧Space` to summon it, or look for the menu bar icon in the top-right of your screen.

### Slow first Cargo build
This is expected. Rust is compiling all dependencies (including SQLite, objc2, and Tauri plugins) from source. Subsequent builds use Cargo's incremental cache and are fast.

---

## 📦 Scripts Reference

| Command | Description |
|---|---|
| `pnpm install` | Install all JS/TS dependencies |
| `pnpm dev` | Start Vite frontend dev server only (no Tauri) |
| `pnpm build` | TypeScript check + Vite production build |
| `pnpm preview` | Preview the production Vite build in browser |
| `pnpm tauri dev` | **Full dev mode** — Vite + Rust backend + app window |
| `pnpm tauri build` | **Full production build** — optimized binary + `.dmg`/`.app` |

---

## 📄 License

MIT — see [`LICENSE`](./LICENSE).

---

> **Full architecture documentation, feature inventory, and keyboard shortcut cheatsheet:** [`NOTEFAST_APP_DOCUMENTATION.md`](./NOTEFAST_APP_DOCUMENTATION.md)
