import { useState, useEffect, useRef, useCallback } from "react";
import { NoteSummary, hideWindow, quitApp, openSettingsWindow, searchNotes } from "../lib/db";
import { getNoteTitle, formatDate } from "../lib/utils";
import {
  Plus,
  Copy,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Search,
  ClipboardCopy,
  FileText,
  Link2,
  FileDown,
  Trash2,
  Pin,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Keyboard,
  ArrowUp,
  ArrowDown,
  Sparkles,
  X,
  Power,
  Palette,
  Type,
  Sun,
  Moon,
  Monitor,
  Settings,
  FolderOpen,
  Upload,
  Eye,
  Sliders,
  Check,
  AlertTriangle,
} from "lucide-react";
import {
  ACCENT_OPTIONS,
  FONT_OPTIONS,
  AccentColor,
  ThemeMode,
  setStoredAccent,
  getStoredAccent,
  setStoredFont,
  getStoredFont,
  setStoredThemeMode,
  getStoredThemeMode,
} from "../lib/theme";
import { broadcastSync, listenToSettingsSync } from "../lib/settingsSync";
import { getStoredAliases } from "../lib/aliases";
import { invoke } from "@tauri-apps/api/core";

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  notes: NoteSummary[];
  activeNoteId: string | null;
  initialView?: "actions" | "browse" | "settings";
  zoomLevel: number;
  onNewNote: () => void;
  onDuplicateNote: () => void;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onTogglePin: (id: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onFindInNote?: () => void;
  onCopyNoteAsMarkdown?: () => void;
  onCopyNoteAsText?: () => void;
  onCopyDeeplink?: () => void;
  onExportNote?: () => void;
  onExportAllNotes?: () => void;
  onShowToast?: (message: string, icon?: React.ReactNode) => void;
  onPreviousNote?: () => void;
  onNextNote?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onSetZoom?: (zoom: number) => void;
  onShowShortcuts?: () => void;
  onTriggerImportFile?: () => void;
  onTriggerViewFile?: () => void;
  onPromptClearAllNotes?: () => void;
}

type PaletteView = "actions" | "browse" | "settings" | "sub_appearance" | "sub_accents" | "sub_fonts" | "sub_zoom";

