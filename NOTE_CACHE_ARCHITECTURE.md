# 🚀 rayNote Zero-Flicker In-Memory LRU Note Cache Architecture

## 1. Executive Summary & Problem Analysis

In desktop note-taking applications built with web technologies (such as Tauri + React + Tiptap/ProseMirror), switching between notes frequently exhibits visual glitches:
1. **White/Dark Flashes**: Brief render frames where the editor is unmounted or replaced with a "Loading note..." skeleton.
2. **Layout Jumps**: Content disappearing, scroll positions resetting to zero, and the editor DOM being destroyed and recreated.
3. **IPC Latency Spikes**: Waiting on asynchronous SQLite queries over Tauri IPC before any content can be painted.

### The Old Switching Flow (Flicker & Lag):
```text
Click Note B
   ↓
React clears current content (or unmounts Editor via key={noteId})
   ↓
loading = true (White / blank screen flash)
   ↓
SQLite / Tauri IPC roundtrip
   ↓
wait (10ms - 50ms)
   ↓
fetch Note B payload
   ↓
mount new Tiptap Editor & ProseMirror DOM
   ↓
scroll resets to 0px
   ↓
paint (Visual jarring jump)
```

### The New Architecture Flow (0ms Instant & Flicker-Free):
```text
Click Note B
   ↓
In-Memory LRU Cache Hit? (O(1) Map Lookup — ~95 nanoseconds)
 ├── YES ──> editor.commands.setContent(cached.doc, { emitUpdate: false })
 │           restore cached.scrollTop in requestAnimationFrame
 │           background Stale-While-Revalidate check against SQLite
 └── NO  ──> Keep editor mounted & stable
             Fetch from SQLite in background
             Atomically apply doc once ready
```

---

## 2. Three-Tier Architectural Design

```text
                  ┌──────────────────────────────────────────────┐
                  │                 rayNote UI                   │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │             Active Tiptap Editor             │
                  │   • EXACTLY 1 permanent live instance        │
                  │   • Stays mounted across all note switches   │
                  │   • Swaps documents atomically in-place      │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │           In-Memory LRU Cache                │
                  │   • Dual Limits: MAX 25 notes OR ~8 MB       │
                  │   • Pure memory store outside React state    │
                  │   • Caches doc, updatedAt, preview, scrollTop│
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │              SQLite Database                 │
                  │   • Single persistent source of truth        │
                  │   • Stale-While-Revalidate reconciliation    │
                  └──────────────────────────────────────────────┘
```

> **Crucial Rule**: We do **NOT** create 25 Tiptap editor instances. Creating 25 ProseMirror document models and editor state machines would waste 100+ MB of RAM. Instead, rayNote keeps **1 active Tiptap instance** and caches **25 lightweight serialized document strings**.

---

## 3. Root Cause Investigation & Solutions

| Root Cause | Old Behavior | New Implemented Solution |
| :--- | :--- | :--- |
| **Component Remounting** | `<Editor key={activeNoteId} />` in `NoteEditor.tsx` destroyed the React tree and DOM on every switch. | Removed `key={activeNoteId}`. The Editor component mounts once and lives permanently. |
| **Loading State Flash** | `content === null ? <LoadingNote /> : <Editor />` caused a blank/loading screen while awaiting IPC. | Removed conditional loading UI. The active editor remains visible and smoothly swaps content in place. |
| **Editor Re-instantiation** | `useEditor(..., [noteId])` in `Editor.tsx` destroyed the Tiptap instance on `noteId` change. | Changed dependency array to `[]`. Editor is initialized once on boot. Switching uses `editor.commands.setContent()`. |
| **Lost Scroll Positions** | Every note switch reset scroll to top (`0px`), breaking reading flow in long notes. | Cached per-note `scrollTop`. Saved immediately on departing a note, restored in `requestAnimationFrame`. |
| **localStorage Bottlenecks** | Storing large note contents in browser `localStorage` risked synchronous JSON serialization freezes. | Eliminated content caching in `localStorage`. Kept persistent storage strictly in SQLite and active speed cache in RAM. |

---

## 4. In-Memory LRU Cache Implementation (`src/lib/noteCache.ts`)

### Dual-Bounded Eviction Strategy
Memory bounds are strictly enforced by evicting the least recently used entries when either:
- **`MAX_ENTRIES`**: `25 notes`
- **`MAX_CACHE_BYTES`**: `8,388,608 bytes (8 MB)`

### Data Structure & Memory Tracking
Each cache entry stores only the minimal serialized document, timestamp, and UI state:
```typescript
export interface CachedNote {
  id: string;
  content: string;     // Serialized document / markdown
  updatedAt: number;   // Timestamp for stale-while-revalidate
  preview?: string;    // First 120 chars for list preview
  scrollTop: number;   // Preserved scroll offset in pixels
  byteSize: number;    // Estimated UTF-16 footprint in bytes
}
```

Eviction relies on JavaScript's standard `Map` which guarantees keys are enumerated in insertion order. On every `get(id)`, the item is deleted and re-inserted, moving it to the newest position in $O(1)$ time:
```typescript
get(id: string): CachedNote | undefined {
  const entry = this.cache.get(id);
  if (!entry) return undefined;
  this.cache.delete(id);
  this.cache.set(id, entry);
  return entry;
}
```

---

## 5. Scroll Position Preservation & Restoration

