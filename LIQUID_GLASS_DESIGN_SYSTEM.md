# rayNote — Liquid Glass Design System, Slash Command Architecture & Responsive Settings

This document specifies the unified **macOS Liquid Glass design system**, the **slash command menu corrections**, the **responsive Settings window redesign**, and the **centralized keyboard shortcut synchronization engine** in rayNote.

---

## 1. Design Vision & Philosophy

rayNote's visual identity embraces Apple's modern macOS Liquid Glass aesthetic (inspired by iOS 26 / macOS Tahoe design principles).
Key visual characteristics:
- **Materiality & Depth:** Authentic frosted glass with high-performance `backdrop-filter: blur(36px) saturate(210%)`.
- **Specular Illumination:** Crisp 1px inner top highlight (`inset 0 1px 1px 0 rgba(255, 255, 255, 0.22)` in Dark, `inset 0 1px 1px 0 rgba(255, 255, 255, 0.95)` in Light).
- **Proportional Geometry:** Smooth continuous curvature with 28px window corners, 20px–22px menu/panel corners, and 12px interactive item capsules.
- **Accented Translucency:** Subtle tinted interaction capsules using CSS `color-mix(in srgb, var(--color-accent) ..., ...)` that adapt dynamically across all 6 accent palettes without muddy opacity stacking.
- **Strict Legibility:** Content text remains high-contrast opaque (`#f8fafc` dark, `#0f172a` light) while surrounding surfaces maintain refined glass translucency.

---

## 2. Token Architecture & CSS Variables

Tokens are centrally registered in `src/index.css` and dynamically react to theme mode (`dark`, `light`, `system`) and accent palettes (`violet`, `amber`, `ocean`, `emerald`, `rose`, `slate`).

### Dark Mode Tokens (`:root`, `.dark`, `[data-theme="dark"]`, `[data-resolved-theme="dark"]`)
| Token | Value | Purpose |
| :--- | :--- | :--- |
| `--glass-menu-bg` | `rgba(28, 28, 34, 0.78)` | Context menus, submenus, slash menu, dropdowns |
| `--glass-menu-blur` | `blur(36px) saturate(210%)` | Hardware-accelerated background blur |
| `--glass-menu-border` | `rgba(255, 255, 255, 0.14)` | Hairline translucent specular border |
| `--glass-menu-shadow` | `0 16px 42px -4px rgba(0, 0, 0, 0.52), 0 4px 12px 0 rgba(0, 0, 0, 0.25)` | Multi-stage floating elevation |
| `--glass-menu-highlight`| `inset 0 1px 1px 0 rgba(255, 255, 255, 0.22)` | Top specular rim highlight |
| `--glass-item-hover-bg` | `color-mix(in srgb, var(--color-accent) 22%, rgba(255, 255, 255, 0.08))` | Interactive hover state capsule |
| `--glass-item-selected-bg`| `color-mix(in srgb, var(--color-accent) 26%, rgba(255, 255, 255, 0.12))` | Active keyboard / selected state |
| `--glass-panel-bg` | `rgba(28, 28, 34, 0.82)` | Settings cards, modals, header bar |
| `--glass-panel-border`| `rgba(255, 255, 255, 0.12)` | Card outline |
| `--glass-panel-shadow`| `0 20px 50px -6px rgba(0, 0, 0, 0.6), inset 0 1px 1px 0 rgba(255, 255, 255, 0.18)` | Panel depth |
| `--glass-control-bg` | `rgba(255, 255, 255, 0.07)` | Kbd tags, input badges, stepper buttons |
| `--glass-control-border`| `rgba(255, 255, 255, 0.10)` | Control border |
| `--glass-radius-menu` | `22px` | Menu outer perimeter |
| `--glass-radius-item` | `12px` | Menu item capsules |
| `--glass-radius-panel`| `20px` | Modals and cards |
| `--glass-radius-control`| `8px` | Badges, keyboard keys, mini buttons |
| `--glass-radius-pill` | `9999px` | Theme mode pills, dock buttons |

