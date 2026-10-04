/**
 * NoteFast Design System & Theme Engine (theme.ts)
 *
 * Responsibilities:
 * - Dynamic Theme Modes: Manages Dark, Light, and automatic System (prefers-color-scheme) modes,
 *   supporting smooth DOM animations via the native browser `document.startViewTransition` API.
 * - Curated macOS Accent Palettes: Injects custom CSS color tokens for Violet, Red, Emerald,
 *   Ocean, Sunset Amber, and Rose Quartz.
 * - Fluid Typography Engine: Configures font families (Inter, Comic Shanns, Nunito, Virgil,
 *   JetBrains Mono, Outfit) and binds them dynamically via the `--editor-font` CSS variable.
 * - Cross-Window Broadcast: Emits synchronization events across Tauri windows whenever
 *   visual preferences are modified in Settings or Command Palette.
 */

export type AccentColor = "violet" | "red" | "emerald" | "ocean" | "amber" | "rose";
export type ThemeMode = "dark" | "light" | "system";

export interface FontOption {
  id: string;
  name: string;
  family: string;
  category: "sans" | "mono" | "handwriting" | "system";
}

export const FONT_OPTIONS: FontOption[] = [
  { id: "comic", name: "Comic Shanns", family: "'Comic Shanns', cursive, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif", category: "handwriting" },
  { id: "nunito", name: "Nunito", family: "'Nunito', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif", category: "sans" },
  { id: "virgil", name: "Virgil", family: "'Virgil', cursive, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif", category: "handwriting" },
  { id: "mono", name: "JetBrains Mono", family: "'JetBrains Mono', 'Apple Color Emoji', 'Segoe UI Emoji', monospace", category: "mono" },
  { id: "inter", name: "Inter", family: "'Inter', -apple-system, BlinkMacSystemFont, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif", category: "sans" },
  { id: "outfit", name: "Outfit", family: "'Outfit', -apple-system, BlinkMacSystemFont, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif", category: "sans" },
];

export interface AccentOption {
  id: AccentColor;
  name: string;
  color: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: "violet", name: "Violet Aura", color: "#6C5CE7" },
  { id: "red", name: "Raycast Red", color: "#FF5555" },
  { id: "emerald", name: "Emerald Mint", color: "#10B981" },
  { id: "ocean", name: "Ocean Azure", color: "#0EA5E9" },
  { id: "amber", name: "Sunset Amber", color: "#F59E0B" },
  { id: "rose", name: "Rose Quartz", color: "#EC4899" },
];

export interface ThemeOption {
  id: ThemeMode;
  name: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "system", name: "System" },
];

/**
 * Retrieves the stored theme mode from localStorage, defaulting to 'dark'.
 */
export function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("notefast_theme_mode") as ThemeMode | null;
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "dark";
}

import { broadcastSync } from "./settingsSync";

/**
 * Applies the requested theme mode ('dark', 'light', 'system') to the document root element:
 * - Toggles `.dark` and `.light` CSS classes.
 * - Sets dataset attributes (`data-theme-mode`, `data-resolved-theme`).
 * - Uses `document.startViewTransition` when available for fluid crossfade animation.
 */
export function applyThemeMode(mode: ThemeMode, useTransition = false): void {
  if (typeof window === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);

  const updateDOM = () => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.resolvedTheme = isDark ? "dark" : "light";
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  };

  if (useTransition && typeof (document as any).startViewTransition === "function") {
    try {
      (document as any).startViewTransition(updateDOM);
      return;
    } catch {
      // Fallback
    }
  }
  updateDOM();
}

/**
 * Stores theme mode preference in localStorage and broadcasts change to all open windows.
 */
export function setStoredThemeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("notefast_theme_mode", mode);
  applyThemeMode(mode, true);
  broadcastSync({ type: "theme_mode", value: mode });
  window.dispatchEvent(new CustomEvent("notefast_theme_changed", { detail: { mode } }));
}

/**
 * Reads stored accent color ID, defaulting to 'violet'.
 */
export function getStoredAccent(): AccentColor {
  if (typeof window === "undefined") return "violet";
  const stored = localStorage.getItem("notefast_accent_color") as AccentColor | null;
  if (stored && ACCENT_OPTIONS.some((a) => a.id === stored)) {
    return stored;
  }
  return "violet";
}

/**
 * Updates `data-accent` attribute on root element, triggering CSS variable recomputation.
 */
export function applyAccent(accent: AccentColor): void {
  if (typeof window === "undefined") return;
  document.documentElement.dataset.accent = accent;
}

/**
 * Stores accent preference, updates root styles, and broadcasts to other windows.
 */
export function setStoredAccent(accent: AccentColor): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("notefast_accent_color", accent);
  applyAccent(accent);
  broadcastSync({ type: "accent", value: accent });
  window.dispatchEvent(new CustomEvent("notefast_accent_changed", { detail: { accent } }));
}

/**
 * Reads stored font family choice from localStorage, defaulting to 'inter'.
 */
export function getStoredFont(): string {
  if (typeof window === "undefined") return "inter";
  const stored = localStorage.getItem("notefast_font");
  if (stored && FONT_OPTIONS.some((f) => f.id === stored)) {
    return stored;
  }
  return "inter";
}

/**
 * Updates `--editor-font` CSS custom property and sets `data-font` attribute.
 */
export function applyFont(fontId: string): void {
  if (typeof window === "undefined") return;
  const font = FONT_OPTIONS.find((f) => f.id === fontId) || FONT_OPTIONS[0];
  document.documentElement.style.setProperty("--editor-font", font.family);
  document.documentElement.dataset.font = font.id;
}

/**
 * Stores font selection, injects font family CSS property, and broadcasts change.
 */
export function setStoredFont(fontId: string): void {
  if (typeof window === "undefined") return;
  const font = FONT_OPTIONS.find((f) => f.id === fontId) || FONT_OPTIONS[0];
  localStorage.setItem("notefast_font", font.id);
  applyFont(font.id);
  broadcastSync({ type: "font", value: font.id });
  window.dispatchEvent(new CustomEvent("notefast_font_changed", { detail: { fontId: font.id } }));
}

/**
 * Initializes theme on application mount:
 * - Hydrates theme mode, accent color, and typography settings from localStorage.
 * - Listens for macOS system dark mode preference changes (`prefers-color-scheme`)
 *   when in 'system' mode to dynamically switch themes without reload.
 */
export function initTheme(): void {
  if (typeof window === "undefined") return;

  applyThemeMode(getStoredThemeMode());
  applyAccent(getStoredAccent());
  applyFont(getStoredFont());

  try {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", () => {
      if (getStoredThemeMode() === "system") {
        applyThemeMode("system");
      }
    });
  } catch { }
}
