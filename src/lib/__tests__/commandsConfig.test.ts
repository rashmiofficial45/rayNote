import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  DEFAULT_COMMANDS,
  getStoredCommandsConfig,
  getCommandHotkey,
  splitHotkeyToKeys,
} from "../commandsConfig";

describe("commandsConfig", () => {
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

  it("returns default commands when nothing is stored", () => {
    const config = getStoredCommandsConfig();
    expect(config).toEqual(DEFAULT_COMMANDS);
  });

  it("splits various macOS hotkey strings into badge keys correctly", () => {
    expect(splitHotkeyToKeys("⌘N")).toEqual(["⌘", "N"]);
    expect(splitHotkeyToKeys("⌘K")).toEqual(["⌘", "K"]);
    expect(splitHotkeyToKeys("⌘P")).toEqual(["⌘", "P"]);
    expect(splitHotkeyToKeys("⇧⌘C")).toEqual(["⇧", "⌘", "C"]);
    expect(splitHotkeyToKeys("⇧⌘⌫")).toEqual(["⇧", "⌘", "⌫"]);
    expect(splitHotkeyToKeys("⌥↓")).toEqual(["⌥", "↓"]);
    expect(splitHotkeyToKeys("⌘=")).toEqual(["⌘", "="]);
    expect(splitHotkeyToKeys("")).toEqual([]);
  });

  it("merges user customized shortcuts from localStorage", () => {
    const custom = [
      { id: "browse", title: "Search & Navigate Notes", hotkey: "⌘O", enabled: true, category: "commands" },
      { id: "delete", title: "Delete Note", hotkey: "⇧⌘D", enabled: false, category: "commands" },
    ];
    localStorage.setItem("notefast_commands_config", JSON.stringify(custom));

    const config = getStoredCommandsConfig();
    const browse = getCommandHotkey(config, "browse", "⌘P");
    expect(browse.enabled).toBe(true);
    expect(browse.hotkey).toBe("⌘O");

    const del = getCommandHotkey(config, "delete", "⇧⌘⌫");
    expect(del.enabled).toBe(false);
    expect(del.hotkey).toBe("⇧⌘D");

    // Default remains unchanged for uncustomized commands
    const create = getCommandHotkey(config, "create", "⌘N");
    expect(create.enabled).toBe(true);
    expect(create.hotkey).toBe("⌘N");
  });
});
