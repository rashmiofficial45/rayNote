// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  DEFAULT_COMMANDS,
  getStoredCommandsConfig,
  saveCommandsConfig,
  getCommandHotkey,
  detectShortcutConflict,
  CommandRow,
} from "../commandsConfig";
import { matchesEvent } from "../settingsSync";

describe("Dynamic Keyboard Shortcut Synchronization", () => {
  let store: Record<string, string> = {};

  beforeAll(() => {
    (globalThis as any).window = globalThis;
    (globalThis as any).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  });

  beforeEach(() => {
    store = {};
  });

  describe("Default formatting and editing command definitions", () => {
    it("includes all required formatting and editing commands in DEFAULT_COMMANDS", () => {
      const ids = DEFAULT_COMMANDS.map((c) => c.id);
      expect(ids).toContain("bold");
      expect(ids).toContain("italic");
      expect(ids).toContain("underline");
      expect(ids).toContain("strike");
      expect(ids).toContain("code");
      expect(ids).toContain("highlight");
      expect(ids).toContain("blockquote");
      expect(ids).toContain("heading1");
      expect(ids).toContain("heading2");
      expect(ids).toContain("heading3");
      expect(ids).toContain("bullet_list");
      expect(ids).toContain("ordered_list");
      expect(ids).toContain("checklist");
      expect(ids).toContain("code_block");
      expect(ids).toContain("divider");
      expect(ids).toContain("undo");
      expect(ids).toContain("redo");
      expect(ids).toContain("cut");
      expect(ids).toContain("copy");
      expect(ids).toContain("paste");
    });

    it("has correct default hotkeys for formatting", () => {
      const config = getStoredCommandsConfig();
      expect(getCommandHotkey(config, "bold").hotkey).toBe("⌘B");
      expect(getCommandHotkey(config, "italic").hotkey).toBe("⌘I");
      expect(getCommandHotkey(config, "underline").hotkey).toBe("⌘U");
      expect(getCommandHotkey(config, "heading1").hotkey).toBe("⌘⌥1");
      expect(getCommandHotkey(config, "bullet_list").hotkey).toBe("⇧⌘8");
      expect(getCommandHotkey(config, "ordered_list").hotkey).toBe("⇧⌘7");
      expect(getCommandHotkey(config, "undo").hotkey).toBe("⌘Z");
      expect(getCommandHotkey(config, "redo").hotkey).toBe("⇧⌘Z");
    });

    it("normalizes prefixed command ids seamlessly", () => {
      const config = getStoredCommandsConfig();
      expect(getCommandHotkey(config, "editor.bold").hotkey).toBe("⌘B");
      expect(getCommandHotkey(config, "editor.italic").hotkey).toBe("⌘I");
      expect(getCommandHotkey(config, "editor.bullet_list").hotkey).toBe("⇧⌘8");
    });
  });

  describe("Dynamic re-binding and synchronization", () => {
    it("updates hotkey dynamically when user changes it in settings", () => {
      let config = getStoredCommandsConfig();
      const updated: CommandRow[] = config.map((c) =>
        c.id === "bold" ? { ...c, hotkey: "⇧⌘B" } : c
      );
      saveCommandsConfig(updated);

      const refreshed = getStoredCommandsConfig();
      const bold = getCommandHotkey(refreshed, "bold");
      expect(bold.hotkey).toBe("⇧⌘B");
      expect(bold.enabled).toBe(true);

      // Also accessible via normalized prefixed id
      expect(getCommandHotkey(refreshed, "editor.bold").hotkey).toBe("⇧⌘B");
    });

    it("disables command hotkey when toggled off", () => {
      let config = getStoredCommandsConfig();
      const updated: CommandRow[] = config.map((c) =>
        c.id === "bullet_list" ? { ...c, enabled: false } : c
      );
      saveCommandsConfig(updated);

      const refreshed = getStoredCommandsConfig();
      const bullet = getCommandHotkey(refreshed, "bullet_list");
      expect(bullet.enabled).toBe(false);
      expect(bullet.hotkey).toBe("⇧⌘8");
    });

    it("detects shortcut conflicts when assigning an in-use hotkey", () => {
      const config = getStoredCommandsConfig();
      // Trying to assign ⌘I (which is italic) to bold should conflict
      const conflict = detectShortcutConflict("⌘I", "bold", config);
      expect(conflict).not.toBeNull();
      expect(conflict?.id).toBe("italic");

      // Assigning the same hotkey to itself should NOT conflict
      const selfConflict = detectShortcutConflict("⌘B", "bold", config);
      expect(selfConflict).toBeNull();

      // Free hotkey should NOT conflict
      const freeConflict = detectShortcutConflict("⌘⌥⇧J", "bold", config);
      expect(freeConflict).toBeNull();
    });
  });

  describe("matchesEvent keyboard matching logic", () => {
    it("matches standard Cmd modifier events", () => {
      const eventB = new KeyboardEvent("keydown", { key: "b", metaKey: true });
      expect(matchesEvent(eventB, "⌘B")).toBe(true);
      expect(matchesEvent(eventB, "⌘I")).toBe(false);
      expect(matchesEvent(eventB, "⇧⌘B")).toBe(false);
    });

    it("matches Shift+Cmd modifier events", () => {
      const eventShiftCmd8 = new KeyboardEvent("keydown", { key: "8", metaKey: true, shiftKey: true });
      expect(matchesEvent(eventShiftCmd8, "⇧⌘8")).toBe(true);
      expect(matchesEvent(eventShiftCmd8, "⌘8")).toBe(false);
    });

    it("matches Option+Cmd modifier events", () => {
      const eventCmdOpt1 = new KeyboardEvent("keydown", { key: "1", metaKey: true, altKey: true });
      expect(matchesEvent(eventCmdOpt1, "⌘⌥1")).toBe(true);
      expect(matchesEvent(eventCmdOpt1, "⌘1")).toBe(false);
    });

    it("matches rebound shortcut and rejects old shortcut", () => {
      const oldEvent = new KeyboardEvent("keydown", { key: "b", metaKey: true });
      const newEvent = new KeyboardEvent("keydown", { key: "b", metaKey: true, shiftKey: true });

      // After user rebinding to ⇧⌘B:
      const reboundHotkey = "⇧⌘B";
      expect(matchesEvent(newEvent, reboundHotkey)).toBe(true);
      expect(matchesEvent(oldEvent, reboundHotkey)).toBe(false);
    });
  });
});