### Light Mode Tokens (`.light`, `[data-theme="light"]`, `[data-resolved-theme="light"]`)
| Token | Value | Purpose |
| :--- | :--- | :--- |
| `--glass-menu-bg` | `rgba(255, 255, 255, 0.80)` | Pure frosted white glass |
| `--glass-menu-border` | `rgba(255, 255, 255, 0.65)` | Crisp bright glass rim |
| `--glass-menu-shadow` | `0 14px 34px -4px rgba(0, 0, 0, 0.14), 0 4px 12px 0 rgba(0, 0, 0, 0.06)` | Diffuse soft daylight drop shadow |
| `--glass-menu-highlight`| `inset 0 1px 1px 0 rgba(255, 255, 255, 0.95)` | Brilliant specular top highlight |
| `--glass-item-hover-bg` | `color-mix(in srgb, var(--color-accent) 18%, rgba(0, 0, 0, 0.04))` | Light accent hover capsule |
| `--glass-item-selected-bg`| `color-mix(in srgb, var(--color-accent) 22%, rgba(0, 0, 0, 0.06))` | Selected item state |
| `--glass-panel-bg` | `rgba(255, 255, 255, 0.85)` | Daylight panel background |
| `--glass-panel-border`| `rgba(0, 0, 0, 0.08)` | Subdued card edge |
| `--glass-panel-shadow`| `0 16px 40px -4px rgba(0, 0, 0, 0.12), inset 0 1px 1px 0 rgba(255, 255, 255, 0.95)` | Clean light elevation |
| `--glass-control-bg` | `rgba(0, 0, 0, 0.04)` | Subtle control tint |
| `--glass-control-border`| `rgba(0, 0, 0, 0.08)` | Subtle control outline |

---

## 3. Slash Command Menu Fixes & Minimal Redesign

### Root-Cause Investigation: Double-Highlighting
**Investigation Finding:**
The simultaneous highlight on two items (e.g. Heading 2 and Task List) stemmed from a conflict between React selection state and independent CSS pseudo-classes:
1. `SlashCommand.tsx` maintained an authoritative `selectedIndex` state rendered as `.is-selected` on the active row.
2. `src/index.css` simultaneously defined `.slash-command-item:hover:not(.is-selected) { background: ... !important; }`.
3. If the mouse rested over another item when the menu opened or after keyboard navigation moved `selectedIndex`, the CSS `:hover` engine painted a second background highlight over the hovered row.

**The Solution:**
1. **Single Authoritative Navigation State:** Removed independent CSS `:hover` background styling. Visual highlighting is driven exclusively by `.slash-command-item.is-selected`.
2. **Pointer & Keyboard Coordination:**
   - In `SlashCommand.tsx`, `handleMouseMove` compares `(e.clientX, e.clientY)` against `lastMousePosRef`. Only genuine physical mouse movements update `selectedIndex`.
   - `handleMouseEnter` and `handleMouseMove` update `selectedIndex` so that hovering an item immediately makes it the active option.
   - `ArrowUp` and `ArrowDown` update `selectedIndex` with clamping.
   - Because only the active `selectedIndex` receives `.is-selected`, exactly one option is highlighted at any time.
   - `selectedEl.scrollIntoView({ block: "nearest" })` keeps the active item visible during keyboard navigation.

### Clean & Minimalist UI Layout
- **Hidden Badges:** Removed the visible rendering of right-aligned shortcut badges (e.g., `⌘⌥1`) and alias pills (e.g., `/h1`, `/todo`, `/bullet`) from the menu row UI.
- **Search Preservation:** Preserved `badge` and `aliases` properties in `ALL_COMMAND_ITEMS` and `scoreItem`. Users can still type `/h1`, `/h2`, `/todo`, `/bullet`, `/code`, etc. to instantly filter commands.
- **Visual Composition:** Each row now contains only the glyph icon container and the command title text.

### Improved Spacing & Dimensions
- Row vertical padding: `8px 12px` with `min-height: 38px`.
- Row horizontal padding: `12px`.
- Menu outer border radius: `22px`.
- Item highlight border radius: `12px`.
- Glyph icon container: `24px × 24px` with `8px` border radius and centered Lucide iconography.
- Menu padding: `7px` with `3px` gap between rows.

---

## 4. Responsive Settings Window Redesign

### Navigation Tabs
- **Containerization:** Wrapped tab pills inside `.settings-tab-pills-container` (a centered, fluid flex container) and `.settings-tab-pills`.
- **Horizontal Adaptation:**
  - Added `overflow-x: auto` with hidden scrollbars (`scrollbar-width: none; -webkit-overflow-scrolling: touch;`).
  - Adjusted tab padding to `5px 11px` with `gap: 3px`. All 5 tabs (`General`, `Commands`, `Aliases`, `Storage`, `About`) fit within 350px.
  - The right spacer was reduced from a rigid 48px to a flexible 32px, preventing the "About" tab from clipping on 500px min-width windows or high-DPI displays.
- **Active Tab Auto-Scroll:** Attached `tabPillsRef` to `.settings-tab-pills` with an active-pane effect that calls `scrollIntoView({ behavior: "smooth", inline: "nearest" })` whenever `activePane` changes.

