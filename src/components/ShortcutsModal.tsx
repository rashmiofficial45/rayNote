import { useState, useEffect, useMemo } from "react";
import { Search, X, Keyboard } from "lucide-react";
import { listenToSettingsSync } from "../lib/settingsSync";
import {
  getStoredCommandsConfig,
  getCommandHotkey,
  splitHotkeyToKeys,
  CommandRow,
} from "../lib/commandsConfig";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: "Navigation & App" | "Formatting" | "Blocks & Lists" | "Sharing & View";
}

const STATIC_FORMATTING_SHORTCUTS: ShortcutItem[] = [
  // Formatting
  { keys: ["⌘", "B"], description: "Toggle Bold", category: "Formatting" },
  { keys: ["⌘", "I"], description: "Toggle Italic", category: "Formatting" },
  { keys: ["⌘", "U"], description: "Toggle Underline", category: "Formatting" },
  { keys: ["⇧", "⌘", "X"], description: "Toggle Strikethrough", category: "Formatting" },
  { keys: ["⌘", "E"], description: "Toggle Inline Code", category: "Formatting" },
  { keys: ["⇧", "⌘", "H"], description: "Toggle Highlight", category: "Formatting" },
  { keys: ["⌘", "L"], description: "Insert or Edit Link", category: "Formatting" },

  // Blocks & Lists
  { keys: ["⌘", "⌥", "1"], description: "Heading 1", category: "Blocks & Lists" },
  { keys: ["⌘", "⌥", "2"], description: "Heading 2", category: "Blocks & Lists" },
  { keys: ["⌘", "⌥", "3"], description: "Heading 3", category: "Blocks & Lists" },
  { keys: ["⌘", "⌥", "0"], description: "Paragraph / Normal Text", category: "Blocks & Lists" },
  { keys: ["⇧", "⌘", "8"], description: "Bullet List", category: "Blocks & Lists" },
  { keys: ["⇧", "⌘", "7"], description: "Numbered List", category: "Blocks & Lists" },
  { keys: ["⇧", "⌘", "9"], description: "Task List (Checklist)", category: "Blocks & Lists" },
  { keys: ["⌘", "↵"], description: "Toggle Task Checkbox", category: "Blocks & Lists" },
  { keys: ["⇧", "⌘", "B"], description: "Blockquote", category: "Blocks & Lists" },
  { keys: ["⌘", "⌥", "C"], description: "Code Block", category: "Blocks & Lists" },
  { keys: ["Tab"], description: "Indent List / 2 Spaces in Code", category: "Blocks & Lists" },
  { keys: ["⇧", "Tab"], description: "Outdent List", category: "Blocks & Lists" },
  { keys: ["⌘", "⌥", "-"], description: "Horizontal Ruler / Separation Line", category: "Blocks & Lists" },
  { keys: ["-", "-", "-"], description: "Horizontal Line (Type --- on new line)", category: "Blocks & Lists" },
  { keys: ["/"], description: "Slash Command Menu", category: "Blocks & Lists" },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const [filter, setFilter] = useState("");
  const [commandsConfig, setCommandsConfig] = useState<CommandRow[]>(getStoredCommandsConfig);

  useEffect(() => {
    return listenToSettingsSync({
      onCommandsConfigChange: (newConfig) => {
        setCommandsConfig(newConfig || getStoredCommandsConfig());
      },
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setFilter("");
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  const shortcutsList = useMemo(() => {
    const getKeys = (id: string, defaultHotkey: string): string[] => {
      const { enabled, hotkey } = getCommandHotkey(commandsConfig, id, defaultHotkey);
      return enabled ? splitHotkeyToKeys(hotkey) : ["Disabled"];
    };

    const navShortcuts: ShortcutItem[] = [
      { keys: getKeys("create", "⌘N"), description: "New Note", category: "Navigation & App" },
      { keys: getKeys("browse", "⌘P"), description: "Smart Search & Quick Switcher", category: "Navigation & App" },
      { keys: getKeys("search", "⌘K"), description: "Actions / Command Palette", category: "Navigation & App" },
      { keys: getKeys("duplicate", "⌘D"), description: "Duplicate Note", category: "Navigation & App" },
      { keys: getKeys("pin", "⇧⌘P"), description: "Pin / Unpin Note", category: "Navigation & App" },
      { keys: getKeys("prev_note", "⌥↑"), description: "Previous Note in List", category: "Navigation & App" },
      { keys: getKeys("next_note", "⌥↓"), description: "Next Note in List", category: "Navigation & App" },
      { keys: getKeys("history_back", "⌘["), description: "Go Back in History", category: "Navigation & App" },
      { keys: getKeys("history_forward", "⌘]"), description: "Go Forward in History", category: "Navigation & App" },
      { keys: getKeys("settings", "⌘,"), description: "Open Settings / Preferences", category: "Navigation & App" },
      { keys: getKeys("hide", "⌘W"), description: "Hide Window (Run in Background)", category: "Navigation & App" },
      { keys: getKeys("quit", "⌘Q"), description: "Quit rayNote Completely", category: "Navigation & App" },
      { keys: getKeys("delete", "⇧⌘⌫"), description: "Delete Current Note", category: "Navigation & App" },
    ];

    const shareShortcuts: ShortcutItem[] = [
      { keys: getKeys("copy_markdown", "⇧⌘C"), description: "Copy Note as Markdown", category: "Sharing & View" },
      { keys: getKeys("copy_deeplink", "⇧⌘D"), description: "Copy Deeplink", category: "Sharing & View" },
      { keys: getKeys("export_note", "⇧⌘E"), description: "Export Note as Markdown", category: "Sharing & View" },
      { keys: getKeys("zoom_in", "⌘="), description: "Zoom In", category: "Sharing & View" },
      { keys: getKeys("zoom_out", "⌘-"), description: "Zoom Out", category: "Sharing & View" },
      { keys: getKeys("reset_zoom", "⌘0"), description: "Reset Zoom (120% Default)", category: "Sharing & View" },
      { keys: getKeys("shortcuts_help", "⌘/"), description: "Toggle Shortcuts Sheet", category: "Sharing & View" },
      { keys: ["Esc"], description: "Close Active Modal / Overlay", category: "Sharing & View" },
    ];

    return [...navShortcuts, ...STATIC_FORMATTING_SHORTCUTS, ...shareShortcuts];
  }, [commandsConfig]);

  if (!isOpen) return null;

  const filteredShortcuts = shortcutsList.filter(
    (s) =>
      s.description.toLowerCase().includes(filter.toLowerCase()) ||
      s.keys.some((k) => k.toLowerCase().includes(filter.toLowerCase())) ||
      s.category.toLowerCase().includes(filter.toLowerCase())
  );

  const categories = ["Navigation & App", "Formatting", "Blocks & Lists", "Sharing & View"] as const;

  return (
    <div className="command-overlay" onClick={onClose}>
      <div
        className="shortcuts-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shortcuts-modal-header">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[var(--color-accent-muted)] border border-[var(--color-accent)] flex items-center justify-center text-[var(--color-accent)]">
              <Keyboard size={13} />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg-hover)] transition-colors"
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Filter input */}
        <div className="shortcuts-modal-search">
          <Search size={14} className="text-[var(--text-muted)] flex-shrink-0" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search shortcuts…"
            autoFocus
            className="bg-transparent border-none outline-none text-xs text-[var(--text-primary)] placeholder:text-[var(--placeholder)] w-full"
          />
        </div>

        {/* Categories list */}
        <div className="shortcuts-modal-body">
          {categories.map((cat) => {
            const items = filteredShortcuts.filter((s) => s.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="shortcuts-category-section">
                <div className="shortcuts-category-title">{cat}</div>
                <div className="shortcuts-grid">
                  {items.map((item, idx) => (
                    <div key={idx} className="shortcut-row">
                      <span className="shortcut-description">{item.description}</span>
                      <div className="shortcut-keys">
                        {item.keys.map((k, kIdx) => (
                          <kbd key={kIdx} className="shortcut-key">
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {filteredShortcuts.length === 0 && (
            <div className="text-center py-8 text-[var(--text-muted)] text-xs">
              No shortcuts found matching "{filter}"
            </div>
          )}
        </div>

        {/* Footer tip */}
        <div className="shortcuts-modal-footer">
          <span className="text-[11px] text-[var(--text-muted)]">
            Tip: Press <kbd className="shortcut-key text-[10px] px-1 py-0.5">/</kbd> in the editor to open the block insertion menu
          </span>
        </div>
      </div>
    </div>
  );
}
