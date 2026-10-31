# rayNote CPU & Energy Impact Report

> **Audit Date:** October 30, 2026
> **Environment:** macOS 27.2 (Darwin 26B123) | Apple M3 (8 CPU cores: 4 performance + 4 efficiency)
> **Power Context:** Battery Power (89% charge, discharging)
> **Diagnostics:** `/usr/bin/top`, `/bin/ps`, `/usr/bin/footprint`, Objective-C / Cocoa runtime inspection

---

## 1. Executive Summary & Energy Verdict

| Activity State | Native Process CPU (`raynote`) | WebKit Process CPU (`WebContent`) | Total Threads | Timer Dispatch Rate | Energy Assessment | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Visible Panel Idle** | 0.0% – 0.2% | 0.0% | 35 threads (22 native + 13 WebKit) | 10 Hz (`hover_focus_tick`) | Minimal / Near-zero battery draw | **PASS** |
| **Hidden Panel Idle** | 0.1% | 0.0% | 35 threads (22 native + 13 WebKit) | 10 Hz (`hover_focus_tick`) | Low, but suboptimal timer wakeups | **WARNING** |
| **Active Continuous Typing** | 0.0% – 0.1% | 1.1% – 5.9% | 36 threads | Event-driven (keystroke) | Negligible impact | **PASS** |
| **Rapid Note Switching (200 ops)**| 0.0% – 0.7% | 15.0% – 36.4% | 39 threads | IPC bursts (15 ms intervals) | Transient spike, settles in < 2s | **PASS** |

---

## 2. In-Depth Threading & CPU Analysis

### A. Idle State (Visible & Hidden)
During sustained 60-second idle sampling, both processes dropped to near-zero CPU usage:
- `raynote` Native Process: **0.0% – 0.2% CPU**, 22 threads.
- `com.apple.WebKit.WebContent`: **0.0% CPU**, 13 threads.
- Neither process runs runaway `requestAnimationFrame` loops or React state intervals.

### B. Identified Background Poller: `start_hover_focus_watcher` (10 Hz Dispatch)
Inspection of `src-tauri/src/lib.rs` revealed an active background thread:
```rust
#[cfg(target_os = "macos")]
fn start_hover_focus_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let a = app.clone();
        let _ = app.run_on_main_thread(move || hover_focus_tick(&a));
    });
}
```
**Architectural Impact**:
1. **Wakeup Frequency**: A dedicated background thread sleeps for 100 ms and then dispatches `hover_focus_tick` to the macOS main thread via `app.run_on_main_thread`.
2. **Hidden State Behavior**: When the panel is hidden (`!visible`), `hover_focus_tick` returns early, but the dispatch still occurs **10 times per second** (600 times per minute).
3. **Energy Implication**: On Apple Silicon, timer wakeups prevent CPU efficiency cores from entering deep sleep states (`C-states`). While the instantaneous CPU usage registers as 0.1%, eliminating this polling loop when the panel is hidden or replacing it with Cocoa tracking areas (`NSTrackingArea`) will improve battery life during background execution.

---

## 3. High-Throughput Workload CPU Dynamics

### A. Continuous Keystroke Ingestion (500 Chars)
- Ingesting text bursts via `CGEvent.postToPid`:
  - `WebContent` CPU rose to **1.1% – 5.9%**.
  - ProseMirror transaction processing, DOM update, and lowlight syntax tokenization consumed minimal cycles.
  - The 1,000 ms debounce for autosave in `Editor.tsx` prevented SQLite disk thrashing during active typing.

### B. Note Switching Churn (200 Switches at 15 ms Intervals)
- During automated note switching bursts:
  - `WebContent` CPU peaked at **36.4%** due to document parsing, DOM reconstruction, and lowlight AST generation.
  - Native `raynote` CPU remained below **1.0%**, demonstrating SQLite query efficiency.
  - Immediately following workload completion, CPU returned to **0.0%** within 1.5 seconds.

---

## 4. Energy Efficiency Recommendations

1. **Gate `hover_focus_tick` on Panel Visibility**:
   Do not dispatch `app.run_on_main_thread` when the window is hidden or when the application is resigned.
2. **Migrate to Native `NSTrackingArea`**:
   Replace the 100 ms polling loop entirely with standard AppKit `mouseEntered:` and `mouseExited:` callbacks on the `NSWindow` content view, eliminating background timer interrupts.