### Window Corner Radius & macOS NSWindow Architecture
- `src-tauri/src/commands.rs` configures the Settings window as:
  ```rust
  .decorations(false)
  .transparent(true)
  .shadow(true)
  ```
- Because the window is transparent and frameless, the visual window boundary is controlled by `.settings-window-root`.
- Upgraded `.settings-window-root` from `border-radius: 12px` to continuous macOS `border-radius: 28px` with `border: 1.5px solid var(--app-border)` and `box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45), var(--app-inner-highlight)`.
- Added matching `border-top-left-radius: 28px; border-top-right-radius: 28px;` to `.settings-header-bar`.
- Internal `.settings-card` elements upgraded to `border-radius: 20px`.

### Content Reflow & Storage Tab
- **Responsive Rows:** At viewport widths under 520px, `.settings-row` reflows from side-by-side to stacked column layout (`flex-direction: column; align-items: flex-start; gap: 10px;`).
- **Action Group Wrapping:** `.settings-row-action`, segmented controls, and `.settings-danger-confirm-group` flex-wrap cleanly, preventing buttons from clipping or overflowing their parent cards.
- **Preserved Features:**
  - SQLite Database Storage with "Open in Finder" (`openAppDataFolder`).
  - Total Notes count badge (`storageStats.notes_count`).
  - Export All Notes with "Export Markdown" (`handleExportAll`).
  - Danger Zone with 2-step confirmation checkbox and "Delete All" (`handleClearAllNotes`).

---

## 5. Dynamic Keyboard Shortcut Architecture

1. **Single Source of Truth (`src/lib/commandsConfig.ts`):**
   Formatting commands, blocks, and app commands are registered in `DEFAULT_COMMANDS`.
2. **Settings Synchronization:**
   - Double-clicking any shortcut in Settings records new keys.
   - `detectShortcutConflict(newHotkey, commandId, commands)` warns of collisions.
   - `saveCommandsConfig` commits changes to `localStorage` and broadcasts to all windows via `broadcastSync`.
3. **ProseMirror Runtime Execution (`src/editor/shortcutsExtension.ts`):**
   - High-priority `dynamicShortcutsPlugin` checks keystrokes against active hotkeys.
   - Executes remapped hotkeys immediately and blocks remapped-away defaults.
4. **Synchronized UI Surfaces:**
   - Context menus, slash command search, and toolbar tooltips dynamically reflect user bindings via `useCommandsConfig()`.

---

## 6. Verification & Automated Test Results

### Test Suite Execution
- **`src/editor/__tests__/slashCommandHighlightAndClean.test.tsx` (6 tests):**
  - Verifies exact 1-item active highlight invariant.
  - Verifies keyboard navigation moves highlight correctly.
  - Verifies pointer hover coordinates with keyboard navigation without dual highlights.
  - Verifies Enter executes active item.
  - Verifies absence of shortcut and slash alias badges from DOM.
  - Verifies alias search filtering still functions (`/h1`, `/todo`, `/bullet`, `/code`).
- **`src/components/__tests__/settingsResponsiveTabs.test.tsx` (4 tests):**
  - Verifies all 5 tabs render without clipping.
  - Verifies pane switching across General, Commands, Aliases, Storage, and About.
  - Verifies Storage actions and confirmation flow.
  - Verifies responsive layout container structure.
- **`src/lib/__tests__/dynamicShortcutSync.test.ts` (10 tests):**
  - Verifies shortcut configuration, re-binding, and key matching.
- **Full Test Suite:**
  **76 test files passed, 591 tests passed (0 failures)**.

### Build Verification
- `tsc && vite build`: Completed in 1.62s with 0 errors.
- Native Tauri App Bundle (`pnpm tauri build --bundles app`): Built cleanly.
- Native App Process: Running on macOS.


---

# Part 13: Menu Unification & Double-Highlight Prevention (Image 2 Parity)

### 1. Root Cause Analysis of Double Highlighting
Across interactive menus (`EditorContextMenu`, `SlashCommand`, `FloatingCodeBlockToolbar`, `CodeBlockComponent`), two items were frequently highlighted simultaneously due to a combination of three root causes:
1. **CSS `:hover` vs React Active Highlight Collision:**
   In `src/index.css`, selectors like `.editor-context-menu-item:hover:not(:disabled)` and `.code-lang-item:not(.is-selected):hover` applied the active highlight background directly through CSS pseudo-classes. When the user navigated via Arrow Up/Down, React updated the active index (`is-highlighted` / `is-selected`), but the browser continued painting the hover background on the element physically under the mouse cursor.
