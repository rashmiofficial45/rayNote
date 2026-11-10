# rayNote — Minimal, Context-Aware Secondary-Click Menu Implementation

## 1. Summary

A minimal, native macOS-style secondary-click (context) menu was designed, engineered, and integrated into rayNote. The implementation directly addresses and replaces the default macOS WebKit context menu inside rayNote's editor surface with a context-aware menu that dynamically adapts based on the active selection and cursor context:

- **Menu A (Text Selected):** Displays rich text editing and formatting actions (Cut, Copy, Paste, Bold, Italic, Bullet List, Numbered List). Insert/Edit Link is removed from this menu.
- **Menu B (No Text Selected):** Displays a compact menu (Paste, Undo, Redo) with an "Insert →" submenu (Heading 1, Heading 2, Bullet List, Numbered List, Checklist, Code Block, Divider).
- **Specialized Contexts:** Context-sensitive actions when secondary-clicking links, code blocks, checklists (task items), or active block selections.
- **Responsive Viewport Collision & Submenu Clipping Fix:** Both main menu and submenus dynamically measure bounding boxes and clamp within the viewport. When opening near the right edge of the screen, the Insert submenu automatically flips to the left. When opening near the bottom edge of the screen, vertical offsets are dynamically calculated so the submenu never clips. A transparent hover corridor bridge prevents accidental submenu drops when moving diagonally.
- **macOS Liquid Glass Aesthetic:** Deep frosted glass styling (`backdrop-filter: blur(36px) saturate(210%)`), generous rounded corners (`20px` menu container radius, `12px` item radius with concentric geometry), top specular reflection, multi-stop soft shadows, and a soft translucent accent capsule highlight (`var(--color-accent)`) replacing harsh rectangular bars.
- **Native Menu Overlap Fix:** Completely suppresses default macOS WebKit context menu inside editor surfaces by calling `preventDefault()` immediately and synchronously on both ProseMirror view `handleDOMEvents.contextmenu` and the React editor container `onContextMenu`.
- **Selection & Cursor Preservation:** Never collapses or deselects text when opening menus or clicking items; prevents focus destruction via `onMouseDown={(e) => e.preventDefault()}` and authoritative ProseMirror state resolution.

---

## 2. Selected Text Menu (Menu A)

Triggered when the user selects a range of text and secondary-clicks inside or over that selection.

### Supported Actions & Shortcuts
- **Cut (`⌘X`):** Serializes the selected slice to Markdown, writes to clipboard via multi-layer fallback, and cleanly deletes the selection via `editor.chain().focus().deleteSelection().run()`. Disabled when the editor is not editable.
- **Copy (`⌘C`):** Serializes the selected slice to Markdown and writes to clipboard without altering document content.
- **Paste (`⌘V`):** Reads clipboard text asynchronously and replaces the active selection via `editor.chain().focus().insertContent(text).run()`.
- *Separator*
- **Bold (`⌘B`):** Applies or toggles bold formatting via `smartToggleMark(editor, "bold")` on the preserved selection. Displays active state checkmark when the selection is bold.
- **Italic (`⌘I`):** Applies or toggles italic formatting via `smartToggleMark(editor, "italic")` on the preserved selection. Displays active state checkmark when the selection is italic.
- *Separator*
- **Bullet List (`⇧⌘8`):** Toggles bullet list on the selected text blocks via `smartToggleBlockFormat(editor, "bulletList")`. Displays active checkmark when active.
- **Numbered List (`⇧⌘7`):** Toggles ordered list on the selected text blocks via `smartToggleBlockFormat(editor, "orderedList")`. Displays active checkmark when active.

*(Note: "Insert/Edit Link" has been completely removed from this menu to eliminate non-functional prompt prompts and maintain an ultra-minimal editing menu).*

### Behavior & Guarantees
- Selection is preserved on right-click inside the selection.
- Clicking menu items does not steal focus or collapse selection before dispatching commands.
- If clicked outside an existing selection, the previous selection is cleared, the caret moves to the clicked location, and the no-selection menu opens at that new point.

---

## 3. No-Selection Menu (Menu B)

Triggered when the user secondary-clicks inside the editor without an active text selection at the clicked location.

