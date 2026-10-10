# Notion-Style Block Selection Architecture

rayNote incorporates a full-fidelity, Notion-style block selection engine built directly on TipTap and ProseMirror primitives, delivering 60fps rubber-band dragging, logarithmic hit testing, and seamless multi-block operations.

---

## 1. Overview & Core Primitives

Block selection enables users to interact with entire blocks (paragraphs, headings, bullet list items, numbered list items, task items, code blocks, tables, and horizontal rules) as discrete selectable units rather than raw character streams.

```
┌─────────────────────────────────────────────────────────────┐
│ Editor Viewport                                             │
│                                                             │
│ [Gutter / Left Margin]                                      │
│  │                                                          │
│  ├─► Pointerdown (setPointerCapture)                        │
│  │   ├── Caches Block Rects (docTop, docBottom) in O(n)     │
│  │   └── Spawns requestAnimationFrame auto-scroll loop      │
│  │                                                          │
│  ├─► Pointermove / Drag                                     │
│  │   ├── Binary Search O(log n) over cached rects           │
│  │   ├── Updates plugin state only when crossing blocks     │
│  │   ├── Decoration.node applies bg-sky-500/15 + radii      │
│  │   └── Marquee updated via transform: translate3d()...    │
│  │                                                          │
│  └─► Pointerup / Blur                                       │
│      ├── Releases PointerCapture & cancels rAF loop         │
│      └── Finalizes active selection mode                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Component Breakdown

### A. TipTap Extension & ProseMirror Plugin (`src/extensions/BlockSelection.ts`)
- **Plugin State**:
  ```typescript
  interface BlockSelectionState {
    anchor: number | null;
    head: number | null;
    selectedPositions: number[];
  }
  ```
- **Decorations**: Uses `Decoration.node(pos, pos + nodeSize, { class, ... })` to highlight selected blocks without touching document nodes or creating DOM reconciliation thrashing.
- **Visual Merging**: Employs `cva` via `blockSelectionVariants` to dynamically compute corner radiuses (`rounded-md`, `rounded-t-md`, `rounded-none`, `rounded-b-md`) based on adjacency with neighboring selected blocks. A seamless inter-block pseudo-element bridge closes vertical gaps.
- **Undo / Redo Safety**: Mapped through `tr.mapping` on every transaction, allowing `⌘Z` and `⌘⇧Z` to restore block selection state cleanly after deletions or duplicates.

### B. Pointer Events & Rubber-Band Drag (`src/extensions/useBlockDrag.ts`)
- **Pointer Capture**: Leverages `setPointerCapture(pointerId)` on the initial target so drag tracking continues uninterrupted even if the pointer traverses outside the macOS window.
- **Cache-First Hit Testing**:
  At drag initiation, block client rects are sampled once and converted to document coordinates (`docTop = clientTop + scrollTop`), which remain invariant during scrolling.
- **Logarithmic Binary Search (`O(log n)`)**:
  Hit-testing during drag evaluates document coordinates via binary search over monotonic vertical ranges, executing in ~10 iterations even across documents containing 1,000+ blocks.
- **Reflow-Free Marquee Overlay**:
  The rubber-band marquee box is updated purely through `transform: translate3d(...) scale(...)` on a single element with `will-change: transform`. An embedded SVG with `vector-effect: non-scaling-stroke` maintains an exact 1.5px border without layout recalculation.

### C. Quadratic Auto-Scroll Engine (`src/extensions/useAutoScroll.ts`)
- **Zone Boundaries**: 60px active zones at the top and bottom of the editor scroll container.
- **Quadratic Acceleration**:
  $$\text{speed} = \text{maxSpeed} \times \left(\frac{\text{depth}}{\text{zoneSize}}\right)^2$$
  with $\text{maxSpeed} = 18\text{px/frame}$.
- **Continuous Scrolling**: The `requestAnimationFrame` loop drives continuous scrolling even when the cursor remains completely stationary in an edge zone, continuously recomputing the target block and expanding selection.
- **Edge Guards**: Prevents overscroll past $0$ or beyond $\text{scrollHeight}$.

---

## 3. Keyboard Interactions & State Transitions

| Shortcut | Context | Behavior |
| :--- | :--- | :--- |
| `Esc` | Text mode inside a block | Enters block selection mode, highlighting the current block |
| `Esc` | Block selection mode | Exits block selection mode, returning to standard text caret |
| `⌘A` (1st press) | Text mode | Selects all text within current block |
| `⌘A` (2nd press) | Text mode (full text selected) | Selects the block itself (enters block selection mode) |
| `⌘A` (3rd press) | Block selection mode | Selects **all** blocks in the entire note |
| `↑` / `↓` | Block selection mode | Moves single block selection to previous/next block |
| `Shift+↑` / `Shift+↓` | Block selection mode | Extends or shrinks block selection range by one block |
| `Backspace` / `Delete` | Block selection mode | Deletes all selected blocks; positions caret at nearest block |
| `⌘D` | Block selection mode | Duplicates selected blocks immediately below; selects duplicates |
| `⌘C` / `⌘X` | Block selection mode | Copies or cuts selected blocks formatted as Markdown and HTML |
| `Tab` / `Shift+Tab` | Block selection mode | Sinks (indents) or lifts (outdents) list and task items |
| Printable Char | Block selection mode | Exits block mode and inserts typed character into first block |

---

## 4. Platform Considerations (macOS WKWebView)

1. **Text Selection Suppression**:
   During active drag, `-webkit-user-select: none !important` and `user-select: none !important` are injected into `document.body` to eliminate WKWebView selection ghosting.
2. **Overscroll Behavior**:
   `overscroll-behavior-y: none` is enforced on the container to prevent rubber-band bounce when auto-scrolling hits document bounds.
3. **Task Checkbox Shielding**:
   Pointer events originating on task list item checkboxes (`input[type="checkbox"]` or associated labels) bypass block drag listeners, ensuring instant checkbox toggle without triggering selection modes.