2. **Stationary Pointer Over Items During Keyboard Navigation:**
   When using Arrow keys while the mouse remained stationary over an item, browser mouse move / enter events fired during DOM re-renders or minor subpixel scrolls. Without pointer coordinate delta tracking, these synthetic events immediately hijacked selection back to the hovered item or caused dual selection artifacts.
3. **Submenu Parent Item Over-Selection:**
   In cascading submenus (such as `Insert →`), the parent item in the primary menu retained the active highlight class (`.is-highlighted`) even while the user was actively navigating the child submenu items, creating the visual impression of two active selections.

### 2. Resolution & Architecture
1. **Authoritative Single-Highlight Rule in CSS:**
   - Removed `:hover` background painting across all menu items in `src/index.css`.
   - Set `.editor-context-menu-item:not(.is-highlighted):not(.is-submenu-open):hover { background: transparent !important; }`.
   - Set `.slash-command-item:not(.is-selected):hover { background: transparent !important; }`.
   - Set `.code-lang-item:not(.is-selected):hover { background: transparent !important; }`.
   - The visual highlight background (`var(--glass-item-hover-bg)`) is now exclusively driven by `.is-highlighted` / `.is-selected`.
2. **Stationary Pointer Protection (`dx > 2 || dy > 2` & `ignorePointerRef`):**
   - In `EditorContextMenu.tsx`, `SlashCommand.tsx`, `FloatingCodeBlockToolbar.tsx`, and `CodeBlockComponent.tsx`, keyboard navigation sets `ignorePointerRef.current = true` and resets `lastMousePosRef`.
   - Stationary mouse pointers resting over any row cannot hijack selection or re-trigger hover highlights during Arrow key navigation.
   - Genuine mouse movement (`dx > 2 || dy > 2`) immediately re-enables pointer hover and smoothly transfers selection to the hovered item.
3. **Submenu State Distinction (`.is-submenu-open` vs `.is-highlighted`):**
   - When a submenu is open and the user is navigating its children (`submenuHighlightedIndex >= 0`), the parent row displays a subtle open-menu indicator (`.is-submenu-open` with `var(--glass-control-bg)`), while `.is-highlighted` is uniquely reserved for the active child option.

### 3. Slash Command Visual Parity with Image 2 (Context Menu Insert Submenu)
The slash-command menu was completely overhauled to match the compact secondary-click Insert submenu:
- **Row Height:** Reduced from oversized 38px to native **`28px`** matching context menu rows.
- **Icon Container:** Removed large 24×24px square boxes, borders, and background fills. Replaced with clean, unboxed **`15×15px`** icons styled identically to `.editor-context-menu-icon`.
- **Panel Geometry:** Outer radius set to `var(--glass-radius-menu)` (**`14px`**), padding set to **`6px`**, item radius set to `var(--glass-radius-item)` (**`8px`**).
- **Typography & Spacing:** 13px font with `weight: 450` and `letter-spacing: -0.01em`, gap of 8px between icon and title.
- **Right-Aligned Slash Shortcut Badges:** Brought back clean `/{badge}` indicators (e.g. `/todo`, `/h1`, `/h2`, `/bullet`, `/code`, `/table`, etc.) right-aligned with 11.5px subtle typography matching context menu shortcut labels.

### 4. Files Modified
- `src/index.css`: Removed `:hover` background painting across menus; restyled `.slash-command-menu`, `.slash-command-item`, `.slash-command-item-icon`, and `.slash-command-item-badge` to match `.editor-context-menu`.
- `src/editor/SlashCommand.tsx`: Coordinated pointer/keyboard state with stationary mouse protection, brought back `/{badge}` right-aligned indicators, safe `scrollIntoView` check.
- `src/editor/EditorContextMenu.tsx`: Added pointer delta tracking, decoupled `.is-submenu-open` from `.is-highlighted`.
- `src/editor/FloatingCodeBlockToolbar.tsx`: Added coordinate delta tracking and stationary pointer protection.
- `src/editor/CodeBlockComponent.tsx`: Added coordinate delta tracking and stationary pointer protection.
- `src/components/CommandPalette.tsx`: Reinforced stationary mouse pointer reset on Arrow navigation.
- `src/editor/__tests__/slashCommandHighlightAndClean.test.tsx`: Updated tests for single active highlight, hover coordination, and slash shortcut badges.
- `src/editor/__tests__/menuDoubleHighlightRegression.test.tsx`: Dedicated regression suite verifying single highlight across ArrowUp/Down, stationary pointer, and submenu states.

### 5. Verification Results
- Vitest Test Suite: **77 test files passed, 596 tests passed (0 failures)**.
- TypeScript & Vite Build: Passed with 0 errors.
- Native Tauri Release Bundle: Built and verified running.
