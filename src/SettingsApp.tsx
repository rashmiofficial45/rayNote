import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
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
  initTheme,
} from "./lib/theme";
import {
  closeSettingsWindow,
  openAppDataFolder,
  getStorageStats,
  StorageStats,
  getAllNotes,
  deleteNote,
  setAlwaysOnTop as setAlwaysOnTopNative,
} from "./lib/db";
import {
  broadcastSync,
  listenToSettingsSync,
  formatKeystrokeFromEvent,
  getKeystrokeModifierString,
} from "./lib/settingsSync";
import { downloadFile, noteContentToMarkdown } from "./lib/utils";

type SettingsPane = "general" | "commands" | "storage" | "about";

const PANES: SettingsPane[] = ["general", "commands", "storage", "about"];

interface CommandRow {
  id: string;
  title: string;
  alias: string;
  hotkey: string;
  enabled: boolean;
  category: "commands" | "extensions";
}

const DEFAULT_COMMANDS: CommandRow[] = [
  { id: "create", title: "Create Note", alias: "", hotkey: "⌘N", enabled: true, category: "commands" },
  { id: "browse", title: "Quick Open / Browse Notes", alias: "", hotkey: "⌘P", enabled: true, category: "commands" },
  { id: "search", title: "Search Notes / Command Palette", alias: "", hotkey: "⌘K", enabled: true, category: "commands" },
  { id: "find", title: "Find in Note", alias: "", hotkey: "⌘F", enabled: true, category: "commands" },
  { id: "duplicate", title: "Duplicate Note", alias: "", hotkey: "⌘D", enabled: true, category: "commands" },
  { id: "pin", title: "Pin / Unpin Note", alias: "", hotkey: "⇧⌘P", enabled: true, category: "commands" },
  { id: "delete", title: "Delete Note", alias: "", hotkey: "⇧⌘⌫", enabled: true, category: "commands" },
  { id: "next_note", title: "Next Note in List", alias: "", hotkey: "⌥↓", enabled: true, category: "commands" },
  { id: "prev_note", title: "Previous Note in List", alias: "", hotkey: "⌥↑", enabled: true, category: "commands" },
  { id: "history_back", title: "Go Back in History", alias: "", hotkey: "⌘[", enabled: true, category: "commands" },
  { id: "history_forward", title: "Go Forward in History", alias: "", hotkey: "⌘]", enabled: true, category: "commands" },
  { id: "copy_markdown", title: "Copy Note as Markdown", alias: "", hotkey: "⇧⌘C", enabled: true, category: "commands" },
  { id: "copy_deeplink", title: "Copy Deeplink", alias: "", hotkey: "⇧⌘D", enabled: true, category: "commands" },
  { id: "export_note", title: "Export Note", alias: "", hotkey: "⇧⌘E", enabled: true, category: "commands" },
  { id: "zoom_in", title: "Zoom In", alias: "", hotkey: "⌘=", enabled: true, category: "commands" },
  { id: "zoom_out", title: "Zoom Out", alias: "", hotkey: "⌘-", enabled: true, category: "commands" },
  { id: "reset_zoom", title: "Reset Zoom", alias: "", hotkey: "⌘0", enabled: true, category: "commands" },
  { id: "shortcuts_help", title: "Shortcuts Cheatsheet", alias: "", hotkey: "⌘/", enabled: true, category: "commands" },
  { id: "settings", title: "Open Settings", alias: "", hotkey: "⌘,", enabled: true, category: "commands" },
  { id: "hide", title: "Hide Window", alias: "", hotkey: "⌘W", enabled: true, category: "commands" },
  { id: "quit", title: "Quit NoteFast", alias: "", hotkey: "⌘Q", enabled: true, category: "commands" },
  { id: "toggle", title: "NoteFast (Toggle Notes)", alias: "ntoe", hotkey: "⌘⇧Space", enabled: true, category: "commands" },
  { id: "slash", title: "Slash Commands Menu", alias: "", hotkey: "/", enabled: true, category: "extensions" },
  { id: "tables", title: "Tables & Embeds", alias: "", hotkey: "/table & /video", enabled: true, category: "extensions" },
];

