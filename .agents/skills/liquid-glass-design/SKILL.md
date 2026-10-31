---
name: liquid-glass-design
description: Apply Apple's Liquid Glass design language (iOS 26 / macOS Tahoe style) to an app UI. Use when asked to redesign, restyle, or build UI with Liquid Glass, glassmorphism in the Apple style, translucent floating navigation, frosted toolbars, or a "native Apple" look. Works for web (CSS/React/Next/Vue/Svelte) and native (SwiftUI). Do not use for flat, brutalist, or non-Apple visual directions.
---

# Liquid Glass Design Skill

Liquid Glass is a translucent material that blurs and refracts what is behind it, reacts to light and touch, and floats **above** content. It is a material for the **control and navigation layer**, not for everything.

## 1. Core principles (never break these)

1. **Glass is for the functional layer only.** Use it on navigation bars, tab bars, toolbars, floating buttons, sidebars, sheets, popovers, menus, and alerts. Do NOT use it on the main content (note text, list rows, cards of content, article bodies).
2. **No glass on glass.** Never stack a glass element directly on another glass element. Group nearby glass controls in one container so they share one material.
3. **Content stays in front visually.** The content layer scrolls beneath the glass. Glass should let it show through so the UI feels light.
4. **Concentric shapes.** Inner corner radius = outer radius minus padding. Prefer capsules for controls and large rounded rectangles (20 to 32 px) for panels.
5. **Tint with meaning only.** Use colour tint on glass for the primary action or state. Everything else stays neutral.
6. **Legibility beats effect.** If text over glass fails contrast, increase blur/opacity or add a subtle scrim. Never ship unreadable glass.
7. **Fewer, bigger layers.** Hierarchy comes from the glass vs content split, not from many shadows and borders.

## 2. Pick the path

Detect the stack first (read `package.json`, `Package.swift`, `*.xcodeproj`, `tailwind.config.*`).

- **SwiftUI (iOS 26+ / macOS 26+):** use the system API. Do not fake it.
- **Web:** build it with CSS tokens and primitives below.
- **Older OS or browsers:** provide a graceful fallback (Section 6).

## 3. SwiftUI path

- Apply glass: `.glassEffect()` or `.glassEffect(.regular.interactive(), in: .capsule)`
- Tint: `.glassEffect(.regular.tint(.blue).interactive())`
- Group glass controls: wrap in `GlassEffectContainer(spacing: 12) { ... }` so they blend and morph together.
- Morphing between states: use `glassEffectID(_:in:)` with a `@Namespace`.
- Buttons: `.buttonStyle(.glass)` for secondary, `.buttonStyle(.glassProminent)` for primary.
- Use standard `NavigationStack`, `TabView`, toolbars, and sheets. Recompiling with the latest SDK gives glass automatically. Remove custom bar backgrounds that block it.
- Scroll edge effects: keep content scrolling under bars, do not add opaque backgrounds behind toolbars.
- Gate with `#available(iOS 26, *)` and provide `.ultraThinMaterial` as the fallback.

## 4. Web path: design tokens

Put these in the global stylesheet (`:root`) and reuse everywhere. Do not hardcode values in components.

```css
:root {
  /* glass material */
  --glass-bg: rgba(255, 255, 255, 0.14);
  --glass-bg-strong: rgba(255, 255, 255, 0.24);
  --glass-border: rgba(255, 255, 255, 0.35);
  --glass-highlight: rgba(255, 255, 255, 0.55);
  --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  --glass-blur: 20px;
  --glass-saturate: 180%;

  /* shape */
  --radius-control: 999px;
  --radius-panel: 28px;
  --radius-sheet: 32px;

  /* motion */
  --ease-glass: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-fast: 180ms;
  --dur-base: 320ms;
}

@media (prefers-color-scheme: dark) {
  :root {
    --glass-bg: rgba(30, 30, 34, 0.38);
    --glass-bg-strong: rgba(40, 40, 46, 0.55);
    --glass-border: rgba(255, 255, 255, 0.14);
    --glass-highlight: rgba(255, 255, 255, 0.22);
    --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  }
}
```

## 5. Web path: primitives

Build these once, then compose every screen from them.

```css
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-highlight),   /* top light edge */
    inset 0 -1px 0 rgba(255,255,255,0.08);  /* bottom bounce light */
  transition: transform var(--dur-fast) var(--ease-glass),
              background var(--dur-base) var(--ease-glass);
}
.glass--capsule { border-radius: var(--radius-control); }
.glass--panel   { border-radius: var(--radius-panel); }
.glass--sheet   { border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; }
.glass--interactive:hover  { background: var(--glass-bg-strong); }
.glass--interactive:active { transform: scale(0.97); }
.glass--tinted { background: color-mix(in srgb, var(--accent) 28%, var(--glass-bg)); }
```

Components to create: `GlassBar` (top nav), `GlassTabBar` (floating bottom bar, inset from edges, capsule), `GlassButton`, `GlassIconButton`, `GlassSidebar`, `GlassSheet`, `GlassMenu`, `GlassToolbar`, `GlassSearchField`.

Rules for web:
- Navigation and tab bars **float** with margin from the screen edge and a capsule or large radius. They are not full-width opaque strips.
- The page background needs something to refract: soft gradient, wallpaper, or colourful content. Glass over a flat white background looks dull, so add a subtle gradient or mesh background to the app shell.
- Content (note cards, editor, lists) uses solid or near-solid surfaces with soft shadows, not glass.
- Add `padding-bottom` to scroll areas so content is not hidden behind floating bars.
- Use `position: sticky` or `fixed` bars with content scrolling underneath.

## 6. Fallbacks and accessibility (required)

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--surface-solid, rgba(245,245,247,0.95)); }
}
@media (prefers-reduced-transparency: reduce) {
  .glass { background: var(--surface-solid); backdrop-filter: none; }
}
@media (prefers-reduced-motion: reduce) {
  .glass, .glass--interactive { transition: none; }
  .glass--interactive:active { transform: none; }
}
```

- Text on glass must meet WCAG AA contrast (4.5:1 body, 3:1 large text and icons). Test over light AND dark backgrounds.
- Keep focus rings visible on glass (2px solid accent with offset).
- Touch targets at least 44x44 px.
- Provide a high-contrast variant using `prefers-contrast: more` (stronger border, higher opacity).
- Performance: limit blurred layers on screen (aim for 3 or fewer at once), avoid animating `backdrop-filter` values, animate transform and opacity instead. Check scrolling at 60 fps on a mid-range phone.

## 7. Common mistakes to avoid

- Glass on every card and list row.
- Glass stacked on glass.
- Heavy, dark drop shadows and thick borders (this reads as old glassmorphism, not Liquid Glass).
- Rainbow tints on many elements.
- Blur set so high the content becomes mush (stay around 16 to 28 px).
- Full-width opaque top bars that block the scroll-under effect.
- Forgetting dark mode.

## 8. Definition of done

- [ ] Tokens defined once, no hardcoded glass values in components
- [ ] Glass used only on the control/navigation layer
- [ ] No glass-on-glass anywhere
- [ ] Light and dark mode both checked
- [ ] Reduced transparency, reduced motion, and no-backdrop-filter fallbacks work
- [ ] Contrast passes AA over varied backgrounds
- [ ] Scrolling stays smooth
- [ ] Before/after screenshots captured for every screen changed

