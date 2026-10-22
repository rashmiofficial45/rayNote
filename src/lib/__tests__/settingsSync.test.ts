// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  parseHotkey,
  matchesEvent,
  formatKeystrokeFromEvent,
  broadcastSync,
  listenToSettingsSync,
} from "../settingsSync";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("Settings Synchronization & Keystroke Utilities (settingsSync.ts)", () => {
  describe("Hotkey Parsing (parseHotkey)", () => {
    it("returns null for empty strings", () => {
      expect(parseHotkey("")).toBeNull();
    });

    it("parses single key without modifiers", () => {
      const parsed = parseHotkey("k");
      expect(parsed).toEqual({ ctrl: false, alt: false, shift: false, meta: false, key: "k" });
    });

    it("parses macOS modifiers: ⌘, ⌥, ⇧, ⌃", () => {
      expect(parseHotkey("⌘K")).toEqual({ ctrl: false, alt: false, shift: false, meta: true, key: "k" });
      expect(parseHotkey("⌥D")).toEqual({ ctrl: false, alt: true, shift: false, meta: false, key: "d" });
      expect(parseHotkey("⇧⌘P")).toEqual({ ctrl: false, alt: false, shift: true, meta: true, key: "p" });
      expect(parseHotkey("⌃⌥Space")).toEqual({ ctrl: true, alt: true, shift: false, meta: false, key: " " });
    });

    it("normalizes special key symbols (backspace, enter, esc, arrows)", () => {
      expect(parseHotkey("⌘⌫")?.key).toBe("backspace");
      expect(parseHotkey("↵")?.key).toBe("enter");
      expect(parseHotkey("Esc")?.key).toBe("escape");
      expect(parseHotkey("↑")?.key).toBe("arrowup");
      expect(parseHotkey("↓")?.key).toBe("arrowdown");
      expect(parseHotkey("←")?.key).toBe("arrowleft");
      expect(parseHotkey("→")?.key).toBe("arrowright");
    });
  });

  describe("Hotkey Event Matching (matchesEvent)", () => {
    it("matches exact keystroke with Cmd modifier", () => {
      const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
      expect(matchesEvent(event, "⌘K")).toBe(true);
      expect(matchesEvent(event, "⌥K")).toBe(false);
    });

    it("matches Option keystroke (e.g. dictation ⌥D)", () => {
      const event = new KeyboardEvent("keydown", { key: "d", altKey: true });
      expect(matchesEvent(event, "⌥D")).toBe(true);
    });

    it("matches code keys when Alt key mutates character on macOS", () => {
      // On macOS, Alt+D might produce 'î' or Alt+P produce 'π'
      const event = new KeyboardEvent("keydown", { key: "î", code: "KeyD", altKey: true });
      expect(matchesEvent(event, "⌥D")).toBe(true);
    });

    it("returns false when modifiers or keys do not match", () => {
      const event = new KeyboardEvent("keydown", { key: "j", metaKey: true });
      expect(matchesEvent(event, "⌘K")).toBe(false);
    });
  });

  describe("Keystroke Formatting (formatKeystrokeFromEvent)", () => {
    it("identifies modifier-only key events", () => {
      const metaEvt = new KeyboardEvent("keydown", { key: "Meta", metaKey: true });
      expect(formatKeystrokeFromEvent(metaEvt)).toEqual({ isModifierOnly: true, result: "⌘" });

      const altEvt = new KeyboardEvent("keydown", { key: "Alt", altKey: true });
      expect(formatKeystrokeFromEvent(altEvt)).toEqual({ isModifierOnly: true, result: "⌥" });
    });

    it("formats combinations with standard and special keys", () => {
      const evt = new KeyboardEvent("keydown", { key: "k", metaKey: true });
      expect(formatKeystrokeFromEvent(evt)).toEqual({ isModifierOnly: false, result: "⌘K" });

      const backspaceEvt = new KeyboardEvent("keydown", { key: "Backspace", metaKey: true });
      expect(formatKeystrokeFromEvent(backspaceEvt)).toEqual({ isModifierOnly: false, result: "⌘⌫" });

      const enterEvt = new KeyboardEvent("keydown", { key: "Enter" });
      expect(formatKeystrokeFromEvent(enterEvt)).toEqual({ isModifierOnly: false, result: "↵" });

      const escEvt = new KeyboardEvent("keydown", { key: "Escape" });
      expect(formatKeystrokeFromEvent(escEvt)).toEqual({ isModifierOnly: false, result: "Esc" });
    });
  });

  describe("Settings Sync Channel", () => {
    it("broadcastSync dispatches local DOM CustomEvent", () => {
      const listener = vi.fn();
      window.addEventListener("notefast_sync_event", listener);

      broadcastSync({ type: "theme_mode", value: "light" });

      expect(listener).toHaveBeenCalled();
      const detail = listener.mock.calls[0][0].detail;
      expect(detail).toEqual({ type: "theme_mode", value: "light" });

      window.removeEventListener("notefast_sync_event", listener);
    });

    it("listenToSettingsSync invokes callbacks on sync events and unlistens cleanly", () => {
      const onThemeModeChange = vi.fn();
      const onAccentChange = vi.fn();

      const unsubscribe = listenToSettingsSync({
        onThemeModeChange,
        onAccentChange,
      });

      broadcastSync({ type: "theme_mode", value: "light" });
      expect(onThemeModeChange).toHaveBeenCalledWith("light");

      broadcastSync({ type: "accent", value: "emerald" });
      expect(onAccentChange).toHaveBeenCalledWith("emerald");

      // Unlisten cleanly
      unsubscribe();
      onThemeModeChange.mockClear();

      broadcastSync({ type: "theme_mode", value: "dark" });
      expect(onThemeModeChange).not.toHaveBeenCalled();
    });
  });
});