export default function SettingsApp() {
  // Restore most recently viewed pane (Apple standard)
  const [activePane, setActivePane] = useState<SettingsPane>(() => {
    const saved = localStorage.getItem("notefast_settings_active_pane") as SettingsPane | null;
    if (saved && ["general", "commands", "storage", "about"].includes(saved)) {
      return saved;
    }
    return "general";
  });

  const [paneHistory, setPaneHistory] = useState<SettingsPane[]>([activePane]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Appearance & Theme State
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredThemeMode);
  const [accent, setAccent] = useState<AccentColor>(getStoredAccent);
  const [fontFamily, setFontFamily] = useState<string>(getStoredFont);

  // Zoom State
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = localStorage.getItem("notefast_zoom_level");
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0.6 && parsed <= 2.0) return parsed;
    }
    return 1.2;
  });

  // Toggles State
  const [showMenuBar, setShowMenuBar] = useState<boolean>(() => {
    return localStorage.getItem("notefast_show_menubar") !== "false";
  });
  const [escLosesFocus, setEscLosesFocus] = useState<boolean>(() => {
    return localStorage.getItem("notefast_esc_loses_focus") === "true";
  });
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(() => {
    return localStorage.getItem("notefast_always_on_top") !== "false";
  });

  // Commands state
  const [commands, setCommands] = useState<CommandRow[]>(() => {
    const saved = localStorage.getItem("notefast_commands_config");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return DEFAULT_COMMANDS.map((def) => {
            const found = parsed.find((p: any) => p.id === def.id);
            return found ? { ...def, ...found } : def;
          });
        }
      } catch {
        return DEFAULT_COMMANDS;
      }
    }
    return DEFAULT_COMMANDS;
  });

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
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  // Initialize theme, storage stats, and real-time sync listeners on mount
  useEffect(() => {
    initTheme();
    loadStorageStats();

    return listenToSettingsSync({
      onThemeModeChange: setThemeMode,
      onAccentChange: setAccent,
      onFontChange: setFontFamily,
      onZoomChange: setZoomLevel,
      onEscLosesFocusChange: setEscLosesFocus,
      onAlwaysOnTopChange: setAlwaysOnTop,
      onCommandsConfigChange: setCommands,
    });
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
    localStorage.setItem("notefast_settings_active_pane", pane);

    setPaneHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(pane);
      return next;
    });
    setHistoryIndex((prev) => prev + 1);
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      const targetPane = paneHistory[newIdx];
      setHistoryIndex(newIdx);
      setActivePane(targetPane);
      localStorage.setItem("notefast_settings_active_pane", targetPane);
    }
  };

  const handleForward = () => {
    if (historyIndex < paneHistory.length - 1) {
      const newIdx = historyIndex + 1;
      const targetPane = paneHistory[newIdx];
      setHistoryIndex(newIdx);
      setActivePane(targetPane);
      localStorage.setItem("notefast_settings_active_pane", targetPane);
    }
  };

  const startRecording = (id: string) => {
    setRecordingCommandId(id);
    setRecordedModifiers("");
  };

  const handleUpdateHotkey = useCallback((id: string, newHotkey: string) => {
    setCommands((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, hotkey: newHotkey } : c));
      localStorage.setItem("notefast_commands_config", JSON.stringify(updated));
      broadcastSync({ type: "commands_config", value: updated });
      return updated;
    });
  }, []);

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

  // Keyboard shortcut handler inside Settings (⌘W to close, ⌘, to keep, Esc to close, Left/Right arrow to cycle menu tabs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept while recording a shortcut
      if (recordingCommandId !== null) return;

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

      // Left and Right keys navigate between all menubar options in Settings tab
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        activeEl?.getAttribute("contenteditable") === "true";

      if (!isInput && !isCmd && !e.altKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const curr = PANES.indexOf(activePane);
          const prev = (curr - 1 + PANES.length) % PANES.length;
          handlePaneChange(PANES[prev]);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const curr = PANES.indexOf(activePane);
          const next = (curr + 1) % PANES.length;
          handlePaneChange(PANES[next]);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [paneHistory, historyIndex, activePane, recordingCommandId]);

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

  // Zoom handlers
  const handleZoom = (level: number) => {
    const clamped = Math.max(0.6, Math.min(2.0, Math.round(level * 10) / 10));
    setZoomLevel(clamped);
    localStorage.setItem("notefast_zoom_level", clamped.toString());
    broadcastSync({ type: "zoom", value: clamped });
    window.dispatchEvent(new CustomEvent("notefast_zoom_changed", { detail: { zoom: clamped } }));
  };

  // Toggle handlers
  const handleToggleMenuBar = () => {
    const val = !showMenuBar;
    setShowMenuBar(val);
    localStorage.setItem("notefast_show_menubar", val ? "true" : "false");
  };

  const handleToggleEscLosesFocus = () => {
    const val = !escLosesFocus;
    setEscLosesFocus(val);
    localStorage.setItem("notefast_esc_loses_focus", val ? "true" : "false");
    broadcastSync({ type: "esc_loses_focus", value: val });
  };

  const handleToggleAlwaysOnTop = () => {
    const val = !alwaysOnTop;
    setAlwaysOnTop(val);
    localStorage.setItem("notefast_always_on_top", val ? "true" : "false");
    setAlwaysOnTopNative(val).catch(console.error);
    broadcastSync({ type: "always_on_top", value: val });
  };

  // Toggle command row enabled
  const handleToggleCommand = (id: string) => {
    setCommands((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c));
      localStorage.setItem("notefast_commands_config", JSON.stringify(next));
      broadcastSync({ type: "commands_config", value: next });
      return next;
    });
  };

  // Export All Notes
  const handleExportAll = async () => {
    try {
      const notes = await getAllNotes();
      if (notes.length === 0) {
        setActionMessage("No notes to export.");
        return;
      }

      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const md = noteContentToMarkdown(n.content, n.title);
        const safeTitle = (n.title || `Untitled_${i + 1}`).replace(/[/\\?%*:|"<>]/g, "-");
        downloadFile(`${safeTitle}.md`, md, "text/markdown");
      }
      setActionMessage(`Exported ${notes.length} note(s) as Markdown.`);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error(err);
      setActionMessage("Export failed.");
    }
  };

  // Clear all notes
  const handleClearAllNotes = async () => {
    if (!clearAgreed) return;
    try {
      const notes = await getAllNotes();
      for (const n of notes) {
        await deleteNote(n.id);
      }
      setIsClearing(false);
      setClearAgreed(false);
      loadStorageStats();
      setActionMessage("All notes cleared.");
      setTimeout(() => setActionMessage(null), 3000);
      broadcastSync({ type: "notes_cleared" });
    } catch (err) {
      console.error(err);
      setActionMessage("Failed to clear notes.");
    }
  };

  return (
    <div
      className="settings-window-root"
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (
          !target.closest("button") &&
          !target.closest("input") &&
          !target.closest("select") &&
          !target.closest("textarea") &&
          !target.closest(".settings-tab-pill")
        ) {
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
          if (e.button === 0) {
            invoke("start_native_drag").catch(console.error);
          }
        }
      }}
    >
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
              className={`close-btn-x ${isCloseHovered ? "is-hovered" : ""}`}
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

          <div className="settings-nav-controls" data-tauri-drag-region>
            <button
              type="button"
              className="settings-nav-btn"
              disabled={historyIndex <= 0}
              onClick={handleBack}
              title="Back (⌘[)"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              className="settings-nav-btn"
              disabled={historyIndex >= paneHistory.length - 1}
              onClick={handleForward}
              title="Forward (⌘])"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Tab Pills */}
        <div className="settings-tab-pills" data-tauri-drag-region>
          <button
            type="button"
            className={`settings-tab-pill ${activePane === "general" ? "is-active" : ""}`}
            onClick={() => handlePaneChange("general")}
          >
            <Sliders size={12} />
            <span>General</span>
          </button>
          <button
            type="button"
            className={`settings-tab-pill ${activePane === "commands" ? "is-active" : ""}`}
            onClick={() => handlePaneChange("commands")}
          >
            <Keyboard size={12} />
            <span>Commands</span>
          </button>
          <button
            type="button"
            className={`settings-tab-pill ${activePane === "storage" ? "is-active" : ""}`}
            onClick={() => handlePaneChange("storage")}
          >
            <Database size={12} />
            <span>Storage</span>
          </button>
          <button
            type="button"
            className={`settings-tab-pill ${activePane === "about" ? "is-active" : ""}`}
            onClick={() => handlePaneChange("about")}
          >
            <Info size={12} />
            <span>About</span>
          </button>
        </div>

        {/* Right spacer for symmetrical centering */}
        <div className="settings-header-right-spacer" data-tauri-drag-region />
      </header>

      {/* Main Settings Body */}
      <main className="settings-body-content">
        {/* App Hero Branding (Raycast Style) */}
        <div className="settings-hero" data-tauri-drag-region>
          <div className="settings-hero-icon-wrapper">
            <div className="settings-hero-icon">
              <span className="settings-hero-icon-letter">T</span>
            </div>
          </div>
          <h1 className="settings-hero-title">NoteFast</h1>
          <p className="settings-hero-subtitle">Create and manage your notes.</p>
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
                  <div className="settings-row-title">Appearance</div>
                  <div className="settings-row-desc">
                    Choose between Dark, Light, or automatic macOS system appearance.
                  </div>
                </div>
                <div className="settings-row-action">
                  <div className="settings-segmented-group">
                    <button
                      type="button"
                      className={`settings-seg-btn ${themeMode === "dark" ? "is-active" : ""}`}
                      onClick={() => handleThemeModeChange("dark")}
                    >
                      <Moon size={12} />
                      <span>Dark</span>
                    </button>
                    <button
                      type="button"
                      className={`settings-seg-btn ${themeMode === "light" ? "is-active" : ""}`}
                      onClick={() => handleThemeModeChange("light")}
                    >
                      <Sun size={12} />
                      <span>Light</span>
                    </button>
                    <button
                      type="button"
                      className={`settings-seg-btn ${themeMode === "system" ? "is-active" : ""}`}
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
                  <div className="settings-row-title">Accent Theme</div>
                  <div className="settings-row-desc">
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
                  <div className="settings-row-title">Editor Typography</div>
                  <div className="settings-row-desc">
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
            </div>

            {/* Window & Zoom Card (Raycast Style) */}
            <div className="settings-card">
              {/* Show Notes Toggle Button in Menu Bar */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Show Notes Toggle Button in Menu Bar</div>
                  <div className="settings-row-desc">
                    Display a button in the menu bar to quickly toggle the Notes window.
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
                      onChange={handleToggleEscLosesFocus}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>

              <div className="settings-card-divider" />

              {/* Always on Top */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Always on Top (Auxiliary Panel)</div>
                  <div className="settings-row-desc">
                    Keep NoteFast floating above all workspaces and fullscreen apps.
                  </div>
                </div>
                <div className="settings-row-action">
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={alwaysOnTop}
                      onChange={handleToggleAlwaysOnTop}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>

              <div className="settings-card-divider" />

              {/* Zoom Level */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Zoom</div>
                  <div className="settings-row-desc">
                    Adjust the zoom level in the Notes content.
                  </div>
                </div>
                <div className="settings-row-action">
                  <div className="settings-zoom-stepper">
                    <button
                      type="button"
                      className="settings-stepper-btn"
                      onClick={() => handleZoom(1.2)}
                      title="Reset Zoom to 120%"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      type="button"
                      className="settings-stepper-btn"
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
                      className="settings-stepper-btn"
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

            <div className="settings-card commands-table-card">
              {commands
                .filter((c) => c.category === "commands")
                .map((cmd, idx, arr) => {
                  const defaultHotkey = DEFAULT_COMMANDS.find((d) => d.id === cmd.id)?.hotkey || "";
                  const isCustom = cmd.hotkey !== defaultHotkey;
                  const isRecording = recordingCommandId === cmd.id;

                  return (
                    <React.Fragment key={cmd.id}>
                      <div className="settings-command-row">
                        <div className="settings-cmd-left">
                          <div className="settings-cmd-icon">
                            <span className="settings-cmd-icon-symbol">T</span>
                          </div>
                          <span className="settings-cmd-title">{cmd.title}</span>
                        </div>

                        <div className="settings-cmd-right">
                          <span className={`settings-cmd-alias ${cmd.alias ? "has-alias" : ""}`}>
                            {cmd.alias || "Add Alias"}
                          </span>

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

            <div className="settings-section-header" style={{ marginTop: 24 }}>
              <h2>Extensions & Formatting</h2>
            </div>

            <div className="settings-card commands-table-card">
              {commands
                .filter((c) => c.category === "extensions")
                .map((cmd, idx, arr) => {
                  const defaultHotkey = DEFAULT_COMMANDS.find((d) => d.id === cmd.id)?.hotkey || "";
                  const isCustom = cmd.hotkey !== defaultHotkey;
                  const isRecording = recordingCommandId === cmd.id;

                  return (
                    <React.Fragment key={cmd.id}>
                      <div className="settings-command-row">
                        <div className="settings-cmd-left">
                          <div className="settings-cmd-icon">
                            <Sparkles size={12} />
                          </div>
                          <span className="settings-cmd-title">{cmd.title}</span>
                        </div>

                        <div className="settings-cmd-right">
                          <span className={`settings-cmd-alias ${cmd.alias ? "has-alias" : ""}`}>
                            {cmd.alias || "Add Alias"}
                          </span>

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
        )}

        {/* ─── PANE 3: STORAGE & DATA ─── */}
        {activePane === "storage" && (
          <div className="settings-pane-content">
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">SQLite Database Storage</div>
                  <div className="settings-row-desc">
                    All notes are stored strictly locally in high-performance SQLite WAL mode.
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
                  <div className="settings-row-title">Total Notes</div>
                  <div className="settings-row-desc">Active notes currently stored.</div>
                </div>
                <div className="settings-row-action">
                  <span className="settings-stat-badge">
                    {storageStats ? `${storageStats.notes_count} notes` : "Loading..."}
                  </span>
                </div>
              </div>

              <div className="settings-card-divider" />

              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Export All Notes</div>
                  <div className="settings-row-desc">
                    Download every note as a clean GitHub-Flavored Markdown (.md) file.
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

            {/* Danger Zone */}
            <div className="settings-card danger-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title danger-title">Danger Zone</div>
                  <div className="settings-row-desc">
                    Permanently delete all notes from your local SQLite database.
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
                        className="settings-danger-btn danger-confirm"
                        disabled={!clearAgreed}
                        onClick={handleClearAllNotes}
                      >
                        Delete All
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

        {/* ─── PANE 4: ABOUT ─── */}
        {activePane === "about" && (
          <div className="settings-pane-content">
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">NoteFast</div>
                  <div className="settings-row-desc">
                    Version 0.1.0 • macOS Apple Silicon (Universal)
                  </div>
                </div>
                <div className="settings-row-action">
                  <span className="settings-stat-badge">v0.1.0</span>
                </div>
              </div>

              <div className="settings-card-divider" />

              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Architecture</div>
                  <div className="settings-row-desc">
                    Ultra-lightweight: 1 primary NSPanel WebView during normal editing.
                    Settings runs on a standard macOS NSWindow on demand and destroys cleanly on close.
                  </div>
                </div>
              </div>

              <div className="settings-card-divider" />

              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">Tech Stack</div>
                  <div className="settings-row-desc">
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
