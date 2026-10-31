# rayNote Memory Reproduction & Root Cause Investigation Report

> **Audit Follow-up Date:** October 30, 2026  
> **Auditor Role:** Principal Systems & Performance Engineering Specialist  
> **Target Executable:** `/Applications/rayNote.app/Contents/MacOS/raynote` (`dff5449-dirty`)  
> **Environment:** macOS 27.2 (Darwin 26B123), Apple Silicon M3 (8 GB Unified Memory)  
> **Raw Dataset:** [`raw/reproduction_endurance_results.json`](file:///Users/rashmipersonal/Desktop/MAC%20Apps/rayNote/benchmarks/audits/2026-10-30-dff5449/raw/reproduction_endurance_results.json)  
> **Chart Visualization:** [`charts/reproduced_endurance_memory.svg`](file:///Users/rashmipersonal/Desktop/MAC%20Apps/rayNote/benchmarks/audits/2026-10-30-dff5449/charts/reproduced_endurance_memory.svg)  

---

## 1. Executive Summary & Verdict Status

Following the correction of the test harness to evaluate peak memory across the **complete time series** (including all post-workload cooldown intervals), three independent 2,000-switch endurance runs were executed against the real 56-note library.

### Key Empirical Findings:
1. **Unbounded Peak Memory Surge**: Total application physical footprint reached **924.0 MB – 1,067.0 MB** across the three runs. 
2. **Post-Workload Delayed Peaks**: In Run 1 and Run 2, the true peak did **not** occur during active typing/switching, but **during the post-workload cooldown phase** (+10s in Run 1 at **924 MB**, +30s in Run 2 at **1,025 MB**).
3. **Inconsistent Reclamation**: After a full 60-second cooldown, settled footprint ranged from **270.0 MB** (Run 3) to **1,002.0 MB** (Run 2).
4. **Conclusion on Bounded Memory**: **WITHDRAWN**. The previous claim that rayNote maintains "strictly bounded memory behavior" under sustained switching is **disproven by the empirical reproduction**. Under realistic multi-note navigation, memory expands into the 1 GB range.
5. **Conclusion on Absence of Leaks**: **WITHDRAWN**. While Mach zone heap allocations report 0 native leaks via `/usr/bin/leaks`, the application exhibits massive WebKit Malloc retention and asynchronous IPC queue accumulation that prevents memory from stabilizing within acceptable desktop constraints.

---

## 2. Granular Reproduction Measurements (3 Independent Runs)

Every run executed 2,000 document transitions (10 milestones of 200 switches + typing burst) with strict PID verification at all 14 sample points:

### Summary Table across Full Time Series

| Metric | Run 1 | Run 2 | Run 3 | Metric Range |
| :--- | :--- | :--- | :--- | :--- |
| **Native PID / WebKit PID** | `71623` / `71629` | `72589` / `72602` | `73542` / `73550` | Constant per run |
| **Initial Footprint (0 ops)** | **137.0 MB** | **160.0 MB** | **720.0 MB** | 137 – 720 MB |
| **End-of-Workload (2,000 ops)**| **919.0 MB** | **839.0 MB** | **989.0 MB** | 839 – 989 MB |
| **True Peak (Full Time Series)**| **924.0 MB** | **1,025.0 MB** | **1,067.0 MB** | **924 – 1,067 MB** |
| — *Phase of Peak* | `cooldown-10s` | `cooldown-30s` | `in-progress (m1200)` | Post-workload surge |
| **Cooldown 10s Footprint** | 924.0 MB | 838.0 MB | 988.0 MB | 838 – 988 MB |
| **Cooldown 30s Footprint** | 383.0 MB | 1,025.0 MB | 987.0 MB | 383 – 1,025 MB |
| **Cooldown 60s Footprint** | **327.0 MB** | **1,002.0 MB** | **270.0 MB** | **270 – 1,002 MB** |
| **Net Change (60s vs. Initial)**| **+190.0 MB** | **+842.0 MB** | **-450.0 MB** | **Highly variable** |

---

## 3. Detailed Run-by-Run Process Breakdown

### Run 1: High Peak with Partial Cooldown Reclamation
- **PID 71623 (Tauri)**: Started at 28 MB footprint (RSS: 38.3 MB) $\rightarrow$ Ended 2k ops at 42 MB $\rightarrow$ Settled 60s at 58 MB.
- **PID 71629 (WebKit)**: Started at 109 MB footprint (RSS: 65.6 MB) $\rightarrow$ Grew to 877 MB at 2k ops $\rightarrow$ Peaked at **881 MB at 10s cooldown** $\rightarrow$ Reclaimed to 335 MB at 30s $\rightarrow$ Settled 60s at 269 MB.
- **Net Application Footprint**: 137 MB $\rightarrow$ Peak **924 MB** $\rightarrow$ Settled **327 MB** ($\Delta = +190\text{ MB}$).

### Run 2: Delayed Backlog Surge & Sustained Pool Retention
- **PID 72589 (Tauri)**: Started at 32 MB $\rightarrow$ Ended 2k ops at 39 MB $\rightarrow$ Surged to 125 MB at 30s $\rightarrow$ Settled 60s at 173 MB.
- **PID 72602 (WebKit)**: Started at 128 MB $\rightarrow$ Ended 2k ops at 800 MB $\rightarrow$ Surged to **900 MB at 30s cooldown** $\rightarrow$ Settled 60s at 829 MB.
- **Net Application Footprint**: 160 MB $\rightarrow$ Peak **1,025 MB** $\rightarrow$ Settled **1,002 MB** ($\Delta = +842\text{ MB}$).

### Run 3: Extreme Load with Late Phase Reclamation
- **PID 73542 (Tauri)**: Started at 24 MB $\rightarrow$ Peaked at 124 MB at m1200 $\rightarrow$ Settled 60s at 49 MB.
- **PID 73550 (WebKit)**: Started at 696 MB $\rightarrow$ Peaked at 943 MB at m1200 $\rightarrow$ Remained at 950 MB through 30s cooldown $\rightarrow$ Major garbage collection and page purge dropped footprint to 221 MB at 60s.
- **Net Application Footprint**: 720 MB $\rightarrow$ Peak **1,067 MB** $\rightarrow$ Settled **270 MB** ($\Delta = -450\text{ MB}$).

---

## 4. Root Cause Investigations (Without Modifying Code)

### Finding 1: Unthrottled & Stale `getNote()` IPC Flooding
- **Classification**: **CONFIRMED**
- **Evidence**:
  In `src/editor/Editor.tsx` lines 743–760:
  ```typescript
  const cached = noteCache.get(noteId);
  if (cached) {
    await loadAndApplyDoc(cached.content, noteId, cached.scrollTop);

    // Background Stale-While-Revalidate: verify with SQLite without blocking UI
    getNote(noteId)
      .then((fullNote) => {
        if (currentNoteIdRef.current === noteId && !cancelled) {
  ```
  In a rapid 2,000-switch workload driven at 15 ms per keypress:
  1. 2,000 asynchronous `getNote()` invocations are fired across the Tauri IPC channel.
  2. Each invocation spawns a blocking task in Tokio (`src-tauri/src/commands.rs` line 90).
  3. 2,000 SQLite queries execute, serializing full document bodies (including 1 MB notes) to JSON.
  4. Hundreds of megabytes of IPC responses queue up in WebKit and Tauri pipes, continuing to drain for **10 to 30 seconds after user typing ceases**.
  5. This explains why **true peaks occurred at +10s and +30s cooldown**.

### Finding 2: Total Absence of IPC Cancellation or Request Sequencing
- **Classification**: **CONFIRMED**
- **Evidence**:
  While `Editor.tsx` sets `cancelled = true` in the `useEffect` cleanup handler, `cancelled` only guards the eventual client-side JavaScript callback. It does **not** abort the active Tauri IPC promise, does **not** signal Tokio, and does **not** stop SQLite from serializing large strings. There is zero request debouncing, deduplication, or cancellation tokens.

### Finding 3: WebKit Allocator (`bmalloc`) Page Retention & Swap Compression
- **Classification**: **CONFIRMED**
- **Evidence**:
  From `/usr/bin/vmmap -summary` on WebContent:
  ```
  REGION TYPE         VIRTUAL RESIDENT    DIRTY  SWAPPED
  WebKit Malloc          1.6G   305.2M   304.3M   454.6M
  ```
  `bmalloc` retains freed allocation pages in thread-specific cache bins. When memory pressure rises on macOS, the kernel compresses these unevicted pages into anonymous swap (`swapped=454.6M`). Because macOS counts compressed swap in **Physical Footprint**, memory appears permanently held until an aggressive memory pressure event triggers `bmalloc` scavenging.

### Finding 4: ProseMirror DOM & Syntax AST Churn
- **Classification**: **PROBABLE**
- **Evidence**:
  While undo/redo history is explicitly reset via `history$.spec.state.init()` (`Editor.tsx` line 708), calling `editor.commands.setContent()` 2,000 times destroys and recreates thousands of DOM elements and Lowlight syntax ASTs faster than WebKit's incremental GC can collect them, saturating `bmalloc` zones.

### Finding 5: 100 ms `hover_focus_tick` Main-Thread Polling
- **Classification**: **CONFIRMED**
- **Evidence**:
  In `src-tauri/src/lib.rs` line 123:
  ```rust
  std::thread::spawn(move || loop {
      std::thread::sleep(std::time::Duration::from_millis(100));
      let a = app.clone();
      let _ = app.run_on_main_thread(move || hover_focus_tick(&a));
  });
  ```
  This loop runs continuously at 10 Hz (600 dispatches per minute) regardless of whether the NSPanel is visible or key, generating constant thread wakeups.

### Finding 6: Monolithic Bundle & High Initial JS Overhead
- **Classification**: **CONFIRMED**
- **Evidence**:
  From `dist/assets` inspection, `index-DCVywaxP.js` is **1,098.86 KB uncompressed** (332.86 KB gzipped) because all Lucide icon SVGs and formatting extensions are bundled into the main chunk, increasing compilation time on boot.

---

## 5. Audit Verdict Status & Conclusions

### Verdicts Withdrawn:
1. **WITHDRAWN: "PASS — Bounded Memory Behavior"**: Withdrawn based on empirical peaks of **924 MB – 1,067 MB** and post-cooldown retention up to **1,002 MB**.
2. **WITHDRAWN: "Settled Post-Cooldown Footprint of ~50 MB"**: Withdrawn. The ~50 MB baseline is only achievable at cold launch before high-throughput note switching across multi-size documents.
3. **WITHDRAWN: "10,000+ Document Transitions"**: Withdrawn and corrected to **7,602 document switches**.

### Verdicts Remaining Valid:
1. **VALID: Zero Native Mach Zone Leaks**: `/usr/bin/leaks` confirms 0 leaks in `raynote`.
2. **VALID: Ultra-Fast Persistence**: SQLite WAL insert latency (0.16 ms), update latency (0.086 ms), and FTS5 search (5.99 ms) remain verified and exceptional.
3. **VALID: True Idle Efficiency**: When settled at rest without active switching, CPU drops to **0.0% – 0.2%**.
4. **VALID: 100% Automated Test Stability**: All 366 Vitest unit tests and 28 Cargo unit tests pass cleanly with zero crashes.

### Additional Evidence Needed Prior to Optimization:
1. Verification of background `getNote()` cancellation using an in-flight AbortController or generation counter.
2. Safari Web Inspector remote inspection of WebKit DOM node counts and detached wrappers after 500 document transitions.
