# 📋 rayNote — Pre-Release Memory Leak & Performance Verification Checklist

Use this checklist prior to tagging any release or distributing a new build of rayNote to guarantee that no memory regressions or unbounded allocations have entered the codebase.

---

## 1. Automated Regression & Unit Test Verification

- [x] **Run Frontend Unit & Integration Tests**:
  ```bash
  pnpm test
  ```
  *Requirement: 39 / 39 test suites pass, 366 / 366 tests pass, 0 failures.*

- [x] **Run Native Rust Test Suite**:
  ```bash
  cd src-tauri && cargo test
  ```
  *Requirement: 28 / 28 unit tests pass, 0 failures.*

---

## 2. Release Build Compilation

- [x] **Compile Optimized Native App**:
  ```bash
  pnpm build
  cd src-tauri && cargo build --release
  ```
  *Verify binary size: `ls -lh src-tauri/target/release/raynote` should remain ~7.6 MB.*

- [x] **Update Installed App Bundle**:
  ```bash
  cp src-tauri/target/release/raynote /Applications/rayNote.app/Contents/MacOS/raynote
  ```

---

## 3. Automated Memory Audit Suite Execution

- [x] **Run the Verified Multi-Workload Audit & Triplicate Endurance Tests**:
  ```bash
  node --experimental-strip-types scripts/run_followup_verification.ts
  ```
  *Execution requirements across tests:*
  - [x] **Cold Boot Footprint**: Total Physical Footprint between **45 MB and 60 MB** (typically ~52 MB).
  - [x] **Standard Switching**: Plateau reached within 200 operations without runaway growth.
  - [x] **Triplicate 2,000-Op Endurance Runs**: Repeat 3 times independently from clean launches. Total settled footprint remains $\le 65\text{ MB}$ (Runs observed: 63.13 MB, 62.33 MB, 49.77 MB).
  - [x] **Settled Delta**: Net growth post-cooldown remains strictly bounded ($\le 12\text{ MB}$, with negative delta observed in Run 3: -1.99 MB).

> [!NOTE]
> **Understanding RSS vs. Physical Footprint**:
> In macOS, Native RSS (`ps -o rss=`) initially measures ~110–120 MB due to transient dyld shared framework pages (`__TEXT`, `__OBJC_RO`). As execution continues or background VM paging occurs, Mach VM unmaps clean inactive code pages, dropping RSS to ~20–28 MB. This is normal system behavior. Always use `/usr/bin/footprint` (or `top MEM`) to measure real dirty memory.

---

## 4. Native Diagnostic Verification

- [x] **Check Native Memory Zones with `/usr/bin/leaks`**:
  ```bash
  TAURI_PID=$(pgrep -x raynote)
  leaks $TAURI_PID --nostacks --quiet
  ```
  *Requirement: `0 leaks for 0 total leaked bytes` across 50,000+ malloc nodes.*

- [x] **Check WebKit Process Leaks**:
  ```bash
  WEBKIT_PID=$(pgrep -f com.apple.WebKit.WebContent | tail -n 1)
  leaks $WEBKIT_PID --nostacks --quiet
  ```
  *Requirement: No application leaks (only Apple framework static internal initialization dictionary ~1.6 KB permitted).*

- [x] **Verify Idle CPU Draw**:
  ```bash
  top -l 1 -stats pid,command,cpu -pid $(pgrep -x raynote)
  ```
  *Requirement: CPU settles to $\le 0.5\%$ in idle state.*

---

## 5. Artifact & Baseline Archival

- [x] **Inspect Output CSV**:
  Verify [`MEMORY_LEAK_VERIFICATION_RESULTS.csv`](file:///Users/rashmipersonal/Desktop/MAC%20Apps/rayNote/MEMORY_LEAK_VERIFICATION_RESULTS.csv) was updated with timestamped metrics.
- [x] **Inspect Raw Diagnostic Logs**:
  Ensure directory [`MEMORY_LEAK_VERIFICATION_RAW_LOGS/`](file:///Users/rashmipersonal/Desktop/MAC%20Apps/rayNote/MEMORY_LEAK_VERIFICATION_RAW_LOGS/) contains `footprint_settled.txt`, `vmmap_tauri_settled.txt`, `vmmap_webkit_settled.txt`, `leaks_tauri.txt`, `leaks_webkit.txt`, and `top_snapshot.txt`.
- [x] **Compare Against Prior Baselines**:
  Ensure no metric has regressed relative to the prior release report.
- [x] **Sign-Off**:
  - **Status:** PASS — No leaks detected in the tested workloads.
  - **Commit Hash:** `27c42c3`
  - **Date:** October 29, 2026
  - **Hardware:** Apple Silicon ARM64 (8 CPU, 8 GB RAM, macOS 27.2)
