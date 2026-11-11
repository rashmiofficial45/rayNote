import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "./lib/storage";
import { requestEditorFlush } from "./lib/editorFlush";
import { requestClearAllNotes } from "./lib/noteDeletion";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  Trash2,
  Moon,
  Sun,
  Monitor,
  Sparkles,
  Tag,
  Search,
  X,
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
  getStoredAliases,
  setStoredAliases,
} from "./lib/aliases";

import {
  DEFAULT_COMMANDS,
  CommandRow,
  getStoredCommandsConfig,
  detectShortcutConflict,
} from "./lib/commandsConfig";

type SettingsPane = "general" | "commands" | "aliases" | "storage" | "about";

export default function SettingsApp() {
  // Restore most recently viewed pane (Apple standard)
  const [activePane, setActivePane] = useState<SettingsPane>(() => {
    const saved = safeLocalStorageGetItem("notefast_settings_active_pane") as SettingsPane | null;
    if (saved && ["general", "commands", "aliases", "storage", "about"].includes(saved)) {
      return saved;
    }
    return "general";
  });

  // Appearance & Theme State
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredThemeMode);
  const [accent, setAccent] = useState<AccentColor>(getStoredAccent);
  const [fontFamily, setFontFamily] = useState<string>(getStoredFont);
  const [textOpacity, setTextOpacity] = useState<number>(getStoredTextOpacity);

  // Zoom State
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = safeLocalStorageGetItem("notefast_zoom_level");
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0.6 && parsed <= 2.0) return parsed;
    }
    return 1.2;
  });

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

  // Header drag ref & single red close button hover state
  const headerRef = useRef<HTMLElement>(null);
  const tabPillsRef = useRef<HTMLDivElement>(null);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  // Keep active tab scrolled into view on narrow screens
  useEffect(() => {
    if (!tabPillsRef.current) return;
    const activeEl = tabPillsRef.current.querySelector(".is-active") as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
  }, [activePane]);

  // Initialize theme, storage stats, and real-time sync listeners on mount
  useEffect(() => {
    const stopTheme = initTheme();
    loadStorageStats();

    const stopSync = listenToSettingsSync({
      onThemeModeChange: setThemeMode,
      onAccentChange: setAccent,
      onFontChange: setFontFamily,
      onTextOpacityChange: setTextOpacity,
      onZoomChange: setZoomLevel,
      onMenuBarChange: setShowMenuBar,
      onEscLosesFocusChange: setEscLosesFocus,
      onCommandsConfigChange: setCommands,
      onAliasesConfigChange: (newAliases) => {
        setAliases(newAliases || {});
      },
    });
    return () => { stopTheme?.(); stopSync(); };
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
        target.closest("label") ||
        target.closest(".settings-tab-pill")
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
    if (clean) {
      updated[cmdId] = clean;
    } else {
      delete updated[cmdId];
    }
    setAliases(updated);
    setStoredAliases(updated);
    broadcastSync({ type: "aliases_config", value: updated });
    setEditingAliasId(null);
    const cmd = ALL_PALETTE_COMMANDS.find((c) => c.id === cmdId);
    if (cmd) {
      setActionMessage(clean ? `Alias for "${cmd.label}" set to "${clean}"` : `Alias for "${cmd.label}" removed`);
      setTimeout(() => setActionMessage(null), 2500);
    }
  };

  const handleClearAlias = (cmdId: string) => {
    const updated = { ...aliases };
    delete updated[cmdId];
    setAliases(updated);
    setStoredAliases(updated);
    broadcastSync({ type: "aliases_config", value: updated });
    const cmd = ALL_PALETTE_COMMANDS.find((c) => c.id === cmdId);
    if (cmd) {
      setActionMessage(`Alias cleared for "${cmd.label}"`);
      setTimeout(() => setActionMessage(null), 2000);
    }
  };

  const handleResetAllAliases = () => {
    const defaults: Record<string, string> = {};
    ALL_PALETTE_COMMANDS.forEach((c) => {
      if (c.defaultAlias) defaults[c.id] = c.defaultAlias;
    });
    setAliases(defaults);
    setStoredAliases(defaults);
    broadcastSync({ type: "aliases_config", value: defaults });
    setActionMessage("Reset all command aliases to defaults");
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
        e.preventDefault();
        closeSettingsWindow();
        return;
      }
      if (isCmd && e.key === ",") {
        e.preventDefault();
        return;
      }
      // Pane switcher shortcuts: ⌘1, ⌘2, ⌘3, ⌘4, ⌘5
      if (isCmd && e.key === "1") {
        e.preventDefault();
        handlePaneChange("general");
      } else if (isCmd && e.key === "2") {
        e.preventDefault();
        handlePaneChange("commands");
      } else if (isCmd && e.key === "3") {
        e.preventDefault();
        handlePaneChange("aliases");
      } else if (isCmd && e.key === "4") {
        e.preventDefault();
        handlePaneChange("storage");
      } else if (isCmd && e.key === "5") {
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
  const handleZoom = (level: number) => {
    const clamped = Math.max(0.6, Math.min(2.0, Math.round(level * 10) / 10));
    setZoomLevel(clamped);
    safeLocalStorageSetItem("notefast_zoom_level", clamped.toString());
    broadcastSync({ type: "zoom", value: clamped });
    window.dispatchEvent(new CustomEvent("notefast_zoom_changed", { detail: { zoom: clamped } }));
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
      setActionMessage("All notes cleared.");
      setTimeout(() => setActionMessage(null), 3000);

    } catch (err) {
      console.error(err);
      setActionMessage("Failed to clear notes.");
    }
  };

  return (
    <div className="settings-window-root">
      {/* Top Header Bar with Navigation and Tabs (macOS Draggable) */}
      <header
        ref={headerRef}
        className="settings-header-bar"
        data-tauri-drag-region
        onMouseDown={(e) => {
          const target = e.target as HTMLElement;
          if (!target.closest("button") && !target.closest(".settings-tab-pill")) {
            e.preventDefault();
            window.getSelection()?.removeAllRanges();
          }
        }}
      >
        {/* Left: Single red (⌘W) button totally similar to the note tab, plus navigation */}
        <div className="settings-header-left" data-tauri-drag-region>
          <div
            className="title-bar-left"
            onMouseEnter={() => setIsCloseHovered(true)}
            onMouseLeave={() => setIsCloseHovered(false)}
          >
            <button
              type="button"
              onClick={closeSettingsWindow}
              onMouseEnter={() => setIsCloseHovered(true)}
              onMouseLeave={() => setIsCloseHovered(false)}
              className={`close-btn-x liquid-btn ${isCloseHovered ? "is-hovered" : ""}`}
              title="Close Settings (⌘W)"
              aria-label="Close Settings"
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="close-x-icon"
              >
                <path
                  d="M1.2 1.2L6.8 6.8M6.8 1.2L1.2 6.8"
                  stroke="#000000"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab Pills */}
        <div className="settings-tab-pills-container" data-tauri-drag-region>
          <div ref={tabPillsRef} className="settings-tab-pills" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activePane === "general"}
              className={`settings-tab-pill liquid-btn ${activePane === "general" ? "is-active" : ""}`}
              onClick={() => handlePaneChange("general")}
            >
              <Sliders size={12} />
              <span>General</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePane === "commands"}
              className={`settings-tab-pill liquid-btn ${activePane === "commands" ? "is-active" : ""}`}
              onClick={() => handlePaneChange("commands")}
            >
              <Keyboard size={12} />
              <span>Commands</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePane === "aliases"}
              className={`settings-tab-pill liquid-btn ${activePane === "aliases" ? "is-active" : ""}`}
              onClick={() => handlePaneChange("aliases")}
            >
              <Tag size={12} />
              <span>Aliases</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePane === "storage"}
              className={`settings-tab-pill liquid-btn ${activePane === "storage" ? "is-active" : ""}`}
              onClick={() => handlePaneChange("storage")}
            >
              <Database size={12} />
              <span>Storage</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePane === "about"}
              className={`settings-tab-pill liquid-btn ${activePane === "about" ? "is-active" : ""}`}
              onClick={() => handlePaneChange("about")}
            >
              <Info size={12} />
              <span>About</span>
            </button>
          </div>
        </div>

        {/* Right spacer for symmetrical centering */}
        <div className="settings-header-right-spacer" data-tauri-drag-region />
      </header>

      {/* Main Settings Body */}
      <main className="settings-body-content">
        {/* App Hero Branding (Raycast Style) */}
        <div className="settings-hero" data-tauri-drag-region>
          <div className="settings-hero-icon-wrapper">
            <img src="/app-icon.png" alt="rayNote" className="settings-hero-icon-img" />
          </div>
          <h1 className="settings-hero-title">rayNote</h1>
          <p className="settings-hero-subtitle text-[13.5px] [font-weight:500] text-[color:var(--text-muted)]">Raycast-inspired notes accessory for macOS.</p>
        </div>

        {actionMessage && (
          <div className="settings-action-banner">
            <span>{actionMessage}</span>
          </div>
        )}

        {/* ─── PANE 1: GENERAL ─── */}
        {activePane === "general" && (
          <div className="settings-pane-content">
            {/* Appearance Card */}
            <div className="settings-card">
              {/* Appearance Mode */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Appearance</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Choose between Dark, Light, or automatic macOS system appearance.
                  </div>
                </div>
                <div className="settings-row-action">
                  <div className="settings-segmented-group">
                    <button
                      type="button"
                      className={`settings-seg-btn liquid-btn ${themeMode === "dark" ? "is-active" : ""}`}
                      onClick={() => handleThemeModeChange("dark")}
                    >
                      <Moon size={12} />
                      <span>Dark</span>
                    </button>
                    <button
                      type="button"
                      className={`settings-seg-btn liquid-btn ${themeMode === "light" ? "is-active" : ""}`}
                      onClick={() => handleThemeModeChange("light")}
                    >
                      <Sun size={12} />
                      <span>Light</span>
                    </button>
                    <button
                      type="button"
                      className={`settings-seg-btn liquid-btn ${themeMode === "system" ? "is-active" : ""}`}
                      onClick={() => handleThemeModeChange("system")}
                    >
                      <Monitor size={12} />
                      <span>System</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-card-divider" />

              {/* Accent Palette (6 Liquid Glass Themes) */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Accent Theme</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    6 liquid glass curated palettes. Dynamically illuminates aura and controls.
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
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Editor Typography</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Select your preferred writing font with full Apple Color Emoji fallback.
                  </div>
                </div>
                <div className="settings-row-action">
                  <select
                    className="settings-select-input"
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
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Text Opacity</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Reduce eye strain by softening text contrast across the app.
                  </div>
                </div>
                <div className="settings-row-action">
                  <div className="settings-opacity-control">
                    <button
                      type="button"
                      className="settings-stepper-btn liquid-btn"
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

            {/* Window & Zoom Card (Raycast Style) */}
            <div className="settings-card">
              {/* Show Menu Bar Icon */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Show Menu Bar Icon</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Display the rayNote icon in the macOS menu bar for quick notes, settings, and options.
                  </div>
                </div>
                <div className="settings-row-action">
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={showMenuBar}
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
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Escape Key Loses Focus</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    When enabled, pressing Escape in Notes makes the window lose focus instead of hiding.
                  </div>
                </div>
                <div className="settings-row-action">
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={escLosesFocus}
                      onChange={handleToggleEscLosesFocus}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>

              <div className="settings-card-divider" />



              {/* Zoom Level */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Zoom</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Adjust the zoom level in the Notes content.
                  </div>
                </div>
                <div className="settings-row-action">
                  <div className="settings-zoom-stepper">
                    <button
                      type="button"
                      className="settings-stepper-btn liquid-btn"
                      onClick={() => handleZoom(1.2)}
                      title="Reset Zoom to 120%"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      type="button"
                      className="settings-stepper-btn liquid-btn"
                      onClick={() => handleZoom(zoomLevel - 0.1)}
                      disabled={zoomLevel <= 0.6}
                      title="Zoom Out"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="settings-zoom-display">
                      {Math.round(zoomLevel * 100)}%
                    </span>
                    <button
                      type="button"
                      className="settings-stepper-btn liquid-btn"
                      onClick={() => handleZoom(zoomLevel + 0.1)}
                      disabled={zoomLevel >= 2.0}
                      title="Zoom In"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── PANE 2: COMMANDS (Raycast Table) ─── */}
        {activePane === "commands" && (
          <div className="settings-pane-content">
            <div className="settings-section-header">
              <h2>Commands</h2>
              <span className="settings-section-subtitle">
                Double-click any shortcut badge to record a new key combination.
              </span>
            </div>

            {[
              { title: "Application & Window Commands", category: "commands" as const, symbol: "⌘" },
              { title: "Text Formatting", category: "formatting" as const, symbol: "B" },
              { title: "Document Editing", category: "editing" as const, symbol: "E" },
              { title: "Extensions", category: "extensions" as const, symbol: "✨" },
            ].map(({ title, category, symbol }, secIdx) => {
              const filtered = commands.filter((c) => c.category === category);
              if (filtered.length === 0) return null;

              return (
                <div key={category} className="settings-command-section" style={{ marginTop: secIdx === 0 ? 0 : 20 }}>
                  <div className="settings-section-header" style={{ marginBottom: 8 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {title}
                    </h3>
                  </div>
                  <div className="settings-card commands-table-card">
                    {filtered.map((cmd, idx, arr) => {
                      const defaultHotkey = DEFAULT_COMMANDS.find((d) => d.id === cmd.id)?.hotkey || "";
                      const isCustom = cmd.hotkey !== defaultHotkey;
                      const isRecording = recordingCommandId === cmd.id;

                      return (
                        <React.Fragment key={cmd.id}>
                          <div className="settings-command-row">
                            <div className="settings-cmd-left">
                              <div className="settings-cmd-icon">
                                {category === "extensions" ? (
                                  <Sparkles size={12} />
                                ) : (
                                  <span className="settings-cmd-icon-symbol">{symbol}</span>
                                )}
                              </div>
                              <span className="settings-cmd-title">{cmd.title}</span>
                            </div>

                            <div className="settings-cmd-right">
                              <div className="settings-cmd-kbd-wrapper">
                                <button
                                  type="button"
                                  className={`settings-cmd-kbd ${isRecording ? "is-recording" : ""}`}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    startRecording(cmd.id);
                                  }}
                                  title="Double-click to record shortcut"
                                >
                                  {isRecording ? (
                                    <span className="flex items-center gap-1.5">
                                      <span className="recording-pulse-dot" />
                                      <span>{recordedModifiers ? `${recordedModifiers}…` : "Press keys…"}</span>
                                    </span>
                                  ) : (
                                    cmd.hotkey || "None"
                                  )}
                                </button>
                                {isCustom && !isRecording && (
                                  <button
                                    type="button"
                                    className="settings-cmd-reset-btn liquid-btn"
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

                              <button
                                type="button"
                                className={`settings-cmd-checkbox ${cmd.enabled ? "is-checked" : ""}`}
                                onClick={() => handleToggleCommand(cmd.id)}
                                aria-label={`Toggle ${cmd.title}`}
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
                </div>
              );
            })}
          </div>
        )}

        {/* ─── PANE 3: ALIASES ─── */}
        {activePane === "aliases" && (
          <div className="settings-pane-content">
            <div className="settings-aliases-toolbar">
              <div className="settings-aliases-search-box">
                <Search size={13} className="settings-aliases-search-icon" />
                <input
                  type="text"
                  placeholder="Filter commands or aliases..."
                  value={aliasSearch}
                  onChange={(e) => setAliasSearch(e.target.value)}
                  className="settings-aliases-search-input"
                  spellCheck={false}
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
                className="settings-action-btn liquid-btn"
                onClick={handleResetAllAliases}
                title="Reset all command aliases to defaults"
              >
                <RotateCcw size={11} />
                <span>Reset Defaults</span>
              </button>
            </div>

            <div className="settings-aliases-hint-bar">
              <Tag size={12} className="settings-aliases-hint-icon" />
              <span>
                Double-click on any alias field to set a shorthand trigger. Press <strong>Enter</strong> to save, <strong>Esc</strong> to cancel.
              </span>
            </div>

            <div className="settings-card commands-table-card">
              {ALL_PALETTE_COMMANDS
                .filter((cmd) => {
                  const q = aliasSearch.trim().toLowerCase();
                  if (!q) return true;
                  const alias = aliases[cmd.id] || "";
                  const shortcutStr = cmd.shortcut ? cmd.shortcut.join("") : "";
                  return (
                    cmd.label.toLowerCase().includes(q) ||
                    cmd.category.toLowerCase().includes(q) ||
                    alias.toLowerCase().includes(q) ||
                    shortcutStr.toLowerCase().includes(q)
                  );
                })
                .map((cmd, idx, arr) => {
                  const currentAlias = aliases[cmd.id];
                  const isEditing = editingAliasId === cmd.id;

                  return (
                    <React.Fragment key={cmd.id}>
                      <div
                        className="settings-command-row settings-alias-row"
                        onDoubleClick={() => !isEditing && handleStartEditAlias(cmd.id)}
                      >
                        <div className="settings-cmd-left min-w-0 flex-1">
                          <span className="settings-alias-cat-badge">{cmd.category}</span>
                          <span className="settings-cmd-title truncate">{cmd.label}</span>
                          {cmd.shortcut && (
                            <div className="settings-alias-shortcut-keys">
                              {cmd.shortcut.map((k, i) => (
                                <kbd key={i}>{k}</kbd>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="settings-cmd-right flex-shrink-0">
                          {isEditing ? (
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
                                placeholder="type alias..."
                                className="settings-alias-input"
                                spellCheck={false}
                                autoComplete="off"
                              />
                            </div>
                          ) : (
                            <div className="settings-alias-display-group">
                              <button
                                type="button"
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handleStartEditAlias(cmd.id);
                                }}
                                onClick={() => {
                                  if (!currentAlias) {
                                    handleStartEditAlias(cmd.id);
                                  }
                                }}
                                className={`settings-alias-badge-btn liquid-btn ${currentAlias ? "has-alias" : "is-empty"}`}
                                title="Double-click to set or edit alias"
                              >
                                {currentAlias ? (
                                  <span className="settings-alias-pill-val">{currentAlias}</span>
                                ) : (
                                  <span className="settings-alias-placeholder">Double-click to set</span>
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
                                  <X size={11} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {idx < arr.length - 1 && <div className="settings-card-divider" />}
                    </React.Fragment>
                  );
                })}
            </div>
          </div>
        )}

        {/* ─── PANE 4: STORAGE & DATA ─── */}
        {activePane === "storage" && (
          <div className="settings-pane-content">
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">SQLite Database Storage</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    All notes are stored strictly locally in high-performance SQLite WAL mode.
                  </div>
                </div>
                <div className="settings-row-action">
                  <button
                    type="button"
                    className="settings-action-btn liquid-btn"
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
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Total Notes</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">Active notes currently stored.</div>
                </div>
                <div className="settings-row-action">
                  <span className="settings-stat-badge text-[12px] [font-weight:600] text-[color:var(--color-accent-text)] [background:var(--color-accent-muted)]">
                    {storageStats ? `${storageStats.notes_count} notes` : "Loading..."}
                  </span>
                </div>
              </div>

              <div className="settings-card-divider" />

              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Export All Notes</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Download every note as a clean GitHub-Flavored Markdown (.md) file.
                  </div>
                </div>
                <div className="settings-row-action">
                  <button
                    type="button"
                    className="settings-action-btn liquid-btn"
                    onClick={handleExportAll}
                  >
                    <FileDown size={13} />
                    <span>Export Markdown</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="settings-card danger-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title danger-title text-[13.5px] [font-weight:600]">Danger Zone</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Permanently delete all notes from your local SQLite database.
                  </div>
                </div>
                <div className="settings-row-action">
                  {!isClearing ? (
                    <button
                      type="button"
                      className="settings-danger-btn liquid-btn"
                      onClick={() => setIsClearing(true)}
                    >
                      <Trash2 size={13} />
                      <span>Clear All Notes</span>
                    </button>
                  ) : (
                    <div className="settings-danger-confirm-group">
                      <label className="settings-danger-checkbox">
                        <input
                          type="checkbox"
                          checked={clearAgreed}
                          onChange={(e) => setClearAgreed(e.target.checked)}
                        />
                        <span>Confirm erase</span>
                      </label>
                      <button
                        type="button"
                        className="settings-danger-btn danger-confirm liquid-btn"
                        disabled={!clearAgreed}
                        onClick={handleClearAllNotes}
                      >
                        Delete All
                      </button>
                      <button
                        type="button"
                        className="settings-stepper-btn liquid-btn"
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

        {/* ─── PANE 4: ABOUT ─── */}
        {activePane === "about" && (
          <div className="settings-pane-content">
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">rayNote</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Version 0.1.0 • macOS Apple Silicon (Universal)
                  </div>
                </div>
                <div className="settings-row-action">
                  <span className="settings-stat-badge text-[12px] [font-weight:600] text-[color:var(--color-accent-text)] [background:var(--color-accent-muted)]">v0.1.0</span>
                </div>
              </div>

              <div className="settings-card-divider" />

              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Architecture</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Ultra-lightweight: 1 primary NSPanel WebView during normal editing.
                    Settings runs on a standard macOS NSWindow on demand and destroys cleanly on close.
                  </div>
                </div>
              </div>

              <div className="settings-card-divider" />

              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">Tech Stack</div>
                  <div className="settings-row-desc text-[12px] text-[color:var(--text-muted)]">
                    Tauri 2 • Rust • SQLite (WAL mode) • React 19 • TipTap Editor • Liquid Glass Design
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
