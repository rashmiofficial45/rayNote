/**
 * Command Palette Aliases Management
 * Allows assigning custom shorthand alias triggers (e.g., 'imp', 'md', 'exp') to any command.
 */

export interface PaletteCommandDef {
  id: string;
  label: string;
  category: string;
  shortcut?: string[];
  defaultAlias?: string;
}

export const ALL_PALETTE_COMMANDS: PaletteCommandDef[] = [
  // ─── File Operations ───
  { id: "upload-md-file", label: "Import Markdown File", category: "File Operations", defaultAlias: "import" },
  { id: "view-md-file-no-upload", label: "Quick View Markdown File", category: "File Operations", defaultAlias: "preview" },
  { id: "copy-md", label: "Copy Note as Markdown", category: "File Operations", shortcut: ["⇧", "⌘", "C"], defaultAlias: "copymd" },
  { id: "copy-txt", label: "Copy Note as Plain Text", category: "File Operations", defaultAlias: "copytxt" },
  { id: "copy-deeplink", label: "Copy Note Deeplink", category: "File Operations", shortcut: ["⇧", "⌘", "D"], defaultAlias: "link" },
  { id: "export-single", label: "Export Note as Markdown", category: "File Operations", shortcut: ["⇧", "⌘", "E"], defaultAlias: "export" },
  { id: "export-all", label: "Export All Notes", category: "File Operations", defaultAlias: "exportall" },

  // ─── Note Actions ───
  { id: "new-note", label: "New Note", category: "Note Actions", shortcut: ["⌘", "N"], defaultAlias: "new" },
  { id: "browse-notes", label: "Browse / Switch Notes", category: "Note Actions", shortcut: ["⌘", "P"], defaultAlias: "browse" },
  { id: "find-in-note", label: "Find in Current Note", category: "Note Actions", shortcut: ["⌘", "F"], defaultAlias: "find" },
  { id: "duplicate-note", label: "Duplicate Note", category: "Note Actions", shortcut: ["⌘", "D"], defaultAlias: "dup" },
  { id: "pin-note", label: "Pin / Unpin Note", category: "Note Actions", shortcut: ["⇧", "⌘", "P"], defaultAlias: "pin" },
  { id: "delete-note", label: "Delete Note", category: "Note Actions", shortcut: ["⇧", "⌘", "⌫"], defaultAlias: "del" },
  { id: "prev-note", label: "Previous Note in List", category: "Note Actions", shortcut: ["⌥", "↑"], defaultAlias: "prev" },
  { id: "next-note", label: "Next Note in List", category: "Note Actions", shortcut: ["⌥", "↓"], defaultAlias: "next" },
  { id: "history-back", label: "Go Back in History", category: "Note Actions", shortcut: ["⌘", "["], defaultAlias: "back" },
  { id: "history-forward", label: "Go Forward in History", category: "Note Actions", shortcut: ["⌘", "]"], defaultAlias: "forward" },

  // ─── Settings: Appearance & Zoom ───
  { id: "sub-appearance-picker", label: "Appearance Mode (Dark / Light / System)", category: "Appearance", defaultAlias: "theme" },
  { id: "sub-theme-picker", label: "Accent Theme Color", category: "Appearance", defaultAlias: "accent" },
  { id: "sub-font-picker", label: "Editor Font Family", category: "Appearance", defaultAlias: "font" },
  { id: "sub-zoom-picker", label: "Zoom Level Options", category: "Appearance", defaultAlias: "zoom" },
  { id: "zoom-in-step", label: "Zoom In (+10%)", category: "Appearance", shortcut: ["⌘", "="] },
  { id: "zoom-out-step", label: "Zoom Out (-10%)", category: "Appearance", shortcut: ["⌘", "-"] },
  { id: "zoom-reset-step", label: "Reset Zoom (120%)", category: "Appearance", shortcut: ["⌘", "0"] },

  // ─── Settings: Window & System ───
  { id: "toggle-esc-loses-focus", label: "Escape Key Drops Focus", category: "Preferences", defaultAlias: "esc" },
  { id: "toggle-menu-bar", label: "Menu Bar Tray Icon", category: "Preferences", defaultAlias: "tray" },
  { id: "toggle-smooth-caret", label: "Smooth Cursor Caret", category: "Preferences", defaultAlias: "caret" },
  { id: "open-finder-storage", label: "Open Database in Finder", category: "Storage", defaultAlias: "storage" },
  { id: "danger-clear-notes", label: "Clear All Notes", category: "Storage", defaultAlias: "clear" },

  // ─── App Controls ───
  { id: "open-full-settings", label: "Open Full Settings Window", category: "App Controls", shortcut: ["⌘", ","], defaultAlias: "settings" },
  { id: "shortcuts-sheet", label: "Keyboard Shortcuts Cheatsheet", category: "App Controls", shortcut: ["⌘", "/"], defaultAlias: "keys" },
  { id: "hide-window", label: "Hide Window", category: "App Controls", shortcut: ["⌘", "W"], defaultAlias: "hide" },
  { id: "quit-app", label: "Quit rayNote", category: "App Controls", shortcut: ["⌘", "Q"], defaultAlias: "quit" },
];

const ALIASES_STORAGE_KEY = "notefast_command_aliases";

export function getStoredAliases(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ALIASES_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse stored aliases:", err);
    return {};
  }
}

export function setStoredAliases(aliases: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ALIASES_STORAGE_KEY, JSON.stringify(aliases));
  } catch (err) {
    console.error("Failed to store aliases:", err);
  }
}
