# rayNote Production Performance, Memory Leak, Energy & Stability Audit — Methodology

> **Audit Date:** October 30, 2026
> **Target Application:** `rayNote.app` (macOS Universal ARM64 Release Build)
> **Environment:** macOS 27.2 (Darwin 26B123), Apple M3, 8 GB Unified Memory
> **Source Commit:** `dff544900680a1d91e4aa347b5dadfb641f6d00f`
> **Installed App Location:** `/Applications/rayNote.app` (Binary: `Contents/MacOS/raynote`)
> **Binary Checksum (MD5):** `f9bead6106e9acaabbef527677ad4824` (matches `src-tauri/target/aarch64-apple-darwin/release/raynote`)

---

## 1. Activated Skills & Methodological Principles

### Skill Status & Availability
- **`memory-leak-debugging`** (`~/.gemini/config/plugins/chrome-devtools-plugin/skills/memory-leak-debugging/`): **LOADED**. Applied to WebKit/DOM retaining analysis, detached DOM node auditing, and closure retention rules.
- **`chrome-devtools`** (`~/.gemini/config/plugins/chrome-devtools-plugin/skills/chrome-devtools/`): **LOADED**. Applied to WKWebView lifecycle and rendering analysis.
- **`modern-web-guidance`** (`~/.gemini/config/plugins/modern-web-guidance-plugin/skills/modern-web-guidance/`): **LOADED**. Applied to CSS/JS layout and render costs.
- **`debug-optimize-lcp`** (`~/.gemini/config/plugins/chrome-devtools-plugin/skills/debug-optimize-lcp/`): **LOADED**. Applied to hydration and paint benchmarks.
- **`systematic-debugging`**, **`performance`**, **`performance-optimization`**, **`observability-and-instrumentation`**, **`debugging-strategies`**, **`browser-testing-with-devtools`**, **`web-perf`**, **`web-quality-audit`**, **`code-review-and-quality`**, **`test-driven-development`**: Searched global and workspace locations; these named skill files were not present as discrete plugins on this system. Their foundational methodologies (monotonic timing, multi-run statistical distributions, isolated process attribution, dirty memory isolation, non-destructive test isolation) are directly implemented in our custom audit harness.

---

## 2. Process Architecture & Memory Accounting

rayNote runs as a multi-process architecture on macOS:

1. **Native Host Process (`raynote`)**:
   - Manages SQLite persistence (`raynote.db`), WAL mode, full-text search (`notes_fts`), and Cocoa `NSPanel` floating window lifecycle.
   - Profiled via `/usr/bin/footprint`, `/bin/ps`, `/usr/bin/top`, `/usr/bin/vmmap`, and `/usr/bin/leaks`.

2. **Renderer Runtime Process (`com.apple.WebKit.WebContent`)**:
   - Hosts React 19, TipTap / ProseMirror editor, DOM elements, and the in-memory LRU cache (`NoteLRUCache`).
   - Profiled separately from the native process.

### Memory Metrics & Additive Properties
- **Resident Set Size (RSS, `ps -o rss`)**: Measures all virtual memory pages mapped into the process's page table. In macOS, RSS includes shared system dynamic libraries and read-only dyld caches (`__TEXT`, `__OBJC_RO`, `__LINKEDIT`). **RSS is NOT additive**: summing RSS across processes double-counts shared system frameworks.
- **Physical Memory Footprint (`footprint`)**: Measures the unevictable dirty memory physically backed by RAM. This is the canonical Apple system metric determining memory pressure and jetsam threshold.
- **Private Dirty Memory**: Dirty anonymous memory exclusive to the process.
- **IOSurface / Graphics Memory**: Hardware-accelerated surface buffers shared between WebKit and the Window Server / Native process.

---

## 3. Benchmark Workload Definitions

| Workload ID | Description | Operations / Target | Sampling / Measurement |
| :--- | :--- | :--- | :--- |
| **A-LAUNCH** | Cold vs. Warm process launch | 5 cold + 5 warm restarts | Monotonic latency to key window, initial footprint |
| **B-IDLE** | Resource consumption at rest | 60s visible + 60s hidden | Footprint, CPU %, thread count, wakeups |
| **C-ENDURANCE** | Note switching under load | 100, 500, 1000, 3x2000 switches | Continuous sampling every 200 ops, cooldown 10s, 30s, 60s |
| **D-EDITOR** | Rapid typing, undo/redo, autosave | 500 chars, 50 undo/redo, format | Input latency, pending autosave flush recovery |
| **E-CRUD** | SQLite database operations | 500 create, 500 update, 200 search, 200 delete | Latency distributions, WAL file growth |
| **F-LEAKS** | Mach zone & heap leak analysis | System leak diagnostics | `/usr/bin/leaks`, `vmmap -summary`, `footprint` |
| **G-WINDOW** | macOS window lifecycle | 50 show/hide cycles, resize | Toggle latency, focus restoration |
| **H-ENERGY** | CPU & energy impact | Idle vs. Typing vs. Switching | CPU percentage, wakeups (`hover_focus_tick`) |
| **I-BUNDLE** | Frontend bundle composition | Production `dist/assets` | Raw & gzipped sizes, chunk composition |
| **J-TESTS** | Automated test suites | Vitest, Cargo, TypeScript | Pass/fail counts, execution duration |

---

## 4. Test Safety & Non-Destructive Invariants

1. **User Data Protection**: All real user notes in `~/Library/Application Support/com.raynote.desktop/` were fully backed up to `~/raynote_user_backup_20261030_010842/` before initiating testing.
2. **Disposability**: Synthetic note insertions and deletions use isolated `/tmp` database copies or strictly prefixed IDs (`bench-%`, `bench-audit-crud-%`).
3. **Disruptive System Actions**: macOS system sleep/wake and root-level commands (`powermetrics`, `purge`) are noted as requiring elevated permissions and were omitted to preserve system stability.