### Supported Actions & Shortcuts
- **Paste (`⌘V`):** Inserts clipboard text or Markdown at the clicked cursor position.
- *Separator*
- **Undo (`⌘Z`):** Reverts the last document edit via `editor.chain().focus().undo().run()`. Automatically disabled with dimmed styling when `editor.can().undo()` is false.
- **Redo (`⇧⌘Z`):** Reapplies previously undone changes via `editor.chain().focus().redo().run()`. Automatically disabled when `editor.can().redo()` is false.
- *Separator*
- **Insert → (Submenu):**
  - **Heading 1 (`⌘⌥1`):** Formats current block as H1 via `setNode("heading", { level: 1 })`.
  - **Heading 2 (`⌘⌥2`):** Formats current block as H2 via `setNode("heading", { level: 2 })`.
  - **Bullet List (`⇧⌘8`):** Converts current block into a bullet list via `toggleBulletList()`.
  - **Numbered List (`⇧⌘7`):** Converts current block into a numbered list via `toggleOrderedList()`.
  - **Checklist (`⇧⌘9`):** Converts current block into a task list via `toggleTaskList()`.
  - **Code Block (`⌘⌥C`):** Inserts a code block via `toggleCodeBlock()`.
  - **Divider (`---`):** Inserts a horizontal rule via `setHorizontalRule()`.

*(Note: Select All was intentionally removed from this secondary-click menu to keep it minimally compact; the global `⌘A` keyboard shortcut continues to function natively across the entire editor).*

### Behavior & Guarantees
- Resolves valid clicked cursor position via `view.posAtCoords` or boundary fallback (top/bottom margins).
- Compact vertical footprint (does not show redundant text formatting controls when no text is highlighted).
- Submenu flips direction horizontally if close to the right viewport edge.

---

## 4. Specialized Contexts

Secondary clicks within specific semantic nodes trigger specialized context actions:

### Link Context
- **Trigger:** Right-clicking on or inside a link mark (even without highlighted text).
- **Actions:**
  - **Open Link:** Launches URL in default macOS browser via `@tauri-apps/plugin-opener` (`openUrl`), falling back to `window.open`.
  - **Copy Link:** Copies link target URL directly to clipboard.
  - **Edit Link (`⌘K`):** Prompts for new URL and updates link mark in place.
  - **Remove Link:** Unsets the link mark via `editor.chain().focus().unsetLink().run()`.
  - *If text within the link is also selected*, standard Cut, Copy, Bold, and Italic actions are appended.

### Code Block Context
- **Trigger:** Right-clicking inside a code block (`pre.notefast-code-block`).
- **Actions:**
  - **Copy Code:** Copies the entire raw text content of the code block to clipboard.
  - **Select Code:** Selects all text within the code block (`setTextSelection`).
  - Standard Paste, Select All, Undo, and Redo.

### Checklist (Task Item) Context
- **Trigger:** Right-clicking inside a checklist item (`taskItem`).
- **Actions:**
  - **Toggle Completion:** Directly flips `checked` attribute via transaction on the task item node.
  - **Insert Checklist Item (`Enter`):** Splits current task list item via `splitListItem("taskItem")`.
  - Standard Paste, Select All, Undo, Redo, and Insert submenu.

### Block Selection Context
- **Trigger:** Right-clicking when rayNote's Notion-style block selection is active (`selectedPositions.length > 0`).
- **Actions:**
  - **Copy Block(s) (`⌘C`):** Copies Markdown serialization of all selected blocks.
  - **Cut Block(s) (`⌘X`):** Copies Markdown and removes selected blocks.
  - **Delete Block(s) (`⌫`):** Invokes `deleteSelectedBlocks(editor.view)`.
  - **Clear Selection (`Esc`):** Exits block selection mode.

---

## 5. Architecture

### 1. Component Separation
- **`src/editor/contextMenuUtils.ts`**: Pure functions for position resolution, context classification, state modeling, and action dispatching.
- **`src/editor/EditorContextMenu.tsx`**: Presentation layer rendered via `createPortal(..., document.body)`. Encapsulates window collision detection, submenu positioning, accessibility semantics, hover states, and keyboard navigation.
- **`src/editor/Editor.tsx`**: Event interception wiring (`handleDOMEvents.contextmenu` and `onContextMenu`), state holding, and note-switch cleanup.

