import { useState, useEffect, useRef, useCallback } from "react";
import { Note } from "../lib/db";
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
} from "lucide-react";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  activeNoteId: string | null;
  initialView?: "actions" | "browse";
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
  onShowShortcuts?: () => void;
}

type PaletteView = "actions" | "browse";

interface ActionItem {
  id: string;
  label: string;
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
  onShowShortcuts,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<PaletteView>(initialView);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeNote = notes.find((n) => n.id === activeNoteId);

  const actions: ActionItem[] = [
    {
      id: "new",
      label: "New Note",
      icon: <Plus size={14} />,
      shortcut: ["⌘", "N"],
      action: () => {
        onNewNote();
        onClose();
      },
    },
    {
      id: "browse",
      label: "Browse / Switch Notes",
      icon: <BookOpen size={14} />,
      shortcut: ["⌘", "P"],
      action: () => {
        setView("browse");
        setSearch("");
        setSelectedIndex(0);
      },
    },
    {
      id: "find",
      label: "Find in Note",
      icon: <Search size={14} />,
      shortcut: ["⌘", "F"],
      disabled: !activeNoteId,
      action: () => {
        onClose();
        onFindInNote?.();
      },
    },
    {
      id: "duplicate",
      label: "Duplicate Note",
      icon: <Copy size={14} />,
      shortcut: ["⌘", "D"],
      disabled: !activeNoteId,
      action: () => {
        onDuplicateNote();
        onClose();
      },
    },
    {
      id: "pin",
      label: activeNote?.is_pinned ? "Unpin Note" : "Pin Note to Top",
      icon: <Pin size={14} />,
      shortcut: ["⇧", "⌘", "P"],
      disabled: !activeNoteId,
      action: () => {
        if (activeNoteId) {
          onTogglePin(activeNoteId);
          onClose();
        }
      },
    },
    {
      id: "copy-md",
      label: "Copy Note as Markdown",
      icon: <ClipboardCopy size={14} />,
      shortcut: ["⇧", "⌘", "C"],
      disabled: !activeNoteId,
      action: () => {
        onClose();
        onCopyNoteAsMarkdown?.();
      },
    },
    {
      id: "copy-txt",
      label: "Copy Note as Plain Text",
      icon: <FileText size={14} />,
      disabled: !activeNoteId,
      action: () => {
        onClose();
        onCopyNoteAsText?.();
      },
    },
    {
      id: "deeplink",
      label: "Copy Deeplink",
      icon: <Link2 size={14} />,
      shortcut: ["⇧", "⌘", "D"],
      disabled: !activeNoteId,
      action: () => {
        onClose();
        onCopyDeeplink?.();
      },
    },
    {
      id: "export",
      label: "Export Current Note as Markdown (.md)",
      badge: "Local",
      keywords: ["export", "markdown", "md", "save", "download", "file"],
      icon: <FileDown size={14} />,
      shortcut: ["⇧", "⌘", "E"],
      disabled: !activeNoteId,
      action: () => {
        onClose();
        onExportNote?.();
      },
    },
    {
      id: "export-all",
      label: "Export All Notes as Markdown (.md)",
      badge: "Local",
      keywords: ["export", "all", "markdown", "md", "save", "download", "backup"],
      icon: <FileDown size={14} />,
      disabled: notes.length === 0,
      action: () => {
        onClose();
        onExportAllNotes?.();
      },
    },
    {
      id: "storage-info",
      label: "Storage: 100% On-Device Local SQLite",
      badge: "macOS",
      keywords: ["storage", "local", "database", "sqlite", "on device", "mac", "privacy", "file"],
      icon: <BookOpen size={14} />,
      action: () => {
        onClose();
        onShowToast?.("Storage: ~/Library/Application Support/com.notefast.app/notefast.db (On-Device Local)", <BookOpen size={14} />);
      },
    },
    {
      id: "prev-note",
      label: "Previous Note",
      icon: <ArrowUp size={14} />,
      shortcut: ["⌥", "↑"],
      action: () => {
        onClose();
        onPreviousNote?.();
      },
    },
    {
      id: "next-note",
      label: "Next Note",
      icon: <ArrowDown size={14} />,
      shortcut: ["⌥", "↓"],
      action: () => {
        onClose();
        onNextNote?.();
      },
    },
    {
      id: "back",
      label: "Go Back",
      icon: <ChevronLeft size={14} />,
      shortcut: ["⌘", "["],
      action: () => {
        onGoBack();
        onClose();
      },
    },
    {
      id: "forward",
      label: "Go Forward",
      icon: <ChevronRight size={14} />,
      shortcut: ["⌘", "]"],
      action: () => {
        onGoForward();
        onClose();
      },
    },
    {
      id: "delete",
      label: "Delete Note",
      icon: <Trash2 size={14} />,
      shortcut: ["⇧", "⌘", "⌫"],
      disabled: !activeNoteId,
      action: () => {
        if (activeNoteId) {
          onDeleteNote(activeNoteId);
          onClose();
        }
      },
    },
    {
      id: "zoom-in",
      label: "Zoom In",
      icon: <ZoomIn size={14} />,
      shortcut: ["⌘", "+"],
      action: () => {
        onZoomIn?.();
        onClose();
      },
    },
    {
      id: "zoom-out",
      label: "Zoom Out",
      icon: <ZoomOut size={14} />,
      shortcut: ["⌘", "-"],
      action: () => {
        onZoomOut?.();
        onClose();
      },
    },
    {
      id: "zoom-reset",
      label: "Reset Zoom (120%)",
      icon: <RotateCcw size={14} />,
      shortcut: ["⌘", "0"],
      action: () => {
        onResetZoom?.();
        onClose();
      },
    },
    {
      id: "smooth-caret",
      label: "Editor: Cursor Smooth Caret Animation",
      badge: (typeof window !== "undefined" && localStorage.getItem("notefast_smooth_caret") === "false") ? "off" : "smooth",
      keywords: ["editor: cursor smooth caret animation", "smooth", "caret", "cursor", "animation", "vscode", "typing", "smooth caret"],
      icon: <Sparkles size={14} />,
      action: () => {
        const current = localStorage.getItem("notefast_smooth_caret") !== "false";
        const next = !current;
        localStorage.setItem("notefast_smooth_caret", String(next));
        document.documentElement.dataset.smoothCaret = String(next);
        window.dispatchEvent(
          new CustomEvent("notefast_toggle_smooth_caret", { detail: { enabled: next } })
        );
        onShowToast?.(
          next
            ? "Editor: Smooth Caret Animation Enabled (VS Code smooth)"
            : "Editor: Smooth Caret Animation Disabled (Native)",
          <Sparkles size={14} />
        );
        onClose();
      },
    },
    {
      id: "shortcuts",
      label: "Keyboard Shortcuts Cheatsheet",
      icon: <Keyboard size={14} />,
      shortcut: ["⌘", "/"],
      action: () => {
        onClose();
        onShowShortcuts?.();
      },
    },
  ];