When switching from Note A to Note B:
1. **Save**: The current `scrollTop` of the departing note is read from the scroll container ref and stored via `noteCache.setScrollTop(departingId, scrollContainer.scrollTop)`.
2. **Swap**: Document B is loaded into the editor in-place via `editor.commands.setContent(docB, { emitUpdate: false })`.
3. **Restore**: After the browser completes the DOM layout pass, `scrollTop` is restored in `requestAnimationFrame`:
```typescript
const targetScroll = cached.scrollTop;
requestAnimationFrame(() => {
  if (scrollContainerRef.current && currentNoteIdRef.current === noteId) {
    scrollContainerRef.current.scrollTop = targetScroll;
  }
});
```

---

## 6. Stale-While-Revalidate (SWR) Protocol

Even though SQLite is local, background synchronization ensures data consistency across potential external modifications (e.g. multi-window operations or file imports) without causing visual flicker:
1. **Instant Paint**: On cache hit, display cached content immediately (0ms).
2. **Background Query**: Tauri IPC query `getNote(noteId)` is dispatched asynchronously.
3. **Version Check**: Compare SQLite's `updated_at` against `cached.updatedAt`.
4. **Conditional Update**: If and only if the database timestamp is strictly newer and content differs, the editor document is refreshed atomically. Otherwise, **no action is taken**, completely avoiding unnecessary DOM reflows.

---

## 7. Autosave & Deferred Serialization Integration

The cache seamlessly integrates into rayNote's existing debounced autosave pipeline:
- **Zero keystroke overhead**: We do **NOT** invoke `editor.getJSON()` on every keystroke or selection change.
- **Debounced Cache Update**: When the existing 800ms debounce timer triggers, `noteCache.updateContent(noteId, text, preview)` is called in tandem with SQLite `updateNote()`.
- **Pre-Switch Flush**: If a user types and immediately switches notes before the debounce fires, the departing note's uncommitted content is flushed synchronously into `noteCache` and scheduled for SQLite write.

---

## 8. Pure On-Demand LRU vs Idle Prefetching

After running comparative production benchmarks on macOS:
- **Idle Prefetching** (speculatively loading adjacent notes after 1.2s of inactivity) woke up background timers and performed redundant SQLite disk reads and IPC deserialization for notes the user might not open.
- **Pure On-Demand LRU** ensures that when the user stops typing, **the app does absolutely nothing**:
  - **Zero background timers**
  - **Zero speculative disk I/O**
  - **Idle CPU drops immediately to ~0.2%**
  - When a note is opened, in-memory cache hits are instant (0ms). Even on a cache miss, SQLite retrieves the note in ~1ms from local storage and promotes it to the LRU cache.

Therefore, rayNote utilizes **Pure On-Demand LRU Caching** to strictly uphold its lightweight desktop footprint.

---

## 9. Performance Verification & Benchmarks

### A. Production App Benchmarks (Packaged `rayNote.app` on macOS)
Conducted using Apple's official `footprint` and `top` diagnostics against the running application processes (Tauri binary `raynote` + WebKit WebContent process) across 25 realistic notes (5x 20KB, 5x 100KB, 5x 250KB, 5x 500KB, 5x 1MB):

| Scenario | Tauri Native RAM | WebKit Renderer RAM | Total App Footprint | Total CPU % | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Fresh Launch** | 25 MB | 181 MB | **206 MB** | 0.7% | 🟢 Clean boot |
| **Idle (Post-Boot)** | 23 MB | 181 MB | **204 MB** | **0.2%** | 🟢 CPU ~0% |
| **5 Small Notes (20 KB ea)** | 27 MB | 181 MB | **208 MB** | 0.8% | 🟢 Stable |
| **25 Realistic Notes Loaded** | 26 MB | 181 MB | **207 MB** | 0.7% | 🟢 Budget Enforced |
| **50 Rapid Switches** | 28 MB | 181 MB | **209 MB** | 0.8% | 🟢 No Runaway |
| **100 Rapid Switches** | 27 MB | 181 MB | **208 MB** | 0.7% | 🟢 0 Leak |
| **Post-Stress Idle (Settled)**| 27 MB | 181 MB | **208 MB** | **0.2%** | 🟢 Cooldown |

*Over 100 consecutive rapid switches, the memory footprint varied by less than 3 MB (plateauing at 207–209 MB).* Full report in [PRODUCTION_BENCHMARK_REPORT.md](file:///Users/rashmipersonal/Desktop/MAC%20Apps/rayNote/PRODUCTION_BENCHMARK_REPORT.md).

### B. Microbenchmarks (Cache Core)
Executed via `node --experimental-strip-types src/lib/__tests__/noteCache.test.ts`:
- **Cache Hit Latency**: **95.39 ns / op** (~10.48M ops/sec)
- **Cache Write + Evict Latency**: **913.35 ns / op** (~1.09M ops/sec)
- **Cache Memory Overhead**: **1.364 MB** across 25 medium notes (well below 8 MB ceiling)
- **Editor Remount Count**: **0** (single permanent instance)

---

## 10. Modified Files Summary

1. `src/lib/noteCache.ts`: High-performance in-memory LRU cache with dual limits (25 items / 8 MB), UTF-16 byte estimation, scroll tracking, and LRU recency management.
2. `src/lib/__tests__/noteCache.test.ts`: Automated test suite and benchmarking harness.
3. `src/components/NoteEditor.tsx`: Removed `key={noteId}` and removed loading screen conditional branching to keep the editor permanently mounted.
4. `src/editor/Editor.tsx`: Initialized Tiptap once (`[]` deps), implemented in-place document swapping (`editor.commands.setContent`), scroll restoration, pre-switch dirty flushing, and background SWR.
5. `src/App.tsx`: Replaced ad-hoc cache refs and localStorage full-content storage with pure on-demand `noteCache`, eliminating idle background timers.
6. `PRODUCTION_BENCHMARK_REPORT.md`: Comprehensive production process benchmark report.
