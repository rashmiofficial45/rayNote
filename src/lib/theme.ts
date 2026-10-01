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

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("notefast_theme_mode") as ThemeMode | null;
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "dark";
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);

  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("light", !isDark);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.resolvedTheme = isDark ? "dark" : "light";
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export function setStoredThemeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("notefast_theme_mode", mode);
  applyThemeMode(mode);
  window.dispatchEvent(new CustomEvent("notefast_theme_changed", { detail: { mode } }));
}

export function getStoredAccent(): AccentColor {
  if (typeof window === "undefined") return "violet";
  const stored = localStorage.getItem("notefast_accent_color") as AccentColor | null;
  if (stored && ACCENT_OPTIONS.some((a) => a.id === stored)) {
    return stored;
  }
  return "violet";
}

export function setStoredAccent(accent: AccentColor): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("notefast_accent_color", accent);
  document.documentElement.dataset.accent = accent;
  window.dispatchEvent(new CustomEvent("notefast_accent_changed", { detail: { accent } }));
}

export function getStoredFont(): string {
  if (typeof window === "undefined") return "inter";
  const stored = localStorage.getItem("notefast_font");
  if (stored && FONT_OPTIONS.some((f) => f.id === stored)) {
    return stored;
  }
  return "inter";
}

export function setStoredFont(fontId: string): void {
  if (typeof window === "undefined") return;
  const font = FONT_OPTIONS.find((f) => f.id === fontId) || FONT_OPTIONS[0];
  localStorage.setItem("notefast_font", font.id);
  document.documentElement.style.setProperty("--editor-font", font.family);
  window.dispatchEvent(new CustomEvent("notefast_font_changed", { detail: { fontId: font.id } }));
}

export function initTheme(): void {
  if (typeof window === "undefined") return;

  applyThemeMode(getStoredThemeMode());
  setStoredAccent(getStoredAccent());
  setStoredFont(getStoredFont());

  try {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", () => {
      if (getStoredThemeMode() === "system") {
        applyThemeMode("system");
      }
    });
  } catch {}
}
