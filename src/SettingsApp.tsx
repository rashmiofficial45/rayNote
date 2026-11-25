import { ResourceUsage } from "./components/ResourceUsage";
import { WebBrowserSetting } from "./components/WebBrowserSetting";
import { GlassClaritySlider } from "./components/GlassClaritySlider";
import { DEFAULT_ZOOM, readZoom, ZOOM_KEYS, type ZoomMode } from "./lib/zoom";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "./lib/storage";
import { requestEditorFlush } from "./lib/editorFlush";
import { requestClearAllNotes } from "./lib/noteDeletion";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRevealWindow } from "./lib/useRevealWindow";
import {
  Info,
  Sliders,
  Keyboard,
  Database,
  RotateCcw,
  Minus,
  Plus,
  Check,
  FolderOpen,
  FileDown,
  FileText,
  Trash2,
  Sparkles,
  Search,
  X,
  Command,
  Bold,
  Pencil,
} from "lucide-react";
import {
  ThemeMode,
  AccentColor,
  ACCENT_OPTIONS,
  FONT_OPTIONS,
  getStoredThemeMode,
  setStoredThemeMode,
  getStoredAccent,
  setStoredAccent,
  getStoredFont,
  setStoredFont,
  getStoredTextOpacity,
  setStoredTextOpacity,
  initTheme,
} from "./lib/theme";
import {
  closeSettingsWindow,
  openAppDataFolder,
  getStorageStats,
  StorageStats,
  exportAllNotesFromDb,
} from "./lib/db";
import {
  broadcastSync,
  listenToSettingsSync,
  formatKeystrokeFromEvent,
  getKeystrokeModifierString,
  nativeShortcut,
} from "./lib/settingsSync";
import {
  ALL_PALETTE_COMMANDS,
  getDefaultAliases,
  getStoredAliases,
  setStoredAliases,
} from "./lib/aliases";

import {
  DEFAULT_COMMANDS,
  CommandRow,
  getStoredCommandsConfig,
  saveCommandsConfig,
  detectShortcutConflict,
} from "./lib/commandsConfig";

const SETTINGS_PANES = {
  general: { label: "General", icon: Sliders, tone: "bg-slate-500" },
  commands: { label: "Commands", icon: Keyboard, tone: "bg-indigo-600" },
  storage: { label: "Storage", icon: Database, tone: "bg-teal-700" },
  about: { label: "About", icon: Info, tone: "bg-blue-600" },
} as const;

type SettingsPane = keyof typeof SETTINGS_PANES;

const APPEARANCE_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

function AppearancePreview({ mode }: { mode: ThemeMode }) {
  return (
    <span className="settings-theme-preview relative block w-full overflow-hidden rounded-lg aspect-[1.8] border border-black/15" aria-hidden="true">
      {mode !== "dark" && <span className="settings-theme-sketch settings-theme-sketch-light" />}
      {mode !== "light" && (
        <span className={`settings-theme-sketch settings-theme-sketch-dark ${mode === "system" ? "[clip-path:inset(0_0_0_50%)]" : ""}`} />
      )}
    </span>
  );
}

const databaseSizeFormatter = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});

const COMMAND_SECTIONS = [
  { title: "Application & Window Commands", category: "commands", icon: Command },
  { title: "Text Formatting", category: "formatting", icon: Bold },
  { title: "Document Editing", category: "editing", icon: Pencil },
  { title: "Extensions & Features", category: "extensions", icon: Sparkles },
] as const;

const ALIAS_ID_MAP: Record<string, string> = {
  create: "new-note",
  browse: "browse-notes",
  find: "find-in-note",
  duplicate: "duplicate-note",
  pin: "pin-note",
  delete: "delete-note",
  next_note: "next-note",
  prev_note: "prev-note",
  history_back: "history-back",
  history_forward: "history-forward",
  copy_markdown: "copy-md",
  copy_deeplink: "copy-deeplink",
  export_note: "export-single",
  zoom_in: "zoom-in-step",
  zoom_out: "zoom-out-step",
  reset_zoom: "zoom-reset-step",
  shortcuts_help: "shortcuts-sheet",
  settings: "open-full-settings",
  hide: "hide-window",
  quit: "quit-app",
};

