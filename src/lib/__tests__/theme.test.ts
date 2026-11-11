// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getStoredThemeMode,
  setStoredThemeMode,
  applyThemeMode,
  getStoredAccent,
  setStoredAccent,
  applyAccent,
  getStoredFont,
  setStoredFont,
  applyFont,
  getStoredTextOpacity,
  setStoredTextOpacity,
  applyTextOpacity,
  DEFAULT_TEXT_OPACITY,
  MIN_TEXT_OPACITY,
  MAX_TEXT_OPACITY,
  initTheme,
  FONT_OPTIONS,
  ACCENT_OPTIONS,
  THEME_OPTIONS,
} from "../theme";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("Theme Engine (theme.ts)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-mode");
    document.documentElement.removeAttribute("data-resolved-theme");
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("data-font");
    document.documentElement.style.cssText = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Options Configuration", () => {
    it("exports 6 curated typography font options", () => {
      expect(FONT_OPTIONS.length).toBe(6);
      expect(FONT_OPTIONS.map((f) => f.id)).toEqual([
        "comic",
        "nunito",
        "virgil",
        "mono",
        "inter",
        "outfit",
      ]);
    });

    it("exports 6 liquid glass accent palettes", () => {
      expect(ACCENT_OPTIONS.length).toBe(6);
      expect(ACCENT_OPTIONS.map((a) => a.id)).toEqual([
        "violet",
        "red",
        "emerald",
        "ocean",
        "amber",
        "rose",
      ]);
    });

    it("exports dark, light, and system theme options", () => {
      expect(THEME_OPTIONS.map((t) => t.id)).toEqual(["dark", "light", "system"]);
    });
  });

  describe("Theme Mode Management", () => {
    it("getStoredThemeMode defaults to 'dark' when unset", () => {
      expect(getStoredThemeMode()).toBe("dark");
    });

    it("getStoredThemeMode retrieves valid saved theme modes", () => {
      localStorage.setItem("notefast_theme_mode", "light");
      expect(getStoredThemeMode()).toBe("light");

      localStorage.setItem("notefast_theme_mode", "system");
      expect(getStoredThemeMode()).toBe("system");

      localStorage.setItem("notefast_theme_mode", "dark");
      expect(getStoredThemeMode()).toBe("dark");
    });

    it("getStoredThemeMode falls back to 'dark' when invalid value is in localStorage", () => {
      localStorage.setItem("notefast_theme_mode", "neon_rainbow");
      expect(getStoredThemeMode()).toBe("dark");
    });

    it("applyThemeMode correctly updates DOM for 'dark' mode", () => {
      applyThemeMode("dark");

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.classList.contains("light")).toBe(false);
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.documentElement.dataset.themeMode).toBe("dark");
      expect(document.documentElement.dataset.resolvedTheme).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("applyThemeMode correctly updates DOM for 'light' mode", () => {
      applyThemeMode("light");

      expect(document.documentElement.classList.contains("light")).toBe(true);
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.documentElement.dataset.themeMode).toBe("light");
      expect(document.documentElement.dataset.resolvedTheme).toBe("light");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("applyThemeMode resolves 'system' according to prefers-color-scheme media query", () => {
      // Mock matchMedia returning prefers-color-scheme: dark = false
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: query.includes("dark") ? false : true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      applyThemeMode("system");
      expect(document.documentElement.dataset.resolvedTheme).toBe("light");
      expect(document.documentElement.classList.contains("light")).toBe(true);

      // Mock matchMedia returning prefers-color-scheme: dark = true
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: query.includes("dark") ? true : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      applyThemeMode("system");
      expect(document.documentElement.dataset.resolvedTheme).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("setStoredThemeMode persists, applies, and dispatches notefast_theme_changed event", () => {
      const listener = vi.fn();
      window.addEventListener("notefast_theme_changed", listener);

      setStoredThemeMode("light");

      expect(localStorage.getItem("notefast_theme_mode")).toBe("light");
      expect(document.documentElement.dataset.themeMode).toBe("light");
      expect(listener).toHaveBeenCalled();
      const eventDetail = listener.mock.calls[0][0].detail;
      expect(eventDetail).toEqual({ mode: "light" });

      window.removeEventListener("notefast_theme_changed", listener);
    });
  });

  describe("Accent Color Management", () => {
    it("getStoredAccent defaults to 'violet'", () => {
      expect(getStoredAccent()).toBe("violet");
    });

    it("getStoredAccent returns valid saved accents and ignores invalid strings", () => {
      localStorage.setItem("notefast_accent_color", "emerald");
      expect(getStoredAccent()).toBe("emerald");

      localStorage.setItem("notefast_accent_color", "invalid_accent");
      expect(getStoredAccent()).toBe("violet");
    });

    it("applyAccent updates dataset.accent on root element", () => {
      applyAccent("ocean");
      expect(document.documentElement.dataset.accent).toBe("ocean");
    });

    it("setStoredAccent persists and dispatches notefast_accent_changed event", () => {
      const listener = vi.fn();
      window.addEventListener("notefast_accent_changed", listener);

      setStoredAccent("amber");
      expect(localStorage.getItem("notefast_accent_color")).toBe("amber");
      expect(document.documentElement.dataset.accent).toBe("amber");
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].detail).toEqual({ accent: "amber" });

      window.removeEventListener("notefast_accent_changed", listener);
    });
  });

  describe("Font Typography Engine", () => {
    it("getStoredFont defaults to 'inter'", () => {
      expect(getStoredFont()).toBe("inter");
    });

    it("getStoredFont returns valid font and ignores unknown fonts", () => {
      localStorage.setItem("notefast_font", "mono");
      expect(getStoredFont()).toBe("mono");

      localStorage.setItem("notefast_font", "papyrus_unknown");
      expect(getStoredFont()).toBe("inter");
    });

    it("applyFont sets dataset.font and --editor-font CSS variable", () => {
      applyFont("mono");
      expect(document.documentElement.dataset.font).toBe("mono");
      expect(document.documentElement.style.getPropertyValue("--editor-font")).toContain("JetBrains Mono");
    });

    it("setStoredFont persists to storage and dispatches notefast_font_changed", () => {
      const listener = vi.fn();
      window.addEventListener("notefast_font_changed", listener);

      setStoredFont("virgil");
      expect(localStorage.getItem("notefast_font")).toBe("virgil");
      expect(document.documentElement.dataset.font).toBe("virgil");
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].detail).toEqual({ fontId: "virgil" });

      window.removeEventListener("notefast_font_changed", listener);
    });
  });

  describe("Text Opacity Management", () => {
    it("getStoredTextOpacity defaults to DEFAULT_TEXT_OPACITY (100) when unset", () => {
      expect(getStoredTextOpacity()).toBe(DEFAULT_TEXT_OPACITY);
      expect(DEFAULT_TEXT_OPACITY).toBe(100);
      expect(MIN_TEXT_OPACITY).toBe(50);
      expect(MAX_TEXT_OPACITY).toBe(100);
    });

    it("getStoredTextOpacity reads valid stored opacity values", () => {
      localStorage.setItem("notefast_text_opacity", "85");
      expect(getStoredTextOpacity()).toBe(85);

      localStorage.setItem("notefast_text_opacity", "50");
      expect(getStoredTextOpacity()).toBe(50);

      localStorage.setItem("notefast_text_opacity", "100");
      expect(getStoredTextOpacity()).toBe(100);
    });

    it("getStoredTextOpacity falls back to default if stored value is invalid or out of bounds", () => {
      localStorage.setItem("notefast_text_opacity", "invalid");
      expect(getStoredTextOpacity()).toBe(100);

      localStorage.setItem("notefast_text_opacity", "20"); // below min (50)
      expect(getStoredTextOpacity()).toBe(100);

      localStorage.setItem("notefast_text_opacity", "150"); // above max (100)
      expect(getStoredTextOpacity()).toBe(100);
    });

    it("applyTextOpacity sets --app-text-opacity CSS variable and dataset attribute", () => {
      applyTextOpacity(80);
      expect(document.documentElement.style.getPropertyValue("--app-text-opacity")).toBe("80%");
      expect(document.documentElement.dataset.textOpacity).toBe("80");
    });

    it("applyTextOpacity clamps values outside [50, 100]", () => {
      applyTextOpacity(30);
      expect(document.documentElement.style.getPropertyValue("--app-text-opacity")).toBe("50%");
      expect(document.documentElement.dataset.textOpacity).toBe("50");

      applyTextOpacity(120);
      expect(document.documentElement.style.getPropertyValue("--app-text-opacity")).toBe("100%");
      expect(document.documentElement.dataset.textOpacity).toBe("100");
    });

    it("setStoredTextOpacity persists, applies CSS, and dispatches notefast_text_opacity_changed", () => {
      const listener = vi.fn();
      window.addEventListener("notefast_text_opacity_changed", listener);

      setStoredTextOpacity(75);
      expect(localStorage.getItem("notefast_text_opacity")).toBe("75");
      expect(document.documentElement.style.getPropertyValue("--app-text-opacity")).toBe("75%");
      expect(document.documentElement.dataset.textOpacity).toBe("75");
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].detail).toEqual({ opacity: 75 });

      window.removeEventListener("notefast_text_opacity_changed", listener);
    });
  });

  describe("Application Initialization (initTheme)", () => {
    it("hydrates all visual preferences and attaches system media query listener", () => {
      localStorage.setItem("notefast_theme_mode", "light");
      localStorage.setItem("notefast_accent_color", "rose");
      localStorage.setItem("notefast_font", "outfit");
      localStorage.setItem("notefast_text_opacity", "85");

      initTheme();

      expect(document.documentElement.dataset.themeMode).toBe("light");
      expect(document.documentElement.dataset.accent).toBe("rose");
      expect(document.documentElement.dataset.font).toBe("outfit");
      expect(document.documentElement.style.getPropertyValue("--editor-font")).toContain("Outfit");
      expect(document.documentElement.style.getPropertyValue("--app-text-opacity")).toBe("85%");
      expect(document.documentElement.dataset.textOpacity).toBe("85");
    });
  });
});