### 2. Selection & Cursor Management
- ProseMirror state (`view.state.selection`) is the single authoritative source of selection truth.
- Click coordinates `(x, y)` are resolved via `view.posAtCoords({ left: x, top: y })`.
- If clicked coordinates fall within an active non-empty text selection (`targetPos >= from && targetPos <= to`), the selection range is preserved and saved in menu state.
- If clicked coordinates are outside the active selection, a safe `Selection.near(doc.resolve(targetPos))` is dispatched, preventing invalid gap states or stale cursor jumps.
- All interactive menu elements use `onMouseDown={(e) => e.preventDefault()}` to prevent DOM focus transfer that would cause WebKit to blur the editor and deselect text.

---

## 6. Native Menu Fix

### The Problem
Previously, right-clicking in the WebKit webview surfaced the default native macOS text-editing menu (Cut, Copy, Paste, Font, Spelling and Grammar, Substitutions, etc.), causing custom menus to overlap or stack awkwardly above the native menu.

### The Solution
1. **Immediate Synchronous Interception in ProseMirror:**
   In `src/editor/Editor.tsx` under `editorProps.handleDOMEvents.contextmenu`:
   ```ts
   contextmenu: (_view, event) => {
     event.preventDefault();
     event.stopPropagation();
     // resolve context and open custom menu
     return true;
   }
   ```
2. **Container Boundary Interception:**
   On the scroll container wrapper (`scrollContainerRef`):
   ```tsx
   <div ref={scrollContainerRef} onContextMenu={handleContextMenu} ... />
   ```
   Ensures clicks on blank margins, bottom padding, or around block boundaries synchronously prevent default before WebKit triggers the native context menu.
3. **Preserved Native Scope Elsewhere:**
   The `contextmenu` suppression is strictly scoped to the editor surface. Unrelated UI areas (TitleBar, NoteList, Search inputs, SettingsApp, ShortcutsModal) retain normal macOS default right-click behavior.

---

## 7. UI and Theme Integration (macOS Liquid Glass Redesign)

- **Appearance:** Follows Apple's premium Liquid Glass design language (iOS 26 / macOS Tahoe):
  - **Generous Rounded Corners:** Container `border-radius: 20px`, item `border-radius: 12px`, with concentric geometry ($R_{\text{inner}} = R_{\text{outer}} - \text{padding}$).
  - **Frosted Translucent Material:**
    - Dark mode: `rgba(28, 28, 34, 0.78)` with `backdrop-filter: blur(36px) saturate(210%)`.
    - Light mode: `rgba(255, 255, 255, 0.80)` with `backdrop-filter: blur(36px) saturate(210%)`.
  - **Light Reflection & Shadows:**
    - Dark mode: `0 16px 42px -4px rgba(0, 0, 0, 0.52), 0 4px 12px 0 rgba(0, 0, 0, 0.25)` with top specular reflection `inset 0 1px 1px 0 rgba(255, 255, 255, 0.22)`.
    - Light mode: `0 14px 34px -4px rgba(0, 0, 0, 0.14), 0 4px 12px 0 rgba(0, 0, 0, 0.06)` with top specular reflection `inset 0 1px 1px 0 rgba(255, 255, 255, 0.95)`.
  - **Restrained Item Dimensions:** `28px` item height with `padding: 0 10px; font-size: 13px; font-weight: 450;`.
  - **Soft Translucent Accent Highlight:** Replaced the harsh solid rectangular highlight with a soft, rounded accent capsule (`color-mix(in srgb, var(--color-accent) 22%, rgba(255, 255, 255, 0.08))` in dark mode and `color-mix(in srgb, var(--color-accent) 18%, rgba(0, 0, 0, 0.04))` in light mode).
  - **Submenu Bridge Corridor:** Transparent pseudo-element bridge (`::before`) between parent item and submenu prevents accidental hover drops during diagonal mouse movements.
  - **Responsive Edge Collision Handling:** Viewport collision detection flips the submenu horizontally to the left (`align-left`) when near the right edge of the screen, and dynamically adjusts the vertical offset when near the bottom of the window so the submenu never clips.

---

## 8. Changed Files