  const filteredActions = actions.filter((a) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    if (a.label.toLowerCase().includes(q)) return true;
    if (a.badge && a.badge.toLowerCase().includes(q)) return true;
    if (a.keywords && a.keywords.some((k) => k.toLowerCase().includes(q))) return true;
    return false;
  });

  const filteredNotes = notes.filter((n) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const title = getNoteTitle(n.title, n.content).toLowerCase();
    const content = (n.content || "").toLowerCase();
    return title.includes(q) || content.includes(q);
  });

  const currentItems = view === "actions" ? filteredActions : filteredNotes;

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setView(initialView);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialView]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search, view]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view === "browse" && initialView !== "browse") {
          setView("actions");
          setSearch("");
        } else {
          onClose();
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setView((prev) => (prev === "actions" ? "browse" : "actions"));
        setSearch("");
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) =>
          i < currentItems.length - 1 ? i + 1 : 0
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) =>
          i > 0 ? i - 1 : Math.max(0, currentItems.length - 1)
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (view === "actions") {
          const action = filteredActions[selectedIndex];
          if (action && !action.disabled) action.action();
        } else {
          const note = filteredNotes[selectedIndex];
          if (note) {
            onSelectNote(note.id);
            onClose();
          }
        }
        return;
      }
    },
    [
      view,
      initialView,
      currentItems,
      selectedIndex,
      filteredActions,
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
        {/* Search input with view toggle */}
        <div className="command-search">
          <Search size={14} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            placeholder={
              view === "actions"
                ? "Type a command or search actions…"
                : "Search notes by title or content…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
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
            {view === "actions" ? "Notes (⌘P)" : "Actions (⌘K)"}
          </button>
        </div>

        {/* Items list */}
        <div className="command-list">
          {view === "actions" &&
            filteredActions.map((item, idx) => (
              <button
                key={item.id}
                className={`command-item ${idx === selectedIndex ? "is-selected" : ""}`}
                onClick={() => {
                  if (!item.disabled) item.action();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={item.disabled ? { opacity: 0.35, cursor: "default" } : undefined}
              >
                <div className="command-item-icon">{item.icon}</div>
                <div className="command-item-text flex items-center">
                  <span className={`command-item-label ${item.disabled ? "disabled" : ""}`}>
                    {item.label}
                  </span>
                  {item.badge && (
                    <span className="text-[10px] px-1.5 py-0.5 ml-2 rounded bg-white/10 text-white/70 font-mono tracking-tight">
                      {item.badge}
                    </span>
                  )}
                </div>
                {item.shortcut && (
                  <div className="command-item-shortcut">
                    {item.shortcut.map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </div>
                )}
              </button>
            ))}

          {view === "browse" &&
            filteredNotes.map((note, idx) => (
              <button
                key={note.id}
                className={`browse-note-item ${idx === selectedIndex ? "is-selected" : ""} ${
                  note.id === activeNoteId ? "is-active" : ""
                }`}
                onClick={() => {
                  onSelectNote(note.id);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                {note.is_pinned && (
                  <Pin
                    size={10}
                    style={{ color: "#6C5CE7", flexShrink: 0, fill: "currentColor" }}
                  />
                )}
                <span className="browse-note-title">
                  {getNoteTitle(note.title, note.content)}
                </span>
                <span className="browse-note-date">
                  {formatDate(note.updated_at)}
                </span>
              </button>
            ))}

          {currentItems.length === 0 && (
            <div style={{ padding: "16px", textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
              {view === "actions" ? "No matching actions" : "No notes found"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