export default function SettingsApp() {
  // Restore most recently viewed pane (Apple standard)
  const [activePane, setActivePane] = useState<SettingsPane>(() => {
    const saved = safeLocalStorageGetItem("notefast_settings_active_pane") as string | null;
    if (saved === "aliases") return "commands";
    if (saved && ["general", "commands", "storage", "about"].includes(saved)) {
      return saved as SettingsPane;
    }
    return "general";
  });

  // Appearance & Theme State
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredThemeMode);
  const [accent, setAccent] = useState<AccentColor>(getStoredAccent);
  const [fontFamily, setFontFamily] = useState<string>(getStoredFont);
  const [textOpacity, setTextOpacity] = useState<number>(getStoredTextOpacity);

  const [zoomLevels, setZoomLevels] = useState(() => ({
    windowed: readZoom("windowed"),
    fullscreen: readZoom("fullscreen"),
  }));

  // Toggles State
  const [showMenuBar, setShowMenuBar] = useState<boolean>(() => {
    return safeLocalStorageGetItem("notefast_show_menubar") !== "false";
  });
  const [escLosesFocus, setEscLosesFocus] = useState<boolean>(() => {
    return safeLocalStorageGetItem("notefast_esc_loses_focus") === "true";
  });

  // Commands state
  const [commands, setCommands] = useState<CommandRow[]>(() => {
    return getStoredCommandsConfig();
  });

  // Aliases state
  const [aliases, setAliases] = useState<Record<string, string>>(getStoredAliases);
  const [aliasSearch, setAliasSearch] = useState("");
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState("");
  const aliasInputRef = useRef<HTMLInputElement>(null);

  // State for recording custom shortcuts
  const [recordingCommandId, setRecordingCommandId] = useState<string | null>(null);
  const [recordedModifiers, setRecordedModifiers] = useState<string>("");

  // Storage Stats
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [clearAgreed, setClearAgreed] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const headerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);

  React.useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activePane]);

  // The theme and the selected pane must commit before the window is shown.
  React.useLayoutEffect(initTheme, []);
  useRevealWindow(true);

  // Initialize storage stats and real-time sync listeners on mount
  useEffect(() => {
    loadStorageStats();

    const stopSync = listenToSettingsSync({
      onThemeModeChange: setThemeMode,
      onAccentChange: setAccent,
      onFontChange: setFontFamily,
      onTextOpacityChange: setTextOpacity,
      onZoomChange: (value, mode) => setZoomLevels((levels) =>
        levels[mode] === value ? levels : { ...levels, [mode]: value }),
      onMenuBarChange: setShowMenuBar,
      onEscLosesFocusChange: setEscLosesFocus,
      onCommandsConfigChange: setCommands,
      onAliasesConfigChange: (newAliases) => {
        setAliases(newAliases || {});
      },
    });
    return stopSync;
  }, []);

  // Native window drag on mousedown for top header bar (identical to Note window)
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const handleMouseDown = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest("input") ||
        target.closest("select") ||
        target.closest("textarea") ||
        target.closest("label")
      ) {
        return;
      }

      e.preventDefault();
      window.getSelection()?.removeAllRanges();

      if (e.button === 0) {
        invoke("start_native_drag").catch((err) => {
          console.error("start_native_drag error:", err);
        });
      }
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    const handleDblClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
    };

    header.addEventListener("mousedown", handleMouseDown);
    header.addEventListener("selectstart", handleSelectStart);
    header.addEventListener("dblclick", handleDblClick);
    return () => {
      header.removeEventListener("mousedown", handleMouseDown);
      header.removeEventListener("selectstart", handleSelectStart);
      header.removeEventListener("dblclick", handleDblClick);
    };
  }, []);

  const loadStorageStats = async () => {
    try {
      const stats = await getStorageStats();
      setStorageStats(stats);
    } catch (err) {
      console.error("Failed to load storage stats:", err);
    }
  };

  const handlePaneChange = (pane: SettingsPane) => {
    if (pane === activePane) return;
    setActivePane(pane);
    safeLocalStorageSetItem("notefast_settings_active_pane", pane);
  };

  const startRecording = (id: string) => {
    setRecordingCommandId(id);
    setRecordedModifiers("");
  };

  const shortcutChangePendingRef = useRef(false);
  const handleUpdateHotkey = useCallback(async (id: string, newHotkey: string) => {
    if (shortcutChangePendingRef.current) return;

    // Detect conflict with another existing command
    const conflict = detectShortcutConflict(newHotkey, id, commands);
    if (conflict) {
      setActionMessage(`"${newHotkey}" is already assigned to "${conflict.title}".`);
      setTimeout(() => setActionMessage(null), 3500);
      return;
    }

    if (id === "toggle") {
      shortcutChangePendingRef.current = true;
      try {
        const native = nativeShortcut(newHotkey);
        const enabled = commands.find(c => c.id === id)?.enabled !== false;
        await invoke("set_toggle_shortcut", { shortcut: enabled ? native : null });
      } catch (err) {
        console.warn("Invalid global shortcut:", err);
        setActionMessage(err instanceof Error ? err.message : "Invalid global shortcut");
        setTimeout(() => setActionMessage(null), 3000);
        return;
      } finally { shortcutChangePendingRef.current = false; }
    }
    setCommands((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, hotkey: newHotkey } : c));
      safeLocalStorageSetItem("notefast_commands_config", JSON.stringify(updated));
      broadcastSync({ type: "commands_config", value: updated });
      return updated;
    });
  }, [commands]);

  const handleResetHotkey = useCallback((id: string) => {
    const defaultCmd = DEFAULT_COMMANDS.find((c) => c.id === id);
    if (!defaultCmd) return;
    handleUpdateHotkey(id, defaultCmd.hotkey);
  }, [handleUpdateHotkey]);

  // Shortcut recording key listener
  useEffect(() => {
    if (!recordingCommandId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecordingCommandId(null);
        setRecordedModifiers("");
        return;
      }

      // Backspace or Delete resets to default
      if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        handleResetHotkey(recordingCommandId);
        setRecordingCommandId(null);
        setRecordedModifiers("");
        return;
      }

      const { isModifierOnly, result } = formatKeystrokeFromEvent(e);

      if (isModifierOnly) {
        setRecordedModifiers(result);
        return;
      }

      if (result) {
        handleUpdateHotkey(recordingCommandId, result);
        setRecordingCommandId(null);
        setRecordedModifiers("");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mods = getKeystrokeModifierString(e);
      setRecordedModifiers(mods);
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".settings-cmd-kbd")) {
        setRecordingCommandId(null);
        setRecordedModifiers("");
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("mousedown", handleMouseDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [recordingCommandId, handleUpdateHotkey, handleResetHotkey]);

  // Aliases management handlers
  const handleStartEditAlias = (cmdId: string) => {
    setEditingAliasId(cmdId);
    setEditingAliasValue(aliases[cmdId] || "");
  };

  const handleSaveAlias = (cmdId: string, val: string) => {
    const clean = val.trim().toLowerCase().replace(/\s+/g, "-");
    const updated = { ...aliases };
    const altId = ALIAS_ID_MAP[cmdId] || Object.keys(ALIAS_ID_MAP).find((k) => ALIAS_ID_MAP[k] === cmdId);
    if (clean) {
      updated[cmdId] = clean;
      if (altId) updated[altId] = clean;
    } else {
      delete updated[cmdId];
      if (altId) delete updated[altId];
    }
    setAliases(updated);
    setStoredAliases(updated);
    broadcastSync({ type: "aliases_config", value: updated });
    setEditingAliasId(null);
    const target = commands.find((c) => c.id === cmdId) || ALL_PALETTE_COMMANDS.find((c) => c.id === cmdId);
    if (target) {
      const title = "title" in target ? target.title : target.label;
      setActionMessage(clean ? `Alias for "${title}" set to "${clean}"` : `Alias for "${title}" removed`);
      setTimeout(() => setActionMessage(null), 2500);
    }
  };

  const handleClearAlias = (cmdId: string) => {
    const updated = { ...aliases };
    const altId = ALIAS_ID_MAP[cmdId] || Object.keys(ALIAS_ID_MAP).find((k) => ALIAS_ID_MAP[k] === cmdId);
    delete updated[cmdId];
    if (altId) delete updated[altId];
    setAliases(updated);
    setStoredAliases(updated);
    broadcastSync({ type: "aliases_config", value: updated });
    const target = commands.find((c) => c.id === cmdId) || ALL_PALETTE_COMMANDS.find((c) => c.id === cmdId);
    if (target) {
      const title = "title" in target ? target.title : target.label;
      setActionMessage(`Alias cleared for "${title}"`);
      setTimeout(() => setActionMessage(null), 2000);
    }
  };

  const handleResetAllCommandsAndAliases = () => {
    setCommands(DEFAULT_COMMANDS);
    saveCommandsConfig(DEFAULT_COMMANDS);
    broadcastSync({ type: "commands_config", value: DEFAULT_COMMANDS });
    const defaults = getDefaultAliases();
    setAliases(defaults);
    setStoredAliases(defaults);
    broadcastSync({ type: "aliases_config", value: defaults });
    setActionMessage("Reset all shortcuts and aliases to defaults");
    setTimeout(() => setActionMessage(null), 2500);
  };

  // Keyboard shortcut handler inside Settings (⌘W to close, ⌘, to keep, Esc to close, Left/Right arrow to cycle menu tabs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept while recording a shortcut or editing an alias
      if (recordingCommandId !== null || editingAliasId !== null) return;

      const isCmd = e.metaKey || e.ctrlKey;
      if (isCmd && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        closeSettingsWindow();
        return;
      }
      if (e.key === "Escape") {
        if (e.target instanceof Element && e.target.closest("#web-browser-options")) return;
        e.preventDefault();
        closeSettingsWindow();
        return;
      }
      if (isCmd && e.key === ",") {
        e.preventDefault();
        return;
      }
      // Pane switcher shortcuts: ⌘1, ⌘2, ⌘3, ⌘4
      if (isCmd && e.key === "1") {
        e.preventDefault();
        handlePaneChange("general");
      } else if (isCmd && e.key === "2") {
        e.preventDefault();
        handlePaneChange("commands");
      } else if (isCmd && e.key === "3") {
        e.preventDefault();
        handlePaneChange("storage");
      } else if (isCmd && e.key === "4") {
        e.preventDefault();
        handlePaneChange("about");
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activePane, recordingCommandId, editingAliasId]);

  // Synchronize Theme Changes
  const handleThemeModeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    setStoredThemeMode(mode);
  };

  const handleAccentChange = (acc: AccentColor) => {
    setAccent(acc);
    setStoredAccent(acc);
  };

  const handleFontChange = (font: string) => {
    setFontFamily(font);
    setStoredFont(font);
  };

  const handleTextOpacityChange = (val: number) => {
    const clamped = Math.min(100, Math.max(50, Math.round(val)));
    setTextOpacity(clamped);
    setStoredTextOpacity(clamped);
  };

  // Zoom handlers
  const handleZoom = (mode: ZoomMode, level: number) => {
    const clamped = Math.max(0.6, Math.min(2.0, Math.round(level * 10) / 10));
    setZoomLevels((levels) => ({ ...levels, [mode]: clamped }));
    safeLocalStorageSetItem(ZOOM_KEYS[mode], String(clamped));
    broadcastSync({ type: "zoom", mode, value: clamped });
  };

  // Toggle handlers
  const handleToggleMenuBar = async () => {
    const val = !showMenuBar;
    setShowMenuBar(val);
    safeLocalStorageSetItem("notefast_show_menubar", val ? "true" : "false");
    broadcastSync({ type: "menu_bar", value: val });
    try {
      await invoke("set_menu_bar_visible", { visible: val });
    } catch (err) {
      console.error("set_menu_bar_visible error:", err);
    }
  };

  const handleToggleEscLosesFocus = () => {
    const val = !escLosesFocus;
    setEscLosesFocus(val);
    safeLocalStorageSetItem("notefast_esc_loses_focus", val ? "true" : "false");
    broadcastSync({ type: "esc_loses_focus", value: val });
  };


  // Toggle command row enabled
  const handleToggleCommand = async (id: string) => {
    if (shortcutChangePendingRef.current) return;
    const command = commands.find(c => c.id === id);
    if (!command) return;
    const enabled = !command.enabled;
    if (id === "toggle") {
      shortcutChangePendingRef.current = true;
      try {
        await invoke("set_toggle_shortcut", { shortcut: enabled ? nativeShortcut(command.hotkey) : null });
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Unable to change global shortcut");
        return;
      } finally { shortcutChangePendingRef.current = false; }
    }
    const next = commands.map(c => c.id === id ? { ...c, enabled } : c);
    setCommands(next);
    safeLocalStorageSetItem("notefast_commands_config", JSON.stringify(next));
    broadcastSync({ type: "commands_config", value: next });
  };

  // Export All Notes
  const handleExportAll = async () => {
    try {
      await requestEditorFlush();
      const stats = await getStorageStats();
      if (stats.notes_count === 0) {
        setActionMessage("No notes to export.");
        return;
      }
      await exportAllNotesFromDb();
      setActionMessage(`Exported ${stats.notes_count} note(s) to Downloads/rayNote_Exports.`);
      setTimeout(() => setActionMessage(null), 3500);
    } catch (err) {
      console.error(err);
      setActionMessage("Export failed.");
    }
  };

  // Clear all notes
  const handleClearAllNotes = async () => {
    if (!clearAgreed) return;
    try {
      await requestClearAllNotes();
      setIsClearing(false);
      setClearAgreed(false);
      loadStorageStats();
      setActionMessage("All notes moved to Trash.");
      setTimeout(() => setActionMessage(null), 3000);

    } catch (err) {
      console.error(err);
      setActionMessage("Could not move all notes to Trash.");
    }
  };

  const query = aliasSearch.trim().toLowerCase();
  const commandSections = activePane === "commands" ? COMMAND_SECTIONS.map((section) => ({
    ...section,
    matches: commands.filter((command) => {
      if (command.category !== section.category) return false;
      const altId = ALIAS_ID_MAP[command.id];
      const alias = aliases[command.id] || (altId ? aliases[altId] : "") || "";
      return !query || [command.title, command.hotkey, alias, section.title]
        .some((value) => value.toLowerCase().includes(query));
    }),
  })).filter((section) => section.matches.length > 0) : [];

  return (
    <div className="settings-window-root">
      <header ref={headerRef} className="settings-header-bar" data-tauri-drag-region>
        <div className="settings-header-left" data-tauri-drag-region>
          <button
            type="button"
            onClick={closeSettingsWindow}
            className="settings-close-button"
            title="Close Settings (⌘W)"
            aria-label="Close Settings"
          >
            <span className="settings-close-dot"><X size={11} strokeWidth={2.8} aria-hidden="true" /></span>
          </button>
          <span className="flex min-w-0 items-center gap-1.5" data-tauri-drag-region>
            <img src="/app-icon.png" className="size-6 shrink-0 pointer-events-none" alt="" />
            <span data-tauri-drag-region>rayNote</span>
          </span>
        </div>
        <div className="settings-pane-heading" data-tauri-drag-region>
          <h1 id="settings-pane-title" data-tauri-drag-region>{SETTINGS_PANES[activePane].label}</h1>
        </div>
      </header>

      <nav className="settings-sidebar" aria-label="Settings sections">
        {(Object.keys(SETTINGS_PANES) as SettingsPane[]).map(pane => {
          const { label, icon: Icon, tone } = SETTINGS_PANES[pane];
          return (
            <button
              key={pane}
              type="button"
              className="settings-sidebar-item"
              aria-current={activePane === pane ? "page" : undefined}
              onClick={() => handlePaneChange(pane)}
            >
              <span className={`settings-sidebar-icon ${tone}`}><Icon size={13} strokeWidth={2.35} aria-hidden="true" /></span>
              {label}
            </button>
          );
        })}
      </nav>

      <main ref={contentRef} className="settings-body-content" aria-labelledby="settings-pane-title">
        {actionMessage && (
          <div className="settings-action-banner" role="status">
            <span>{actionMessage}</span>
          </div>
        )}

        {/* ─── PANE 1: GENERAL ─── */}
        {activePane === "general" && (
          <div className="settings-pane-content">
            <h2 className="settings-section-title">Appearance</h2>
            <div className="settings-card">
              <div className="settings-row settings-appearance-row">
                <div className="settings-row-text">
                  <div className="settings-row-title" id="settings-color-mode">Color Mode</div>
                </div>
                <div className="settings-row-action w-full">
                  <div className="grid w-full max-w-[26rem] grid-cols-3 gap-3" role="group" aria-labelledby="settings-color-mode">
                    {APPEARANCE_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={themeMode === value}
                        className="settings-theme-choice group flex min-w-0 flex-col items-center gap-1.5 rounded-lg text-xs font-medium"
                        onClick={() => handleThemeModeChange(value)}
                      >
                        <AppearancePreview mode={value} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="settings-card-divider" />

              {/* Accent Palette (6 Liquid Glass Themes) */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Accent Theme</div>
                  <div className="settings-row-desc">
                    Choose the accent color for rayNote controls.
                  </div>
                </div>
                <div className="settings-row-action">
                  <div className="settings-accent-palette-grid">
                    {ACCENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`settings-accent-dot-btn ${accent === opt.id ? "is-selected" : ""}`}
                        onClick={() => handleAccentChange(opt.id)}
                        title={opt.name}
                        aria-pressed={accent === opt.id}
                      >
                        <span
                          className="settings-accent-dot"
                          style={{ backgroundColor: opt.color }}
                        />
                        <span className="settings-accent-name">{opt.name.split(" ")[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="settings-card-divider" />

              {/* Font Family Selection */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Editor Typography</div>
                  <div className="settings-row-desc">
                    Choose the font used in notes.
                  </div>
                </div>
                <div className="settings-row-action">
                  <select
                    className="settings-select-input"
                    aria-label="Editor Typography"
                    value={fontFamily}
                    onChange={(e) => handleFontChange(e.target.value)}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="settings-card-divider" />

              {/* Text Opacity Slider */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Text Opacity</div>
                  <div className="settings-row-desc">
                    Adjust how strongly note text stands out.
                  </div>
                </div>
                <div className="settings-row-action">
                  <div className="settings-opacity-control">
                    <button
                      type="button"
                      className="settings-stepper-btn"
                      onClick={() => handleTextOpacityChange(100)}
                      disabled={textOpacity === 100}
                      title="Reset Opacity to 100%"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <input
                      type="range"
                      min={50}
                      max={100}
                      step={1}
                      value={textOpacity}
                      onChange={(e) => handleTextOpacityChange(Number(e.target.value))}
                      className="settings-range-slider"
                      aria-label="Text Opacity"
                    />
                    <span className="settings-opacity-display">
                      {textOpacity}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <h2 className="settings-section-title">Note Window</h2>
            <div className="settings-card">
              <div className="settings-glass-clarity">
                <GlassClaritySlider label="Note Window Liquid Glass" description="Adjusts the transparency of the note window." />
              </div>
              {(["windowed", "fullscreen"] as const).map((mode) => {
                const title = mode === "fullscreen" ? "Full Screen Zoom" : "Windowed Zoom";
                const level = zoomLevels[mode];

                return (
                  <React.Fragment key={mode}>
                    <div className="settings-card-divider" />
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <div className="settings-row-title" id={`zoom-${mode}`}>
                          {title}
                        </div>
                        <div className="settings-row-desc">
                          {mode === "fullscreen" ? "Adjust note zoom in full screen." : "Adjust note zoom in a regular window."}
                        </div>
                      </div>
                      <div className="settings-row-action">
                        <div className="settings-zoom-stepper" role="group" aria-labelledby={`zoom-${mode}`}>
                          <button
                            type="button"
                            className="settings-stepper-btn"
                            onClick={() => handleZoom(mode, DEFAULT_ZOOM)}
                            title="Reset Zoom to 120%"
                          >
                            <RotateCcw size={13} />
                          </button>
                          <button
                            type="button"
                            className="settings-stepper-btn"
                            onClick={() => handleZoom(mode, level - 0.1)}
                            disabled={level <= 0.6}
                            title="Zoom Out"
                          >
                            <Minus size={13} />
                          </button>
                          <output className="settings-zoom-display">
                            {Math.round(level * 100)}%
                          </output>
                          <button
                            type="button"
                            className="settings-stepper-btn"
                            onClick={() => handleZoom(mode, level + 0.1)}
                            disabled={level >= 2}
                            title="Zoom In"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            <h2 className="settings-section-title">Behavior</h2>
            <div className="settings-card">
              {/* Show Menu Bar Icon */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Show Menu Bar Icon</div>
                  <div className="settings-row-desc">
                    Display the rayNote icon in the macOS menu bar for quick notes, settings, and options.
                  </div>
                </div>
                <div className="settings-row-action">
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={showMenuBar}
                      aria-label="Show Menu Bar Icon"
                      onChange={handleToggleMenuBar}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>

              <div className="settings-card-divider" />

              {/* Escape Key Loses Focus */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Escape Key Loses Focus</div>
                  <div className="settings-row-desc">
                    When enabled, pressing Escape in Notes makes the window lose focus instead of hiding.
                  </div>
                </div>
                <div className="settings-row-action">
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={escLosesFocus}
                      aria-label="Escape Key Loses Focus"
                      onChange={handleToggleEscLosesFocus}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>
            </div>
            <WebBrowserSetting />
          </div>
        )}

        {/* ─── PANE 2: COMMANDS & SHORTCUTS (Unified Raycast Style) ─── */}
        {activePane === "commands" && (
          <div className="settings-pane-content">
            <div className="settings-aliases-toolbar">
              <div className="settings-aliases-search-box">
                <Search size={13} className="settings-aliases-search-icon" />
                <input
                  type="text"
                  placeholder="Filter commands, aliases, or shortcuts…"
                  aria-label="Filter commands, aliases, or shortcuts"
                  value={aliasSearch}
                  onChange={(e) => setAliasSearch(e.target.value)}
                  className="settings-aliases-search-input"
                  spellCheck={false}
                  autoComplete="off"
                />
                {aliasSearch && (
                  <button
                    type="button"
                    onClick={() => setAliasSearch("")}
                    className="settings-aliases-search-clear"
                    title="Clear filter"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              <button
                type="button"
                className="settings-action-btn"
                onClick={handleResetAllCommandsAndAliases}
                title="Reset all command hotkeys and aliases to defaults"
              >
                <RotateCcw size={11} />
                <span>Reset Defaults</span>
              </button>
            </div>

            <div className="settings-aliases-hint-bar">
              <Command size={12} className="settings-aliases-hint-icon" />
              <span>
                Select an alias or shortcut to edit it. The checkmark turns a shortcut on or off.
              </span>
            </div>

            {commandSections.length === 0 && (
              <div className="settings-card settings-empty" role="status">
                <Search size={21} aria-hidden="true" />
                <h2>No matching commands</h2>
                <p>Try a command name, alias, or shortcut.</p>
                <button type="button" className="settings-action-btn" onClick={() => setAliasSearch("")}>Clear Filter</button>
              </div>
            )}
            {commandSections.map(({ title, category, icon: Icon, matches }) => (
              <section key={category} className="settings-command-section" aria-labelledby={`commands-${category}`}>
                <h2 className="settings-section-title" id={`commands-${category}`}>{title}</h2>
                <div className="settings-card commands-table-card">
                  {matches.map((cmd, idx, arr) => {
                    const defaultHotkey = DEFAULT_COMMANDS.find((d) => d.id === cmd.id)?.hotkey || "";
                    const isCustomHotkey = cmd.hotkey !== defaultHotkey;
                    const isRecording = recordingCommandId === cmd.id;
                    const altId = ALIAS_ID_MAP[cmd.id];
                    const currentAlias = aliases[cmd.id] || (altId ? aliases[altId] : "") || "";
                    const isEditingAlias = editingAliasId === cmd.id;

                    return (
                      <React.Fragment key={cmd.id}>
                        <div className={`settings-command-row ${!cmd.enabled ? "is-disabled" : ""}`}>
                          {/* 1. Left: Icon + Command Title */}
                          <div className="settings-cmd-left min-w-0 flex-1">
                            <span className="settings-cmd-icon"><Icon size={14} aria-hidden="true" /></span>
                            <span className="settings-cmd-title">{cmd.title}</span>
                          </div>

                          {/* 2. Right: Alias + Hotkey + Checkbox */}
                          <div className="settings-cmd-right flex-shrink-0">
                            {/* Alias Column */}
                            <div className="settings-cmd-col-alias">
                              {isEditingAlias ? (
                                <div className="settings-alias-inline-editor">
                                  <input
                                    ref={aliasInputRef}
                                    type="text"
                                    value={editingAliasValue}
                                    onChange={(e) => setEditingAliasValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleSaveAlias(cmd.id, editingAliasValue);
                                      } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        setEditingAliasId(null);
                                      }
                                    }}
                                    onBlur={() => handleSaveAlias(cmd.id, editingAliasValue)}
                                    placeholder="alias…"
                                    className="settings-alias-input"
                                    spellCheck={false}
                                    autoComplete="off"
                                  />
                                </div>
                              ) : (
                                <div className="settings-alias-display-group">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditAlias(cmd.id)}
                                    className={`settings-alias-cell-btn ${currentAlias ? "has-alias" : "is-empty"}`}
                                    title={currentAlias ? `Alias: ${currentAlias} (click to edit)` : "Click to set alias"}
                                  >
                                    {currentAlias ? (
                                      <span className="settings-alias-cell-val">{currentAlias}</span>
                                    ) : (
                                      <span className="settings-alias-cell-placeholder">Alias</span>
                                    )}
                                  </button>
                                  {currentAlias && (
                                    <button
                                      type="button"
                                      className="settings-alias-clear-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleClearAlias(cmd.id);
                                      }}
                                      title="Remove alias"
                                    >
                                      <X size={10} />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Hotkey Column */}
                            <div className="settings-cmd-col-hotkey">
                              <div className="settings-cmd-kbd-wrapper">
                                <button
                                  type="button"
                                  className={`settings-cmd-kbd ${isRecording ? "is-recording" : ""} ${!cmd.hotkey ? "is-empty" : ""}`}
                                  onClick={() => startRecording(cmd.id)}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    startRecording(cmd.id);
                                  }}
                                  title={cmd.hotkey ? "Click or double-click to record shortcut" : "Click to add shortcut"}
                                >
                                  {isRecording ? (
                                    <span className="flex items-center gap-1.5">
                                      <span className="recording-pulse-dot" />
                                      <span>{recordedModifiers ? `${recordedModifiers}…` : "Press keys…"}</span>
                                    </span>
                                  ) : cmd.hotkey ? (
                                    cmd.hotkey
                                  ) : (
                                    <span className="settings-cmd-hotkey-placeholder">Add Hotkey</span>
                                  )}
                                </button>
                                {isCustomHotkey && !isRecording && (
                                  <button
                                    type="button"
                                    className="settings-cmd-reset-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleResetHotkey(cmd.id);
                                    }}
                                    title="Reset to default shortcut"
                                  >
                                    <RotateCcw size={11} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Checkbox Column */}
                            <button
                              type="button"
                              className={`settings-cmd-checkbox ${cmd.enabled ? "is-checked" : ""}`}
                              onClick={() => handleToggleCommand(cmd.id)}
                              aria-label={`Toggle ${cmd.title}`}
                              aria-pressed={cmd.enabled}
                              title={cmd.enabled ? "Shortcut enabled (click to turn off)" : "Shortcut disabled (click to turn on)"}
                            >
                              {cmd.enabled && <Check size={12} strokeWidth={2.5} />}
                            </button>
                          </div>
                        </div>
                        {idx < arr.length - 1 && <div className="settings-card-divider" />}
                      </React.Fragment>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Storage */}
        {activePane === "storage" && (
          <div className="settings-pane-content">
            <h2 className="settings-section-title">On This Mac</h2>
            <dl className="settings-card settings-storage-stats">
              <div>
                <dt><FileText size={15} aria-hidden="true" />Total Notes</dt>
                <dd>{storageStats?.notes_count.toLocaleString() ?? "—"}</dd>
              </div>
              <div>
                <dt><Database size={15} aria-hidden="true" />Database Size</dt>
                <dd>{storageStats ? databaseSizeFormatter.format(storageStats.size_bytes / 1_000_000) : "—"}</dd>
              </div>
            </dl>
            <h2 className="settings-section-title">Files & Export</h2>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">SQLite Database Storage</div>
                  <div className="settings-row-desc">
                    Reveal the folder that holds your local rayNote database.
                  </div>
                </div>
                <div className="settings-row-action">
                  <button
                    type="button"
                    className="settings-action-btn"
                    onClick={openAppDataFolder}
                  >
                    <FolderOpen size={13} />
                    <span>Open in Finder</span>
                  </button>
                </div>
              </div>

              <div className="settings-card-divider" />

              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Export All Notes</div>
                  <div className="settings-row-desc">
                    Save each note as a Markdown (.md) file.
                  </div>
                </div>
                <div className="settings-row-action">
                  <button
                    type="button"
                    className="settings-action-btn"
                    onClick={handleExportAll}
                  >
                    <FileDown size={13} />
                    <span>Export Markdown</span>
                  </button>
                </div>
              </div>
            </div>

            <h2 className="settings-section-title">Manage Notes</h2>
            <div className="settings-card danger-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title danger-title">Danger Zone</div>
                  <div className="settings-row-desc">
                    Move all notes to Trash. You can restore them from Actions → Open Trash.
                  </div>
                </div>
                <div className="settings-row-action">
                  {!isClearing ? (
                    <button
                      type="button"
                      className="settings-danger-btn"
                      onClick={() => setIsClearing(true)}
                    >
                      <Trash2 size={13} />
                      <span>Move All to Trash</span>
                    </button>
                  ) : (
                    <div className="settings-danger-confirm-group">
                      <label className="settings-danger-checkbox">
                        <input
                          type="checkbox"
                          checked={clearAgreed}
                          onChange={(e) => setClearAgreed(e.target.checked)}
                        />
                        <span>Confirm move</span>
                      </label>
                      <button
                        type="button"
                        className="settings-danger-btn danger-confirm"
                        disabled={!clearAgreed}
                        onClick={handleClearAllNotes}
                      >
                        Move to Trash
                      </button>
                      <button
                        type="button"
                        className="settings-stepper-btn"
                        onClick={() => {
                          setIsClearing(false);
                          setClearAgreed(false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* About */}
        {activePane === "about" && (
          <div className="settings-pane-content">
            <div className="settings-card settings-about">
              <img src="/app-icon.png" alt="" width={76} height={76} />
              <div>
                <h2>rayNote</h2>
                <p>Version 0.1.0</p>
                <p className="settings-about-platform">macOS Apple Silicon (Universal)</p>
              </div>
            </div>
            <ResourceUsage />
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Architecture</div>
                  <div className="settings-row-desc">
                    Notes are stored locally in SQLite. The note editor and Settings run in separate macOS windows.
                  </div>
                </div>
              </div>

              <div className="settings-card-divider" />

              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Tech Stack</div>
                  <div className="settings-row-desc">
                    Tauri 2, Rust, SQLite, React 19, and TipTap
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