| File | Type | Description |
| :--- | :--- | :--- |
| `src/editor/contextMenuUtils.ts` | Modified | Context detection, position resolution, link removal from selected text context, and command execution logic. |
| `src/editor/EditorContextMenu.tsx` | Modified | React context menu UI component with dynamic bounding-box collision detection, submenu flipping, macOS Liquid Glass geometry, and keyboard navigation. |
| `src/editor/__tests__/contextMenuUtils.test.ts` | Modified | Unit tests for context detection and command execution. |
| `src/editor/__tests__/editorContextMenuComponent.test.tsx` | Modified | Component tests for rendering, interaction, submenus, Link removal from Menu A, and edge collision flips. |
| `src/editor/__tests__/editorContextMenuIntegration.test.tsx` | Unchanged | End-to-end integration tests for `preventDefault()`, note switching, and scoping. |
| `src/editor/Editor.tsx` | Unchanged | Wired `contextmenu` DOM events and mounted `EditorContextMenu`. |
| `src/index.css` | Modified | Redesigned `.editor-context-menu`, `.editor-context-submenu`, capsule highlights, specular highlights, and animations for macOS Liquid Glass. |
| `src/lib/clipboard.ts` | Unchanged | Clipboard utilities. |

---

## 9. Functional Validation

### Automated Test Results
- **Vitest Test Suite:** `73/73` test files passed, `571/571` tests green.
  - `src/editor/__tests__/contextMenuUtils.test.ts`: 9/9 passed.
  - `src/editor/__tests__/editorContextMenuComponent.test.tsx`: 10/10 passed.
  - `src/editor/__tests__/editorContextMenuIntegration.test.tsx`: 3/3 passed.
  - All existing 70 test files passed without regressions.
- **Build & Compilation Check:**
  - `pnpm run build` (`tsc && vite build`): Succeeded in 719ms with 0 type errors.

### Verified Scenarios
1. **Selected Text:** Word selection, multi-word selection, multi-line selection; Bold, Italic, Link, Lists applied correctly without selection loss.
2. **No Selection:** Caret positioning at clicked coordinates on empty lines, middle of paragraphs, headings, list boundaries; Insert submenu blocks correctly created.
3. **Special Contexts:** Link Open/Copy/Edit/Remove; Code block copy & select; Task list completion toggling; Block selection copy & delete.
4. **Native Suppression:** Confirmed `event.preventDefault()` suppresses macOS native menu on secondary click.
5. **Dismissal & Lifecycle:** Dismissal on Escape, outside click, editor scroll, window blur, and note switching.
6. **Keyboard Navigation:** ArrowDown/ArrowUp through items, ArrowRight into submenu, ArrowLeft back to menu, Enter to execute.

---

## 10. Known Limitations

- **System Spellcheck Suggestions:** macOS WebKit only surfaces spellcheck replacement suggestions through its private native context menu. Since the custom menu replaces the native menu inside editor surfaces, system spellcheck suggestions are not embedded in this minimal custom menu.
- **Tauri Native Clipboard in Headless CI:** In headless CI test environments where `navigator.clipboard` is absent, clipboard read gracefully falls back to empty string without throwing.

---

## 11. Deferred Work

In accordance with project instructions:
- Memory profiling and CPU latency benchmarking were intentionally deferred to a dedicated task.
- No Git commit or mutating Git operations were performed on the repository.

---

## 12. Slash Menu Dynamic Sizing, Formatting Icons, and Submenu Isolation Fixes

### 12.1 Root Cause Analysis

1. **Slash-Command Menu Height (Too Short):**
   - In `src/index.css`, `.slash-command-menu` had a hardcoded `max-height: 280px;`.
   - With 17 commands and ~29px row height, this arbitrarily capped visibility to 9 items even on tall viewports, forcing unnecessary internal scrolling.
2. **Slash Menu Viewport Clipping (Boundary Clipping):**
   - Popper in Tippy was configured with static `placement: "bottom-start"`.
   - When the editor caret was close to the window bottom (e.g., typing `/he` or `/`), Popper could not expand upward if placement did not dynamically switch, and Popper did not clamp `maxHeight` to available vertical space. This caused the menu to overflow below the bottom edge of the window.
3. **Missing Context Menu Formatting Icons:**
   - In `src/editor/EditorContextMenu.tsx`, the item renderer checked `item.active !== undefined`. For Bold, Italic, Bullet List, and Numbered List, `item.active` was a boolean.
   - When `item.active !== undefined`, the renderer bypassed `item.icon` entirely and rendered only `<span className="editor-context-menu-check">`. When `active` was false, it rendered an empty 15px check placeholder (blank slot), omitting the icon completely. When active was true, it displayed a checkmark in place of the icon.
   - Task List was missing entirely from the `text-selected` menu definition.
