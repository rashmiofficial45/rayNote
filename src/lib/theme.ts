export type AccentColor = "violet" | "red";

export interface FontOption {
  id: string;
  name: string;
  family: string;
  category: "sans" | "mono" | "handwriting" | "system";
}

export const FONT_OPTIONS: FontOption[] = [
  { id: "comic", name: "Comic Shanns", family: "'Comic Shanns', cursive, sans-serif", category: "handwriting" },
  { id: "nunito", name: "Nunito", family: "'Nunito', sans-serif", category: "sans" },
  { id: "virgil", name: "Virgil", family: "'Virgil', cursive, sans-serif", category: "handwriting" },
  { id: "mono", name: "JetBrains Mono", family: "'JetBrains Mono', monospace", category: "mono" },
  { id: "inter", name: "Inter", family: "'Inter', sans-serif", category: "sans" },
  { id: "outfit", name: "Outfit", family: "'Outfit', sans-serif", category: "sans" },
];

export interface AccentOption {
  id: AccentColor;
  name: string;
  color: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: "violet", name: "Violet", color: "#6C5CE7" },
  { id: "red", name: "Raycast Red", color: "#FF5555" },
];

export function getStoredAccent(): AccentColor {
  if (typeof window === "undefined") return "violet";
  const stored = localStorage.getItem("notefast_accent_color");
  return stored === "red" ? "red" : "violet";
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
  setStoredAccent(getStoredAccent());
  setStoredFont(getStoredFont());
}
