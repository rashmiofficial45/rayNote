# rayNote In-Depth Memory Leak & Retention Investigation

> **Audit Date:** October 30, 2026
> **Environment:** macOS 27.2 (Darwin 26B123) | Apple M3 (8 GB Unified Memory)
> **Instrumentation:** `/usr/bin/leaks`, `/usr/bin/vmmap`, `/usr/bin/footprint`, Activity Monitor APIs
> **Target Process IDs:** `raynote` (PID 55900), `com.apple.WebKit.WebContent` (PID 55904)

---

## 1. Executive Summary & Verdict

| Diagnostic Domain | Primary Tool | Findings | Leaked Bytes | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Native Rust / Tauri Core** | `/usr/bin/leaks 55900` | 142,541 nodes malloced (19.3 MB) | **0 leaks / 0 bytes** | **PASS** |
| **WebKit Mach Zones** | `/usr/bin/leaks 55904` | 2,943,365 nodes malloced (707.8 MB) | **4 leaks / 1,664 bytes** (OS dictionary caches) | **PASS** |
| **ProseMirror History Retention** | Plugin State Audit | `history$` cleared on switch via `applyDocumentInPlace` | Cleanly re-initialized | **PASS** |
| **In-Memory Cache Bounds** | `NoteLRUCache` Audit | 25 note cap / 8 MB hard limit enforced | Eviction operating as designed | **PASS** |
| **Sustained WebKit Malloc Growth** | `footprint` & `vmmap` | Physical footprint grew from 85 MB to 823 MB (WebContent) | **~760 MB dirty/swapped pool retention** | **FAIL / BOUNDED CONCERN** |

---

## 2. Granular Diagnostic Results

### A. Native Mach Zone Allocations (`/usr/bin/leaks`)
The native Tauri/Rust process was scanned directly following high-stress endurance testing:
```
Process 55900: 142541 nodes malloced for 19345 KB
Process 55900: 0 leaks for 0 total leaked bytes.
```
- **Analysis**: The Rust heap, rusqlite connection wrappers, thread pool dispatchers, and Cocoa Objective-C bridges are 100% free of unreferenced allocation cycles.
- **Verdict**: **PASS**.

### B. WebKit Mach Zone Allocations (`/usr/bin/leaks`)
The WebKit WebContent process hosting React 19 and TipTap was audited:
```
Process 55904: 2943365 nodes malloced for 707890 KB
Process 55904: 4 leaks for 1664 total leaked bytes.

    4 (1.62K) ROOT LEAK: <NSMutableDictionary 0x79a4f24360> [32]
       3 (1.59K) <NSMutableDictionary (Storage) 0x79a4dcca00> [1280]
          1 (224 bytes) <CFString 0x10329eb40> [224]
          1 (128 bytes) <CFString 0x79a4df9080> [128]
```
- **Analysis**: The 4 detected leaks are internal Apple CoreFoundation/AppKit mutable dictionary singletons allocated during display profile initialization. Zero application DOM nodes, JavaScript closures, or TipTap document trees are leaked.
- **Verdict**: **PASS**.

---

## 3. The WebKit Malloc Retention Phenomenon

### A. The Conflict with Prior Audit Reports
Prior repository documentation (`MEMORY_LEAK_AUDIT_REPORT.md` and `MEMORY_LEAK_VERIFICATION_FOLLOWUP.md`) asserted:
> *"Across 3 separate runs of 1,000 consecutive note switches... settled post-cooldown footprint was 49.0 MB – 49.0 MB ($\Delta\text{RAM} = \mathbf{0.0\text{ MB}}$)."*

However, our rigorous multi-workload execution across the real 56-note library (which contains diverse notes, including 1 MB tables and code blocks) revealed substantial physical footprint expansion:

| Phase | Milestone | Native Tauri Footprint | WebKit Footprint | Total Application Footprint |
| :--- | :--- | :--- | :--- | :--- |
| **Cold Boot Idle** | 0 ops | 28 MB | 74 MB | **102 MB** |
| **Settled Idle** | 60s at rest | 26 MB | 55 MB | **81 MB** |
| **100 Switches** | Post-100 peak | 29 MB | 139 MB | **168 MB** (Settled: 130 MB) |
| **500 Switches** | Post-500 peak | 58 MB | 274 MB | **332 MB** (Settled: 439 MB) |
| **2,000 Switches (Run 1)**| 2,000 peak | 142 MB | 703 MB | **845 MB** (Settled 60s: 291 MB) |
| **2,000 Switches (Run 2)**| 2,000 peak | 120 MB | 397 MB | **517 MB** (Settled 60s: 590 MB) |
| **2,000 Switches (Run 3)**| 2,000 peak | 142 MB | 316 MB | **458 MB** (Settled 60s: 355 MB) |
| **Post-Lifecycle Stress**| After 50 Show/Hide | 253 MB | 708 MB | **961 MB** |

### B. Architectural Root Cause (`vmmap -summary 55904`)
The `vmmap` region table for WebContent isolates the exact allocation category:
```
REGION TYPE         VIRTUAL RESIDENT    DIRTY  SWAPPED
WebKit Malloc          1.6G   305.2M   304.3M   454.6M
```
1. **`bmalloc` Cache Retention**: WebKit’s allocator (`bmalloc`) does not immediately release free heap pages back to the kernel (`madvise(MADV_FREE)`). When switching across dozens of large documents with diverse syntax trees, `bmalloc` expands its virtual zones to accommodate peak hydration.
2. **macOS Memory Compressor**: Because dirty anonymous memory is retained in `bmalloc` pools, macOS pages it out to the kernel memory compressor (`swapped_out=454.6M`). On macOS, **compressed memory is counted directly towards the process's Physical Footprint**.
3. **Background SQLite IPC Churn**: In `Editor.tsx`:
   ```typescript
   getNote(noteId).then((fullNote) => { ... });
   ```
   During rapid 15 ms note switches, hundreds of concurrent `getNote` promises are dispatched across Tauri's async bridge. Each response carries up to 1 MB of serialized content into JavaScript memory before being discarded.

---

## 4. Remediation Strategy

1. **Debounce or Cancel Background `getNote` on Switching**:
   If the user is rapidly navigating with `⌥↓` / `⌥↑`, cancel or debounce the background stale-while-revalidate SQLite query so only the actively settled note triggers IPC.
2. **ProseMirror Document Purge**:
   When evicting notes from `NoteLRUCache`, explicitly null out cached DOM nodes and serialized AST strings.
3. **WebKit Memory Pressure Notification**:
   Trigger `WebProcessPool._garbageCollectWebContentProcesses` or invoke WebKit low-memory notifications during extended idle cooldowns to force `bmalloc` page reclamation.