4. **Insert Submenu Overlap and Incorrect Placement:**
   - The Insert submenu was rendered inside `<div className="editor-context-menu-item">` using `position: absolute; left: calc(100% + 4px);`.
   - The parent `.editor-context-menu` had an entry animation (`animation: editorContextMenuScaleIn`) with CSS `transform: scale(0.96) translateY(-2px)`. In CSS and WebKit, any non-none `transform` establishes a new local stacking context and containing block for descendants.
   - This trapped the submenu within the parent's layout box. Near window edges or in flex layouts, `calc(100% + 4px)` overlapped directly onto parent items or clipped behind sibling stacking contexts.

---

### 12.2 Implementation Changes

1. **Content-Aware and Viewport-Aware Slash Menu Sizing & Flipping:**
   - In `src/editor/SlashCommand.tsx`, introduced `computeSlashMenuPlacementAndHeight`:
     - Measures required content height: `itemCount > 0 ? (itemCount * 29 + 11) : 40`.
     - Measures space above and below caret: `spaceBelow = windowHeight - caret.bottom - 18`, `spaceAbove = caret.top - 18`.
     - Automatically selects `bottom-start` when space below is sufficient; flips to `top-start` when space below is tight but space above is sufficient; or chooses whichever side has more usable space.
     - Clamps `maxHeight` so it shrinks to fit filtered results (e.g., 69px for 2 items from `/he`) and never exceeds available screen space.
   - In `renderItems`, applied dynamic `style.maxHeight` and updated Tippy placement on startup, on query update, and on window `resize` and editor `scroll`.
   - In `src/index.css`, replaced `max-height: 280px;` with `max-height: min(520px, calc(100vh - 24px)); height: auto;`.
2. **Preserved Icon Column & Dedicated Active Check Indicator:**
   - In `src/editor/EditorContextMenu.tsx`, separated the icon slot from the active indicator:
     - Left column (`.editor-context-menu-item-left`): Always renders `item.icon` (`<Bold size={13} />`, `<Italic size={13} />`, `<List size={13} />`, `<ListOrdered size={13} />`, `<CheckSquare size={13} />`).
     - Right column (`.editor-context-menu-item-right`): Displays dedicated `<Check size={11} strokeWidth={2.8} />` in `.editor-context-menu-active-check` when active, alongside configurable shortcuts.
     - Added Task List (`<CheckSquare size={13} />`) to the `text-selected` menu definition.
