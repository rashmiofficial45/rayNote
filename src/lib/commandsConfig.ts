import { useState, useEffect } from "react";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "./storage";
import { listenToSettingsSync } from "./settingsSync";

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
  category: "commands" | "extensions" | "formatting" | "editing";
}

export const DEFAULT_COMMANDS: CommandRow[] = [
  // App & Window Commands
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

  // Text Formatting
  { id: "bold", title: "Bold", hotkey: "⌘B", enabled: true, category: "formatting" },
  { id: "italic", title: "Italic", hotkey: "⌘I", enabled: true, category: "formatting" },
  { id: "underline", title: "Underline", hotkey: "⌘U", enabled: true, category: "formatting" },
  { id: "strike", title: "Strikethrough", hotkey: "⇧⌘X", enabled: true, category: "formatting" },
  { id: "code", title: "Inline Code", hotkey: "⌘E", enabled: true, category: "formatting" },
  { id: "highlight", title: "Highlight", hotkey: "⇧⌘H", enabled: true, category: "formatting" },
  { id: "blockquote", title: "Blockquote / Quote", hotkey: "⇧⌘B", enabled: true, category: "formatting" },
  { id: "heading1", title: "Heading 1", hotkey: "⌘⌥1", enabled: true, category: "formatting" },
  { id: "heading2", title: "Heading 2", hotkey: "⌘⌥2", enabled: true, category: "formatting" },
  { id: "heading3", title: "Heading 3", hotkey: "⌘⌥3", enabled: true, category: "formatting" },
  { id: "bullet_list", title: "Bullet List", hotkey: "⇧⌘8", enabled: true, category: "formatting" },
  { id: "ordered_list", title: "Numbered List", hotkey: "⇧⌘7", enabled: true, category: "formatting" },
  { id: "checklist", title: "Checklist / Task List", hotkey: "⇧⌘9", enabled: true, category: "formatting" },
  { id: "code_block", title: "Code Block", hotkey: "⌘⌥C", enabled: true, category: "formatting" },
  { id: "divider", title: "Divider", hotkey: "---", enabled: true, category: "formatting" },

  // Document Editing
  { id: "undo", title: "Undo", hotkey: "⌘Z", enabled: true, category: "editing" },
  { id: "redo", title: "Redo", hotkey: "⇧⌘Z", enabled: true, category: "editing" },
  { id: "cut", title: "Cut", hotkey: "⌘X", enabled: true, category: "editing" },
  { id: "copy", title: "Copy", hotkey: "⌘C", enabled: true, category: "editing" },
  { id: "paste", title: "Paste", hotkey: "⌘V", enabled: true, category: "editing" },
  { id: "select_all", title: "Select All", hotkey: "⌘A", enabled: true, category: "editing" },

  // Extensions
  { id: "slash", title: "Slash Commands Menu", hotkey: "/", enabled: true, category: "extensions" },
  { id: "tables", title: "Tables & Embeds", hotkey: "/table & /video", enabled: true, category: "extensions" },
];

/**
 * Retrieves the current commands configuration from localStorage, falling back to defaults.
 */
export function getStoredCommandsConfig(): CommandRow[] {
  if (typeof window === "undefined") return DEFAULT_COMMANDS;
  const saved = safeLocalStorageGetItem("notefast_commands_config");
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

export function saveCommandsConfig(commands: CommandRow[]): void {
  safeLocalStorageSetItem("notefast_commands_config", JSON.stringify(commands));
}

/**
 * Helper to match command IDs flexibly (e.g. "bold", "editor.bold", "bulletList", "bullet_list")
 */
function normalizeId(id: string): string {
  return id
    .replace(/^editor\./, "")
    .replace(/List$/, "_list")
    .replace(/Block$/, "_block")
    .replace(/Heading/, "heading")
    .toLowerCase();
}

/**
 * Gets the active hotkey and enabled state for a specific command ID.
 */
export function getCommandHotkey(
  commands: CommandRow[] | undefined,
  id: string,
  defaultHotkey = ""
): { enabled: boolean; hotkey: string } {
  const list = commands && commands.length > 0 ? commands : getStoredCommandsConfig();
  const targetId = normalizeId(id);
  const found = list.find((c) => c.id === id || normalizeId(c.id) === targetId);
  if (!found) {
    return { enabled: true, hotkey: defaultHotkey };
  }
  return {
    enabled: found.enabled !== false,
    hotkey: found.hotkey || defaultHotkey,
  };
}

/**
 * Gets the shortcut string directly for a command ID.
 */
export function getCommandShortcut(id: string, defaultHotkey = ""): string {
  const { hotkey, enabled } = getCommandHotkey(undefined, id, defaultHotkey);
  return enabled ? hotkey : "";
}

/**
 * Checks if a requested shortcut conflicts with another already assigned command.
 */
export function detectShortcutConflict(
  newHotkey: string,
  commandId: string,
  commands?: CommandRow[]
): CommandRow | null {
  if (!newHotkey || newHotkey.trim() === "") return null;
  const list = commands && commands.length > 0 ? commands : getStoredCommandsConfig();
  const normalizedNew = newHotkey.trim().toUpperCase();
  const targetId = normalizeId(commandId);

  for (const cmd of list) {
    if (cmd.id === commandId || normalizeId(cmd.id) === targetId) continue;
    if (cmd.enabled === false) continue;
    if (cmd.hotkey && cmd.hotkey.trim().toUpperCase() === normalizedNew) {
      return cmd;
    }
  }
  return null;
}

/**
 * React hook that subscribes to commandsConfig updates across all windows & components.
 */
export function useCommandsConfig(): CommandRow[] {
  const [config, setConfig] = useState<CommandRow[]>(getStoredCommandsConfig);

  useEffect(() => {
    return listenToSettingsSync({
      onCommandsConfigChange: (newConfig) => {
        if (newConfig && Array.isArray(newConfig)) {
          setConfig(newConfig);
        }
      },
    });
  }, []);

  return config;
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
