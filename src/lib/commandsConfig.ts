/**
 * commandsConfig.ts - Centralized Command & Shortcut Configuration Engine
 *
 * Responsibilities:
 * - Default command definitions with categories, labels, and standard macOS hotkeys.
 * - Dynamic retrieval and caching of user-customized hotkey overrides from localStorage.
 * - Multi-window synchronization support so shortcut customizations auto-reflect
 *   across all windows, dialogs, command palettes, and tooltips.
 */

export interface CommandRow {
  id: string;
  title: string;
  hotkey: string;
  enabled: boolean;
  category: "commands" | "extensions";
}

export const DEFAULT_COMMANDS: CommandRow[] = [
  { id: "create", title: "Create Note", hotkey: "⌘N", enabled: true, category: "commands" },
  { id: "browse", title: "Search & Navigate Notes", hotkey: "⌘P", enabled: true, category: "commands" },
  { id: "search", title: "Command Palette", hotkey: "⌘K", enabled: true, category: "commands" },
  { id: "find", title: "Find in Note", hotkey: "⌘F", enabled: true, category: "commands" },
  { id: "duplicate", title: "Duplicate Note", hotkey: "⌘D", enabled: true, category: "commands" },
  { id: "pin", title: "Pin / Unpin Note", hotkey: "⇧⌘P", enabled: true, category: "commands" },
  { id: "delete", title: "Delete Note", hotkey: "⇧⌘⌫", enabled: true, category: "commands" },
  { id: "next_note", title: "Next Note in List", hotkey: "⌥↓", enabled: true, category: "commands" },
  { id: "prev_note", title: "Previous Note in List", hotkey: "⌥↑", enabled: true, category: "commands" },
  { id: "history_back", title: "Go Back in History", hotkey: "⌘[", enabled: true, category: "commands" },
  { id: "history_forward", title: "Go Forward in History", hotkey: "⌘]", enabled: true, category: "commands" },
  { id: "copy_markdown", title: "Copy Note as Markdown", hotkey: "⇧⌘C", enabled: true, category: "commands" },
  { id: "copy_deeplink", title: "Copy Deeplink", hotkey: "⇧⌘D", enabled: true, category: "commands" },
  { id: "export_note", title: "Export Note", hotkey: "⇧⌘E", enabled: true, category: "commands" },
  { id: "zoom_in", title: "Zoom In", hotkey: "⌘=", enabled: true, category: "commands" },
  { id: "zoom_out", title: "Zoom Out", hotkey: "⌘-", enabled: true, category: "commands" },
  { id: "reset_zoom", title: "Reset Zoom", hotkey: "⌘0", enabled: true, category: "commands" },
  { id: "shortcuts_help", title: "Shortcuts Cheatsheet", hotkey: "⌘/", enabled: true, category: "commands" },
  { id: "settings", title: "Open Settings", hotkey: "⌘,", enabled: true, category: "commands" },
  { id: "hide", title: "Hide Window", hotkey: "⌘W", enabled: true, category: "commands" },
  { id: "quit", title: "Quit rayNote", hotkey: "⌘Q", enabled: true, category: "commands" },
  { id: "toggle", title: "rayNote (Toggle Notes)", hotkey: "⌘⇧Space", enabled: true, category: "commands" },
  { id: "slash", title: "Slash Commands Menu", hotkey: "/", enabled: true, category: "extensions" },
  { id: "tables", title: "Tables & Embeds", hotkey: "/table & /video", enabled: true, category: "extensions" },
];

/**
 * Retrieves the current commands configuration from localStorage, falling back to defaults.
 */
export function getStoredCommandsConfig(): CommandRow[] {
  if (typeof window === "undefined") return DEFAULT_COMMANDS;
  const saved = localStorage.getItem("notefast_commands_config");
  if (!saved) return DEFAULT_COMMANDS;
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return DEFAULT_COMMANDS;
    return DEFAULT_COMMANDS.map((def) => {
      const found = parsed.find((p: any) => p && p.id === def.id);
      return found ? { ...def, ...found } : def;
    });
  } catch {
    return DEFAULT_COMMANDS;
  }
}

/**
 * Gets the active hotkey and enabled state for a specific command ID.
 */
export function getCommandHotkey(
  commands: CommandRow[] | undefined,
  id: string,
  defaultHotkey: string
): { enabled: boolean; hotkey: string } {
  const list = commands && commands.length > 0 ? commands : getStoredCommandsConfig();
  const found = list.find((c) => c.id === id);
  if (!found) {
    return { enabled: true, hotkey: defaultHotkey };
  }
  return {
    enabled: found.enabled !== false,
    hotkey: found.hotkey || defaultHotkey,
  };
}

/**
 * Converts a hotkey string (like "⇧⌘C" or "⌥↓" or "⌘K") into an array of separate badge symbols.
 */
export function splitHotkeyToKeys(hotkey: string): string[] {
  if (!hotkey) return [];
  const parts: string[] = [];
  let remaining = hotkey;

  // Extract modifiers in canonical order
  const modifiers = ["⌃", "⌥", "⇧", "⌘"];
  for (const mod of modifiers) {
    if (remaining.includes(mod)) {
      parts.push(mod);
      remaining = remaining.replace(mod, "");
    }
  }

  remaining = remaining.trim();
  if (remaining) {
    parts.push(remaining);
  }

  return parts.length > 0 ? parts : [hotkey];
}