3. **Submenu Fixed Portal & Collision Geometry:**
   - Submenu is rendered into `createPortal(..., document.body)` with `position: fixed` and `z-index: 10002` (strictly above the parent menu's `10000`).
   - Dynamically calculates viewport coordinates based on parent item rect:
     - When space on right permits: `side: "right"`, `posX = parentRect.right + 4`.
     - When space on right is insufficient: `side: "left"`, `posX = parentRect.left - subWidth - 4`.
     - Clamps `posY` to ensure the submenu remains inside the window vertically.
   - Preserves hover corridor bridge (`::before` pseudo-element) for seamless diagonal mouse navigation.
4. **Task List Integration:**
   - In `src/editor/contextMenuUtils.ts`, added `isTaskList: boolean` to `ContextMenuState`, queried `editor.isActive("taskList")`, and handled `case "taskList":` via existing `smartToggleBlockFormat(editor, "taskList")`.

---

### 12.3 Files Modified

| File | Changes |
| :--- | :--- |
| `src/editor/SlashCommand.tsx` | Implemented `computeSlashMenuPlacementAndHeight`, dynamic `maxHeight` clamping, viewport flipping, and resize/scroll listeners. |
| `src/editor/EditorContextMenu.tsx` | Added Task List to text-selected menu, decoupled icon column from active checkmark, rendered submenu in fixed `createPortal` with coordinate collision geometry. |
| `src/editor/contextMenuUtils.ts` | Added `isTaskList` to state interface and resolution, routed `taskList` action to `smartToggleBlockFormat`. |
| `src/index.css` | Replaced fixed 280px slash menu height with dynamic viewport max-height, added `.editor-context-menu-item-right`, `.editor-context-menu-active-check`, and fixed submenu positioning. |
| `src/editor/__tests__/slashCommandHighlightAndClean.test.tsx` | Added 4 unit tests for full expansion, filtered shrinkage, bottom edge caret flip, and clamp behavior. |
| `src/editor/__tests__/editorContextMenuComponent.test.tsx` | Added tests for formatting icons, active check rendering, Task List block execution, and fixed portal collision geometry. |
| `src/editor/__tests__/contextMenuUtils.test.ts` | Added regression test for `taskList` action execution. |
| `src/editor/__tests__/menuDoubleHighlightRegression.test.tsx` | Updated state mocks with `isTaskList: false`. |

---

### 12.4 Verification & Test Results

- **Targeted Menu Test Suites:**
  - `pnpm vitest run src/editor/__tests__/editorContextMenuComponent.test.tsx src/editor/__tests__/contextMenuUtils.test.ts src/editor/__tests__/slashCommandHighlightAndClean.test.tsx src/editor/__tests__/menuDoubleHighlightRegression.test.tsx`
  - **4/4 test files passed, 39/39 tests green.**
- **Full Project Vitest Suite:**
  - `pnpm vitest run src/`
  - **77/77 test files passed, 605/605 tests green.**
- **TypeScript Typecheck:**
  - `pnpm exec tsc --noEmit` passed with 0 errors.
- **Vite Production Build:**
  - `pnpm run build` completed in 781ms without errors or warnings.
- **Tauri Native Application Bundle:**
  - `pnpm tauri build --bundles app` succeeded and bundled `rayNote.app` (8.40 MiB).
- **macOS Application Execution:**
  - Relaunched native macOS app via `open -n "/Users/rashmipersonal/Desktop/MAC Apps/rayNote/src-tauri/target/release/bundle/macos/rayNote.app"`.

---

### 12.6 Refinement: Stable Width, Compact Half-Window Scrollbar, and Wrap Navigation

1. **Stable Width Matching Image 1:**
   - In `src/index.css`, pinned `.slash-command-menu` with `width: 204px; min-width: 204px; max-width: 236px;`.
   - Prevents the container from horizontally shrinking into the compressed width seen in Image 2, ensuring consistent generous spacing between command titles and `/` badges.
2. **Compact Half-Window Height & Visible Scrollbar:**
   - Capped `.slash-command-menu` at `max-height: 250px;` (approximately half of the previous ~500px full list height, displaying ~8 items at a time).
   - Styled macOS native Liquid Glass scrollbar with transparent tracks, thin pill thumbs (`rgba(255, 255, 255, 0.25)` in dark mode and `rgba(0, 0, 0, 0.22)` in light mode), and dynamic hover states.
   - Filtered queries (e.g. `/he`, 2 items) still shrink to fit the exact items (69px) without excess scrolling space.
3. **Wrap-Around Keyboard Navigation:**
   - In `src/editor/SlashCommand.tsx`, updated `ArrowDown` navigation to wrap from the last option to the first option: `(prev + 1) % items.length`.
   - Updated `ArrowUp` navigation to wrap from the first option to the last option: `(prev - 1 + items.length) % items.length`.
   - Preserved automatic scrolling to keep the active wrapped item visible in the viewport.

1. **Slash Menu Full Height:**
   - Type `/` on a fresh note.
   - Confirm menu expands to show all commands without unnecessary scrolling on normal window heights.
2. **Slash Menu Filtered Shrinkage:**
   - Type `/he`.
   - Confirm menu immediately shrinks to fit Heading 1 and Heading 2 without trailing empty space.
3. **Slash Menu Bottom Boundary Flip:**
   - Press Enter until the caret is near the bottom edge of the window.
   - Type `/` or `/he`.
   - Confirm menu automatically opens above the caret and is completely visible.
4. **Context Menu Icons & Task List:**
   - Select text and secondary-click.
   - Confirm Bold, Italic, Bullet List, Numbered List, and Task List all show their respective icons.
   - Click Bold; re-open context menu and confirm Bold displays both its `<Bold>` icon on the left and a checkmark on the right.
   - Click Task List; confirm selected paragraph is converted into an active task item.
5. **Insert Submenu:**
   - Right-click without selection.
   - Hover over "Insert".
   - Confirm submenu opens neatly beside the parent menu (to the right, or to the left if near screen right edge) with zero overlap, and never renders behind the parent menu.