export interface ActionItem {
  id: string;
  category: string;
  label: string;
  subtitle?: string;
  badge?: string;
  keywords?: string[];
  icon: React.ReactNode;
  shortcut?: string[];
  disabled?: boolean;
  action: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  notes,
  activeNoteId,
  initialView = "actions",
  zoomLevel,
  onNewNote,
  onDuplicateNote,
  onSelectNote,
  onDeleteNote,
  onTogglePin,
  onGoBack,
  onGoForward,
  onFindInNote,
  onCopyNoteAsMarkdown,
  onCopyNoteAsText,
  onCopyDeeplink,
  onExportNote,
  onExportAllNotes,
  onShowToast,
  onPreviousNote,
  onNextNote,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onSetZoom,
  onShowShortcuts,
  onTriggerImportFile,
  onTriggerViewFile,
  onPromptClearAllNotes,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<PaletteView>(initialView);
  const [ftsResults, setFtsResults] = useState<NoteSummary[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Trigger background SQLite FTS5 search when in browse view
  useEffect(() => {
    const q = search.trim();
    if (!q || view !== "browse") {
      setFtsResults(null);
      return;
    }

    const timer = setTimeout(() => {
      searchNotes(q)
        .then((results) => {
          setFtsResults(results);
        })
        .catch((err) => {
          console.error("FTS5 search error:", err);
        });
    }, 120);

    return () => clearTimeout(timer);
  }, [search, view]);

  // Live settings state for immediate badge/toggle feedback
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(getStoredThemeMode);
  const [currentAccent, setCurrentAccent] = useState<AccentColor>(getStoredAccent);
  const [currentFont, setCurrentFont] = useState<string>(getStoredFont);
  const [escLosesFocus, setEscLosesFocus] = useState<boolean>(() => {
    return localStorage.getItem("notefast_esc_loses_focus") === "true";
  });
  const [showMenuBar, setShowMenuBar] = useState<boolean>(() => {
    return localStorage.getItem("notefast_show_menubar") !== "false";
  });
  const [aliases, setAliases] = useState<Record<string, string>>(getStoredAliases);

  useEffect(() => {
    return listenToSettingsSync({
      onAliasesConfigChange: (newAliases) => {
        setAliases(newAliases || {});
      },
      onThemeModeChange: (mode) => setCurrentTheme(mode),
      onAccentChange: (acc) => setCurrentAccent(acc),
      onFontChange: (f) => setCurrentFont(f),
      onEscLosesFocusChange: (v) => setEscLosesFocus(v),
    });
  }, []);

  const activeNote = notes.find((n) => n.id === activeNoteId);

  // Immediate Action Handlers
  const handleApplyTheme = (mode: ThemeMode) => {
    setStoredThemeMode(mode);
    setCurrentTheme(mode);
    broadcastSync({ type: "theme_mode", value: mode });
    onShowToast?.(`Appearance set to ${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode`, <Sun size={14} />);
    onClose();
  };

  const handleApplyAccent = (acc: AccentColor) => {
    setStoredAccent(acc);
    setCurrentAccent(acc);
    broadcastSync({ type: "accent", value: acc });
    const name = ACCENT_OPTIONS.find((a) => a.id === acc)?.name || acc;
    onShowToast?.(`Accent theme set to ${name}`, <Palette size={14} />);
    onClose();
  };

  const handleApplyFont = (fontId: string) => {
    setStoredFont(fontId);
    setCurrentFont(fontId);
    broadcastSync({ type: "font", value: fontId });
    const name = FONT_OPTIONS.find((f) => f.id === fontId)?.name || fontId;
    onShowToast?.(`Font set to ${name}`, <Type size={14} />);
    onClose();
  };

  const handleApplyZoom = (zoom: number) => {
    const clamped = Math.max(0.6, Math.min(2.0, Math.round(zoom * 10) / 10));
    onSetZoom?.(clamped);
    localStorage.setItem("notefast_zoom_level", clamped.toString());
    broadcastSync({ type: "zoom", value: clamped });
    onShowToast?.(`Zoom set to ${Math.round(clamped * 100)}%`, <ZoomIn size={14} />);
    onClose();
  };

  const handleToggleEscLosesFocus = () => {
    const val = !escLosesFocus;
    setEscLosesFocus(val);
    localStorage.setItem("notefast_esc_loses_focus", val ? "true" : "false");
    broadcastSync({ type: "esc_loses_focus", value: val });
    onShowToast?.(
      val
        ? "Escape key will now drop focus (not hide)"
        : "Escape key will now hide Notes window"
    );
    onClose();
  };

  const handleToggleMenuBar = () => {
    const val = !showMenuBar;
    setShowMenuBar(val);
    localStorage.setItem("notefast_show_menubar", val ? "true" : "false");
    invoke("set_menu_bar_visible", { visible: val }).catch(console.error);
    onShowToast?.(
      val ? "Menu bar toggle button enabled" : "Menu bar toggle button disabled"
    );
    onClose();
  };

  // Main Action List (Streamlined, Minimal, Zero Subtitles)
  const actions: ActionItem[] = [
    // ─── 1. FILE OPERATIONS ───
    {
      id: "upload-md-file",
      category: "File Operations",
      label: "Import Markdown File",
      badge: "Import",
      keywords: ["upload", "import", "local", "file", "markdown", "md", "open", "read", "mac", "disk"],
      icon: <Upload size={14} className="text-sky-400" />,
      action: () => {
        onClose();
        onTriggerImportFile?.();
      },
    },
    {
      id: "view-md-file-no-upload",
      category: "File Operations",
      label: "Quick View Markdown File",
      badge: "Preview",
      keywords: ["view", "preview", "read", "inspect", "scratch", "no upload", "without saving", "local", "md", "file"],
      icon: <Eye size={14} className="text-violet-400" />,
      action: () => {
        onClose();
        onTriggerViewFile?.();
      },
    },
    {
      id: "copy-md",
      category: "File Operations",
      label: "Copy Note as Markdown",
      badge: "GFM",
      icon: <ClipboardCopy size={14} className="text-emerald-400" />,
      shortcut: ["⇧", "⌘", "C"],
      disabled: !activeNoteId,
      keywords: ["copy", "markdown", "md", "clipboard", "format", "whole", "all"],
      action: () => {
        onClose();
        onCopyNoteAsMarkdown?.();
      },
    },
    {
      id: "copy-txt",
      category: "File Operations",
      label: "Copy Note as Plain Text",
      icon: <FileText size={14} />,
      disabled: !activeNoteId,
      keywords: ["copy", "plain", "text", "raw"],
      action: () => {
        onClose();
        onCopyNoteAsText?.();
      },
    },
    {
      id: "copy-deeplink",
      category: "File Operations",
      label: "Copy Note Deeplink",
      icon: <Link2 size={14} />,
      shortcut: ["⇧", "⌘", "D"],
      disabled: !activeNoteId,
      keywords: ["deeplink", "link", "url", "raycast", "alfred", "shortcut"],
      action: () => {
        onClose();
        onCopyDeeplink?.();
      },
    },
    {
      id: "export-single",
      category: "File Operations",
      label: "Export Note as Markdown",
      badge: "Download",
      icon: <FileDown size={14} />,
      shortcut: ["⇧", "⌘", "E"],
      disabled: !activeNoteId,
      keywords: ["export", "markdown", "md", "save", "download", "file"],
      action: () => {
        onClose();
        onExportNote?.();
      },
    },
    {
      id: "export-all",
      category: "File Operations",
      label: "Export All Notes",
      badge: "Batch",
      icon: <FileDown size={14} />,
      disabled: notes.length === 0,
      keywords: ["export", "all", "markdown", "md", "save", "download", "backup", "batch", "finder"],
      action: () => {
        onClose();
        onExportAllNotes?.();
      },
    },

    // ─── 2. SETTINGS: APPEARANCE & THEME ───
    {
      id: "sub-appearance-picker",
      category: "Appearance",
      label: "Appearance Mode (Dark / Light / System)",
      badge: "Submenu",
      icon: <Sun size={14} className="text-amber-400" />,
      keywords: ["appearance", "theme", "dark", "light", "system", "mode", "color", "choose", "select", "options", "submenu"],
      action: () => {
        setView("sub_appearance");
        setSearch("");
        setSelectedIndex(0);
      },
    },
    {
      id: "sub-theme-picker",
      category: "Appearance",
      label: "Accent Theme Color",
      badge: "Submenu",
      icon: <Palette size={14} style={{ color: "var(--color-accent)" }} />,
      keywords: ["accent", "theme", "color", "palette", "choose", "select", "options", "liquid", "glass"],
      action: () => {
        setView("sub_accents");
        setSearch("");
        setSelectedIndex(0);
      },
    },
    {
      id: "sub-font-picker",
      category: "Appearance",
      label: "Editor Font Family",
      badge: "Submenu",
      icon: <Type size={14} />,
      keywords: ["font", "typeface", "typography", "text", "choose", "select", "options", "mono", "jetbrains", "inter", "outfit"],
      action: () => {
        setView("sub_fonts");
        setSearch("");
        setSelectedIndex(0);
      },
    },
    {
      id: "sub-zoom-picker",
      category: "Appearance",
      label: "Zoom Level Options",
      badge: "Submenu",
      icon: <Sliders size={14} />,
      keywords: ["zoom", "scale", "size", "magnify", "adjust", "options", "80", "100", "120", "140", "160"],
      action: () => {
        setView("sub_zoom");
        setSearch("");
        setSelectedIndex(0);
      },
    },
    {
      id: "zoom-in-step",
      category: "Appearance",
      label: "Zoom In (+10%)",
      icon: <ZoomIn size={14} />,
      shortcut: ["⌘", "="],
      keywords: ["zoom in", "bigger", "enlarge", "plus"],
      action: () => {
        onClose();
        onZoomIn?.();
      },
    },
    {
      id: "zoom-out-step",
      category: "Appearance",
      label: "Zoom Out (-10%)",
      icon: <ZoomOut size={14} />,
      shortcut: ["⌘", "-"],
      keywords: ["zoom out", "smaller", "shrink", "minus"],
      action: () => {
        onClose();
        onZoomOut?.();
      },
    },
    {
      id: "zoom-reset-step",
      category: "Appearance",
      label: "Reset Zoom (120%)",
      icon: <RotateCcw size={14} />,
      shortcut: ["⌘", "0"],
      keywords: ["reset zoom", "default", "normal", "120%"],
      action: () => {
        onClose();
        onResetZoom?.();
      },
    },

    // ─── 3. PREFERENCES & WINDOW ───
    {
      id: "toggle-esc-loses-focus",
      category: "Preferences",
      label: `Escape Key: ${escLosesFocus ? "Drops Focus" : "Hides Window"}`,
      badge: escLosesFocus ? "Lose Focus" : "Hide",
      icon: <Keyboard size={14} />,
      keywords: ["escape", "esc", "focus", "lose focus", "hide", "blur"],
      action: handleToggleEscLosesFocus,
    },
    {
      id: "toggle-menu-bar",
      category: "Preferences",
      label: `Menu Bar Icon: ${showMenuBar ? "Visible" : "Hidden"}`,
      badge: showMenuBar ? "Visible" : "Hidden",
      icon: <Sliders size={14} />,
      keywords: ["menu bar", "status bar", "tray", "icon", "toggle", "macos", "menubar"],
      action: handleToggleMenuBar,
    },
    {
      id: "toggle-smooth-caret",
      category: "Preferences",
      label: "Smooth Cursor Caret",
      badge: (typeof window !== "undefined" && localStorage.getItem("notefast_smooth_caret") === "false") ? "OFF" : "ON",
      icon: <Sparkles size={14} />,
      keywords: ["cursor", "caret", "smooth", "animation", "vscode", "typing"],
      action: () => {
        const current = localStorage.getItem("notefast_smooth_caret") !== "false";
        const next = !current;
        localStorage.setItem("notefast_smooth_caret", String(next));
        document.documentElement.dataset.smoothCaret = String(next);
        window.dispatchEvent(
          new CustomEvent("notefast_toggle_smooth_caret", { detail: { enabled: next } })
        );
        onShowToast?.(
          next ? "Smooth Caret Animation Enabled" : "Smooth Caret Animation Disabled",
          <Sparkles size={14} />
        );
        onClose();
      },
    },
    {
      id: "open-finder-storage",
      category: "Storage",
      label: "Open Storage in Finder",
      badge: "Local",
      icon: <FolderOpen size={14} />,
      keywords: ["storage", "finder", "folder", "sqlite", "database", "file", "open", "data"],
      action: () => {
        onClose();
        invoke("open_app_data_folder").catch(console.error);
      },
    },
    {
      id: "danger-clear-notes",
      category: "Storage",
      label: "Clear All Notes…",
      badge: "Danger",
      icon: <AlertTriangle size={14} className="text-red-400" />,
      keywords: ["clear", "delete all", "erase", "danger", "reset", "wipe"],
      action: () => {
        onClose();
        onPromptClearAllNotes?.();
      },
    },

    // ─── 4. NOTE ACTIONS ───
    {
      id: "new-note",
      category: "Note Actions",
      label: "New Note",
      icon: <Plus size={14} />,
      shortcut: ["⌘", "N"],
      keywords: ["new", "create", "note", "add"],
      action: () => {
        onNewNote();
        onClose();
      },
    },
    {
      id: "browse-notes",
      category: "Note Actions",
      label: "Browse Notes List",
      icon: <BookOpen size={14} />,
      shortcut: ["⌘", "P"],
      keywords: ["browse", "switch", "open", "notes", "list", "find"],
      action: () => {
        setView("browse");
        setSearch("");
        setSelectedIndex(0);
      },
    },
    {
      id: "find-in-note",
      category: "Note Actions",
      label: "Find in Current Note",
      icon: <Search size={14} />,
      shortcut: ["⌘", "F"],
      disabled: !activeNoteId,
      keywords: ["find", "search", "in note", "text", "replace"],
      action: () => {
        onClose();
        onFindInNote?.();
      },
    },
    {
      id: "duplicate-note",
      category: "Note Actions",
      label: "Duplicate Note",
      icon: <Copy size={14} />,
      shortcut: ["⌘", "D"],
      disabled: !activeNoteId,
      keywords: ["duplicate", "clone", "copy note"],
      action: () => {
        onDuplicateNote();
        onClose();
      },
    },
    {
      id: "pin-note",
      category: "Note Actions",
      label: activeNote?.is_pinned ? "Unpin Note from Top" : "Pin Note to Top",
      icon: <Pin size={14} />,
      shortcut: ["⇧", "⌘", "P"],
      disabled: !activeNoteId,
      keywords: ["pin", "unpin", "top", "sticky", "favorite"],
      action: () => {
        if (activeNoteId) {
          onTogglePin(activeNoteId);
          onClose();
        }
      },
    },
    {
      id: "delete-note",
      category: "Note Actions",
      label: "Delete Note",
      icon: <Trash2 size={14} className="text-red-400" />,
      shortcut: ["⇧", "⌘", "⌫"],
      disabled: !activeNoteId,
      keywords: ["delete", "trash", "remove", "erase"],
      action: () => {
        if (activeNoteId) {
          onDeleteNote(activeNoteId);
          onClose();
        }
      },
    },
    {
      id: "prev-note",
      category: "Note Actions",
      label: "Previous Note in List",
      icon: <ArrowUp size={14} />,
      shortcut: ["⌥", "↑"],
      keywords: ["previous", "prev", "up", "note"],
      action: () => {
        onClose();
        onPreviousNote?.();
      },
    },
    {
      id: "next-note",
      category: "Note Actions",
      label: "Next Note in List",
      icon: <ArrowDown size={14} />,
      shortcut: ["⌥", "↓"],
      keywords: ["next", "down", "note"],
      action: () => {
        onClose();
        onNextNote?.();
      },
    },
    {
      id: "history-back",
      category: "Note Actions",
      label: "Go Back in History",
      icon: <ChevronLeft size={14} />,
      shortcut: ["⌘", "["],
      keywords: ["back", "history"],
      action: () => {
        onGoBack();
        onClose();
      },
    },
    {
      id: "history-forward",
      category: "Note Actions",
      label: "Go Forward in History",
      icon: <ChevronRight size={14} />,
      shortcut: ["⌘", "]"],
      keywords: ["forward", "history"],
      action: () => {
        onGoForward();
        onClose();
      },
    },

    // ─── 5. APP CONTROLS ───
    {
      id: "open-full-settings",
      category: "App Controls",
      label: "Open Settings Window",
      badge: "Window",
      icon: <Settings size={14} />,
      shortcut: ["⌘", ","],
      keywords: ["settings", "preferences", "config", "window", "options", "setup", "aliases"],
      action: () => {
        onClose();
        openSettingsWindow().catch(console.error);
      },
    },
    {
      id: "shortcuts-sheet",
      category: "App Controls",
      label: "Shortcuts Cheatsheet",
      icon: <Keyboard size={14} />,
      shortcut: ["⌘", "/"],
      keywords: ["shortcuts", "cheatsheet", "hotkeys", "keys", "help"],
      action: () => {
        onClose();
        onShowShortcuts?.();
      },
    },
    {
      id: "hide-window",
      category: "App Controls",
      label: "Hide Window",
      icon: <X size={14} />,
      shortcut: ["⌘", "W"],
      keywords: ["hide", "close", "minimize", "dismiss", "background"],
      action: () => {
        onClose();
        hideWindow().catch(console.error);
      },
    },
    {
      id: "quit-app",
      category: "App Controls",
      label: "Quit rayNote",
      icon: <Power size={14} className="text-red-400" />,
      shortcut: ["⌘", "Q"],
      keywords: ["quit", "exit", "close app", "terminate", "kill"],
      action: () => {
        quitApp().catch(console.error);
      },
    },
  ];

  // Sub-view: Appearance mode options
  const appearanceSubActions: ActionItem[] = [
    {
      id: "sub-app-dark",
      category: "Appearance",
      label: "Dark Mode",
      badge: currentTheme === "dark" ? "Selected" : undefined,
      icon: <Moon size={14} className="text-indigo-400" />,
      keywords: ["dark", "mode", "night", "black", "obsidian"],
      action: () => handleApplyTheme("dark"),
    },
    {
      id: "sub-app-light",
      category: "Appearance",
      label: "Light Mode",
      badge: currentTheme === "light" ? "Selected" : undefined,
      icon: <Sun size={14} className="text-amber-400" />,
      keywords: ["light", "mode", "day", "white", "bright"],
      action: () => handleApplyTheme("light"),
    },
    {
      id: "sub-app-system",
      category: "Appearance",
      label: "System Auto (Follow macOS)",
      badge: currentTheme === "system" ? "Selected" : undefined,
      icon: <Monitor size={14} className="text-sky-400" />,
      keywords: ["system", "auto", "mac", "os", "match"],
      action: () => handleApplyTheme("system"),
    },
  ];

  // Sub-view: Accent color options
  const accentSubActions: ActionItem[] = ACCENT_OPTIONS.map((acc) => ({
    id: `sub-acc-${acc.id}`,
    category: "Accent Themes",
    label: acc.name,
    badge: currentAccent === acc.id ? "Selected" : undefined,
    icon: (
      <span
        className="w-4 h-4 rounded-full inline-block border-2 border-white/30 shadow-md"
        style={{ backgroundColor: acc.color }}
      />
    ),
    keywords: ["accent", "theme", "color", acc.name.toLowerCase()],
    action: () => handleApplyAccent(acc.id),
  }));

  // Sub-view: Font options
  const fontSubActions: ActionItem[] = FONT_OPTIONS.map((font) => ({
    id: `sub-font-${font.id}`,
    category: "Editor Fonts",
    label: font.name,
    badge: currentFont === font.id ? "Selected" : undefined,
    icon: <Type size={14} />,
    keywords: ["font", font.name.toLowerCase()],
    action: () => handleApplyFont(font.id),
  }));

  // Sub-view: Zoom options
  const zoomSubActions: ActionItem[] = [
    {
      id: "sub-z-80",
      category: "Zoom Levels",
      label: "80% (Compact)",
      badge: Math.round(zoomLevel * 100) === 80 ? "Selected" : undefined,
      icon: <ZoomOut size={14} />,
      action: () => handleApplyZoom(0.8),
    },
    {
      id: "sub-z-100",
      category: "Zoom Levels",
      label: "100% (Standard)",
      badge: Math.round(zoomLevel * 100) === 100 ? "Selected" : undefined,
      icon: <ZoomIn size={14} />,
      action: () => handleApplyZoom(1.0),
    },
    {
      id: "sub-z-120",
      category: "Zoom Levels",
      label: "120% (Default)",
      badge: Math.round(zoomLevel * 100) === 120 ? "Selected" : undefined,
      icon: <RotateCcw size={14} />,
      action: () => handleApplyZoom(1.2),
    },
    {
      id: "sub-z-140",
      category: "Zoom Levels",
      label: "140% (Enlarged)",
      badge: Math.round(zoomLevel * 100) === 140 ? "Selected" : undefined,
      icon: <ZoomIn size={14} />,
      action: () => handleApplyZoom(1.4),
    },
    {
      id: "sub-z-160",
      category: "Zoom Levels",
      label: "160% (Large)",
      badge: Math.round(zoomLevel * 100) === 160 ? "Selected" : undefined,
      icon: <ZoomIn size={14} />,
      action: () => handleApplyZoom(1.6),
    },
  ];

  // Filtering with Alias Support and Prioritization
  const filterList = (list: ActionItem[]) => {
    const q = search.toLowerCase().trim();
    if (!q) return list;

    const matched = list.filter((a) => {
      const alias = (aliases[a.id] || "").toLowerCase();
      if (alias && (alias === q || alias.startsWith(q) || alias.includes(q))) return true;
      if (a.label.toLowerCase().includes(q)) return true;
      if (a.category.toLowerCase().includes(q)) return true;
      if (a.badge && a.badge.toLowerCase().includes(q)) return true;
      if (a.keywords && a.keywords.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });

    // Prioritize exact alias match or alias prefix match
    return matched.sort((a, b) => {
      const aAlias = (aliases[a.id] || "").toLowerCase();
      const bAlias = (aliases[b.id] || "").toLowerCase();
      const aExact = aAlias === q;
      const bExact = bAlias === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      const aPrefix = aAlias.startsWith(q);
      const bPrefix = bAlias.startsWith(q);
      if (aPrefix && !bPrefix) return -1;
      if (!aPrefix && bPrefix) return 1;
      return 0;
    });
  };

  const filteredActions = filterList(actions);
  const filteredAppearance = filterList(appearanceSubActions);
  const filteredAccents = filterList(accentSubActions);
  const filteredFonts = filterList(fontSubActions);
  const filteredZoom = filterList(zoomSubActions);

  // 1. Instant local metadata search (0ms)
  const localFilteredNotes = notes.filter((n) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const title = getNoteTitle(n.title, n.preview).toLowerCase();
    const preview = (n.preview || "").toLowerCase();
    return title.includes(q) || preview.includes(q);
  });

  // 2. Seamlessly merge with deep SQLite FTS5 search results
  const filteredNotes = (() => {
    if (!ftsResults || ftsResults.length === 0) {
      return localFilteredNotes;
    }
    const seen = new Set(localFilteredNotes.map((n) => n.id));
    const merged = [...localFilteredNotes];
    for (const r of ftsResults) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    return merged;
  })();

  const getActiveItems = () => {
    switch (view) {
      case "browse":
        return filteredNotes;
      case "sub_appearance":
        return filteredAppearance;
      case "sub_accents":
        return filteredAccents;
      case "sub_fonts":
        return filteredFonts;
      case "sub_zoom":
        return filteredZoom;
      case "actions":
      default:
        return filteredActions;
    }
  };

  const listRef = useRef<HTMLDivElement>(null);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleItemMouseMove = useCallback((idx: number, e: React.MouseEvent) => {
    const dx = Math.abs(e.clientX - lastMousePosRef.current.x);
    const dy = Math.abs(e.clientY - lastMousePosRef.current.y);
    if (dx > 3 || dy > 3) {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      setSelectedIndex((prev) => (prev === idx ? prev : idx));
    }
  }, []);

  const isSubView =
    view === "sub_appearance" ||
    view === "sub_accents" ||
    view === "sub_fonts" ||
    view === "sub_zoom";

  const currentItems = getActiveItems();

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setView(initialView);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen, initialView]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search, view]);

  // Auto-scroll selected item into view instantly
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector(".is-selected") as HTMLElement | null;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (view !== "actions" && initialView === "actions") {
          setView("actions");
          setSearch("");
          setSelectedIndex(0);
        } else {
          onClose();
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        setView((prev) => (prev === "actions" ? "browse" : "actions"));
        setSearch("");
        setSelectedIndex(0);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i < currentItems.length - 1 ? i + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i > 0 ? i - 1 : Math.max(0, currentItems.length - 1)));
        return;
      }
      if (e.key === "Backspace" && isSubView && !search) {
        e.preventDefault();
        e.stopPropagation();
        setView("actions");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (view === "browse") {
          const note = filteredNotes[selectedIndex];
          if (note) {
            onSelectNote(note.id);
            onClose();
          }
        } else {
          const list =
            view === "sub_appearance"
              ? filteredAppearance
              : view === "sub_accents"
                ? filteredAccents
                : view === "sub_fonts"
                  ? filteredFonts
                  : view === "sub_zoom"
                    ? filteredZoom
                    : filteredActions;

          const action = list[selectedIndex];
          if (action && !action.disabled) action.action();
        }
        return;
      }
    },
    [
      view,
      initialView,
      isSubView,
      search,
      currentItems.length,
      selectedIndex,
      filteredActions,
      filteredAppearance,
      filteredAccents,
      filteredFonts,
      filteredZoom,
      filteredNotes,
      onClose,
      onSelectNote,
    ]
  );

  if (!isOpen) return null;

  return (
    <div className="command-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="command-search">
          {isSubView ? (
            <button
              type="button"
              className="mr-1.5 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg)] transition-colors"
              onClick={() => {
                setView("actions");
                setSearch("");
              }}
              title="Back to All Actions (Backspace)"
            >
              <ChevronLeft size={16} />
            </button>
          ) : (
            <Search size={14} className="text-[var(--text-muted)] flex-shrink-0" />
          )}

          <input
            ref={inputRef}
            type="text"
            onKeyDown={handleKeyDown}
            placeholder={
              view === "actions"
                ? "Search commands & settings…"
                : view === "browse"
                  ? "Search notes by title or content…"
                  : view === "sub_appearance"
                    ? "Choose appearance (Dark, Light, System)…"
                    : view === "sub_accents"
                      ? "Search accent themes…"
                      : view === "sub_fonts"
                        ? "Search typography…"
                        : "Search zoom levels…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />

          {isSubView ? (
            <button
              type="button"
              className="command-view-switch-btn"
              onClick={() => {
                setView("actions");
                setSearch("");
              }}
            >
              ← Back to Actions
            </button>
          ) : (
            <button
              type="button"
              className="command-view-switch-btn"
              onClick={() => {
                setView((prev) => (prev === "actions" ? "browse" : "actions"));
                setSearch("");
                setTimeout(() => inputRef.current?.focus(), 20);
              }}
              title="Press Tab to switch mode"
            >
              {view === "actions" ? "Notes (⌘P)" : "Commands (⌘K)"}
            </button>
          )}
        </div>

        {/* List of actions or notes */}
        <div className="command-list" ref={listRef}>
          {/* Actions & Settings View */}
          {view === "actions" &&
            filteredActions.map((item, idx) => {
              // Group divider header when category changes
              const prevItem = filteredActions[idx - 1];
              const showCategoryHeader = !search.trim() && (!prevItem || prevItem.category !== item.category);
              const itemAlias = aliases[item.id];

              return (
                <div key={item.id}>
                  {showCategoryHeader && (
                    <div className="command-category-header">
                      {item.category}
                    </div>
                  )}
                  <button
                    className={`command-item ${idx === selectedIndex ? "is-selected" : ""}`}
                    onClick={() => {
                      if (!item.disabled) item.action();
                    }}
                    onMouseMove={(e) => handleItemMouseMove(idx, e)}
                    style={item.disabled ? { opacity: 0.35, cursor: "default" } : undefined}
                  >
                    <div className="command-item-icon">{item.icon}</div>
                    <div className="command-item-text flex items-center min-w-0 flex-1">
                      <span className={`command-item-label truncate ${item.disabled ? "disabled" : ""}`}>
                        {item.label}
                      </span>
                    </div>
                    {(itemAlias || item.badge || item.shortcut) && (
                      <div className="command-item-meta">
                        {itemAlias && (
                          <span className="command-alias-badge" title={`Alias: ${itemAlias}`}>
                            {itemAlias}
                          </span>
                        )}
                        {item.badge && (
                          <span className={`command-badge ${item.badge === "ON" ? "is-on" : ""}`}>
                            {item.badge}
                          </span>
                        )}
                        {item.shortcut && (
                          <div className="command-item-shortcut">
                            {item.shortcut.map((k, i) => (
                              <kbd key={i}>{k}</kbd>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}

          {/* Sub-View: Appearance (Dark / Light / System) */}
          {view === "sub_appearance" && (
            <div>
              <div className="command-category-header">Select Appearance Mode</div>
              {filteredAppearance.map((item, idx) => (
                <button
                  key={item.id}
                  className={`command-item ${idx === selectedIndex ? "is-selected" : ""}`}
                  onClick={() => item.action()}
                  onMouseMove={(e) => handleItemMouseMove(idx, e)}
                >
                  <div className="command-item-icon">{item.icon}</div>
                  <div className="command-item-text flex items-center min-w-0 flex-1">
                    <span className="command-item-label truncate">{item.label}</span>
                  </div>
                  {item.badge && <Check size={14} className="text-emerald-400 ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}

          {/* Sub-View: Accents */}
          {view === "sub_accents" && (
            <div>
              <div className="command-category-header">Select Accent Theme</div>
              {filteredAccents.map((item, idx) => (
                <button
                  key={item.id}
                  className={`command-item ${idx === selectedIndex ? "is-selected" : ""}`}
                  onClick={() => item.action()}
                  onMouseMove={(e) => handleItemMouseMove(idx, e)}
                >
                  <div className="command-item-icon">{item.icon}</div>
                  <div className="command-item-text flex items-center min-w-0 flex-1">
                    <span className="command-item-label truncate">{item.label}</span>
                  </div>
                  {item.badge && <Check size={14} className="text-emerald-400 ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}

          {/* Sub-View: Fonts */}
          {view === "sub_fonts" && (
            <div>
              <div className="command-category-header">Select Editor Font</div>
              {filteredFonts.map((item, idx) => (
                <button
                  key={item.id}
                  className={`command-item ${idx === selectedIndex ? "is-selected" : ""}`}
                  onClick={() => item.action()}
                  onMouseMove={(e) => handleItemMouseMove(idx, e)}
                >
                  <div className="command-item-icon">{item.icon}</div>
                  <div className="command-item-text flex items-center min-w-0 flex-1">
                    <span className="command-item-label truncate">{item.label}</span>
                  </div>
                  {item.badge && <Check size={14} className="text-emerald-400 ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}

          {/* Sub-View: Zoom */}
          {view === "sub_zoom" && (
            <div>
              <div className="command-category-header">Select Zoom Level</div>
              {filteredZoom.map((item, idx) => (
                <button
                  key={item.id}
                  className={`command-item ${idx === selectedIndex ? "is-selected" : ""}`}
                  onClick={() => item.action()}
                  onMouseMove={(e) => handleItemMouseMove(idx, e)}
                >
                  <div className="command-item-icon">{item.icon}</div>
                  <div className="command-item-text flex items-center min-w-0 flex-1">
                    <span className="command-item-label truncate">{item.label}</span>
                  </div>
                  {item.badge && <Check size={14} className="text-emerald-400 ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}

          {/* Browse Notes View */}
          {view === "browse" &&
            filteredNotes.map((note, idx) => (
              <button
                key={note.id}
                className={`browse-note-item ${idx === selectedIndex ? "is-selected" : ""} ${note.id === activeNoteId ? "is-active" : ""
                  }`}
                onClick={() => {
                  onSelectNote(note.id);
                  onClose();
                }}
                onMouseMove={(e) => handleItemMouseMove(idx, e)}
              >
                {note.is_pinned && (
                  <Pin
                    size={10}
                    style={{ color: "var(--color-accent)", flexShrink: 0, fill: "currentColor" }}
                  />
                )}
                <span className="browse-note-title">
                  {getNoteTitle(note.title, note.preview)}
                </span>
                <span className="browse-note-date">
                  {formatDate(note.updated_at)}
                </span>
              </button>
            ))}

          {currentItems.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {view === "actions"
                ? `No matching settings or actions for "${search}"`
                : view === "browse"
                  ? `No notes matching "${search}"`
                  : "No matching options"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
