import { useState, useEffect, useCallback, useRef } from "react";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette } from "./components/CommandPalette";
import { NoteEditor } from "./components/NoteEditor";
import { Toast, ToastData } from "./components/Toast";
import { ShortcutsModal } from "./components/ShortcutsModal";
import {
  getNoteTitle,
  noteContentToMarkdown,
  noteContentToPlainText,
  downloadFile,
} from "./lib/utils";
import {
  getAllNotes,
  createNote,
  updateNote,
  deleteNote,
  togglePin,
  saveWindowSize,
  hideWindow,
  quitApp,
  openSettingsWindow,
  Note,
} from "./lib/db";
import { initTheme } from "./lib/theme";
import { broadcastSync, listenToSettingsSync, matchesEvent } from "./lib/settingsSync";
import {
  Check,
  Copy,
  Plus,
  Pin,
  Trash2,
  FileDown,
  Link2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [paletteInitialView, setPaletteInitialView] = useState<"actions" | "browse">("actions");
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<{ noteId: string; agreed: boolean } | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = localStorage.getItem("notefast_zoom_level");
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0.6 && parsed <= 2.0) {
        return parsed;
      }
    }
    return 1.2; // 120% default
  });

  const [escLosesFocus, setEscLosesFocus] = useState<boolean>(() => {
    return localStorage.getItem("notefast_esc_loses_focus") === "true";
  });

  const [commandsConfig, setCommandsConfig] = useState<any[]>(() => {
    const saved = localStorage.getItem("notefast_commands_config");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem("notefast_zoom_level", zoomLevel.toString());
  }, [zoomLevel]);

  // Synchronize settings changes across the entire app immediately
  useEffect(() => {
    return listenToSettingsSync({
      onZoomChange: (val) => setZoomLevel(val),
      onEscLosesFocusChange: (val) => setEscLosesFocus(val),
      onCommandsConfigChange: (val) => setCommandsConfig(val),
      onNotesCleared: () => {
        setNotes([]);
        setActiveNoteId(null);
      },
    });
  }, []);

  // Persist window dimensions across restarts
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (width >= 320 && height >= 400) {
          saveWindowSize(width, height).catch(() => { });
        }
      }, 200);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeoutId);
    };
  }, []);

  const [toast, setToast] = useState<ToastData | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History stack for navigating back/forward
  const [history, setHistory] = useState<string[]>([]);
  const [, setHistoryIndex] = useState(-1);

  const activeNote = notes.find((n) => n.id === activeNoteId) || null;

  const showToast = useCallback((message: string, icon?: React.ReactNode) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ id: Date.now(), message, icon });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 1900);
  }, []);

  // Load notes & initialize theme on mount
  useEffect(() => {
    initTheme();
    loadNotes();
  }, []);

  const loadNotes = async () => {
    try {
      const allNotes = await getAllNotes();
      setNotes(allNotes);
      if (allNotes.length > 0 && !activeNoteId) {
        const savedId = localStorage.getItem("notefast_active_note_id");
        if (savedId && allNotes.some((n) => n.id === savedId)) {
          handleSelectNote(savedId);
        } else {
          handleSelectNote(allNotes[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load notes:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectNote = useCallback((id: string, recordHistory = true) => {
    setActiveNoteId(id);
    localStorage.setItem("notefast_active_note_id", id);
    if (recordHistory) {
      setHistoryIndex((prevIndex) => {
        setHistory((prevHistory) => {
          // Cap history buffer to 50 to prevent memory growth
          const newHistory = prevHistory.slice(Math.max(0, prevIndex - 49), prevIndex + 1);
          newHistory.push(id);
          return newHistory;
        });
        return Math.min(prevIndex + 1, 50);
      });
    }
  }, []);

  const handleGoBack = useCallback(() => {
    setHistoryIndex((prevIndex) => {
      if (prevIndex > 0) {
        const newIndex = prevIndex - 1;
        setActiveNoteId(history[newIndex]);
        showToast("Navigated Back");
        return newIndex;
      }
      return prevIndex;
    });
  }, [history, showToast]);

  const handleGoForward = useCallback(() => {
    setHistoryIndex((prevIndex) => {
      if (prevIndex < history.length - 1) {
        const newIndex = prevIndex + 1;
        setActiveNoteId(history[newIndex]);
        showToast("Navigated Forward");
        return newIndex;
      }
      return prevIndex;
    });
  }, [history, showToast]);

  const handleNextNote = useCallback(() => {
    if (notes.length === 0) return;
    const currentIndex = notes.findIndex((n) => n.id === activeNoteId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % notes.length;
    const nextNote = notes[nextIndex];
    handleSelectNote(nextNote.id);
    showToast(getNoteTitle(nextNote.title, nextNote.content));
  }, [notes, activeNoteId, handleSelectNote, showToast]);

  const handlePreviousNote = useCallback(() => {
    if (notes.length === 0) return;
    const currentIndex = notes.findIndex((n) => n.id === activeNoteId);
    const prevIndex =
      currentIndex === -1
        ? notes.length - 1
        : (currentIndex - 1 + notes.length) % notes.length;
    const prevNote = notes[prevIndex];
    handleSelectNote(prevNote.id);
    showToast(getNoteTitle(prevNote.title, prevNote.content));
  }, [notes, activeNoteId, handleSelectNote, showToast]);

  const handleNewNote = useCallback(async () => {
    try {
      const note = await createNote();
      setNotes((prev) => [note, ...prev]);
      handleSelectNote(note.id);
      showToast("New note created", <Plus size={14} />);
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  }, [handleSelectNote, showToast]);

  const handleDuplicateNote = useCallback(async () => {
    if (!activeNote) return;
    try {
      const note = await createNote();
      const updatedNote = {
        ...note,
        title: activeNote.title ? `${activeNote.title} (Copy)` : "Untitled (Copy)",
        content: activeNote.content,
      };
      await updateNote(updatedNote.id, updatedNote.title, updatedNote.content);

      setNotes((prev) => [updatedNote, ...prev]);
      handleSelectNote(updatedNote.id);
      showToast("Note duplicated", <Copy size={14} />);
    } catch (err) {
      console.error("Failed to duplicate note:", err);
    }
  }, [activeNote, handleSelectNote, showToast]);

  const handleUpdateNote = useCallback(
    async (content: string, titleHint?: string) => {
      if (!activeNoteId) return;
      try {
        let title = titleHint !== undefined ? titleHint : "";
        if (titleHint === undefined) {
          try {
            const doc = JSON.parse(content);
            if (doc.content && doc.content.length > 0) {
              const firstNode = doc.content[0];
              if (firstNode.content) {
                title = firstNode.content.map((n: any) => n.text || "").join("");
              }
            }
          } catch { }
        }

        await updateNote(activeNoteId, title, content);

        setNotes((prev) =>
          prev.map((n) =>
            n.id === activeNoteId
              ? {
                ...n,
                title,
                content,
                updated_at: new Date().toISOString(),
              }
              : n
          )
        );
      } catch (err) {
        console.error("Failed to update note:", err);
      }
    },
    [activeNoteId]
  );

  const handleDeleteNote = useCallback(
    async (id: string) => {
      try {
        await deleteNote(id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
        if (activeNoteId === id) {
          const remaining = notes.filter((n) => n.id !== id);
          if (remaining.length > 0) {
            handleSelectNote(remaining[0].id);
          } else {
            setActiveNoteId(null);
          }
        }
        showToast("Note deleted", <Trash2 size={14} />);
      } catch (err) {
        console.error("Failed to delete note:", err);
      }
    },
    [activeNoteId, notes, handleSelectNote, showToast]
  );

  // Prompt confirmation before deleting
  const promptDeleteNote = useCallback(
    (id: string) => {
      setDeleteConfirm({ noteId: id, agreed: false });
    },
    []
  );

  const confirmDelete = useCallback(() => {
    if (deleteConfirm && deleteConfirm.agreed) {
      handleDeleteNote(deleteConfirm.noteId);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, handleDeleteNote]);

  const handleTogglePin = useCallback(
    async (id: string) => {
      try {
        const isPinned = await togglePin(id);
        setNotes((prev) => {
          const updated = prev.map((n) =>
            n.id === id ? { ...n, is_pinned: isPinned } : n
          );
          return updated.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          });
        });
        showToast(
          isPinned ? "Note pinned to top" : "Note unpinned",
          <Pin size={14} />
        );
      } catch (err) {
        console.error("Failed to toggle pin:", err);
      }
    },
    [showToast]
  );

  const handleCopyNoteAsMarkdown = useCallback(() => {
    if (!activeNote) return;
    const md = noteContentToMarkdown(activeNote.content, activeNote.title);
    navigator.clipboard.writeText(md).then(() => {
      showToast("Copied note as Markdown", <Check size={14} />);
    });
  }, [activeNote, showToast]);

  const handleCopyNoteAsText = useCallback(() => {
    if (!activeNote) return;
    const text = noteContentToPlainText(activeNote.content, activeNote.title);
    navigator.clipboard.writeText(text).then(() => {
      showToast("Copied note as Plain Text", <Check size={14} />);
    });
  }, [activeNote, showToast]);

  const handleCopyDeeplink = useCallback(() => {
    if (!activeNote) return;
    const deeplink = `notefast://note/${activeNote.id}`;
    navigator.clipboard.writeText(deeplink).then(() => {
      showToast("Deeplink copied to clipboard", <Link2 size={14} />);
    });
  }, [activeNote, showToast]);

  const handleExportNote = useCallback(() => {
    if (!activeNote) return;
    const title = getNoteTitle(activeNote.title, activeNote.content);
    const filename = `${title.replace(/[/\\?%*:|"<>]/g, "-") || "Note"}.md`;
    const md = noteContentToMarkdown(activeNote.content, activeNote.title);
    downloadFile(filename, md, "text/markdown");
    showToast(`Exported "${filename}"`, <FileDown size={14} />);
  }, [activeNote, showToast]);

  const handleExportAllNotes = useCallback(() => {
    if (notes.length === 0) {
      showToast("No notes to export");
      return;
    }
    notes.forEach((note, index) => {
      setTimeout(() => {
        const title = getNoteTitle(note.title, note.content);
        const filename = `${title.replace(/[/\\?%*:|"<>]/g, "-") || `Note-${index + 1}`}.md`;
        const md = noteContentToMarkdown(note.content, note.title);
        downloadFile(filename, md, "text/markdown");
      }, index * 80);
    });
    showToast(`Exported ${notes.length} note${notes.length > 1 ? "s" : ""} as Markdown (.md)`, <FileDown size={14} />);
  }, [notes, showToast]);

  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.min(Math.round((prev + 0.1) * 10) / 10, 2.0);
      showToast(`Zoom: ${Math.round(next * 100)}%`, <ZoomIn size={14} />);
      broadcastSync({ type: "zoom", value: next });
      return next;
    });
  }, [showToast]);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.max(Math.round((prev - 0.1) * 10) / 10, 0.6);
      showToast(`Zoom: ${Math.round(next * 100)}%`, <ZoomOut size={14} />);
      broadcastSync({ type: "zoom", value: next });
      return next;
    });
  }, [showToast]);

  const handleResetZoom = useCallback(() => {
    setZoomLevel(1.2);
    showToast("Zoom: 120% (Default)", <RotateCcw size={14} />);
    broadcastSync({ type: "zoom", value: 1.2 });
  }, [showToast]);

  // Master Keyboard Shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey;

      const getCmd = (id: string, defaultHotkey: string) => {
        const found = commandsConfig?.find((c: any) => c.id === id);
        return {
          enabled: found ? found.enabled !== false : true,
          hotkey: found?.hotkey ?? defaultHotkey,
        };
      };

      const isTriggered = (id: string, defaultHotkey: string) => {
        const cmd = getCmd(id, defaultHotkey);
        if (!cmd.enabled) return false;
        return matchesEvent(e, cmd.hotkey);
      };

      // Hide NoteFast window
      if (isTriggered("hide", "⌘W")) {
        e.preventDefault();
        e.stopPropagation();
        hideWindow().catch(console.error);
        return;
      }

      // Quit the whole app completely
      if (isTriggered("quit", "⌘Q")) {
        e.preventDefault();
        e.stopPropagation();
        quitApp().catch(console.error);
        return;
      }

      // Search Notes / Toggle Command Palette (actions)
      if (isTriggered("search", "⌘K")) {
        e.preventDefault();
        setPaletteInitialView("actions");
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Quick Open / Browse Notes
      if (isTriggered("browse", "⌘P")) {
        e.preventDefault();
        setPaletteInitialView("browse");
        setIsCommandPaletteOpen(true);
        return;
      }

      // New Note
      if (isTriggered("create", "⌘N")) {
        e.preventDefault();
        handleNewNote();
        return;
      }

      // Duplicate Note
      if (isTriggered("duplicate", "⌘D")) {
        e.preventDefault();
        handleDuplicateNote();
        return;
      }

      // Find in Note
      if (isTriggered("find", "⌘F")) {
        e.preventDefault();
        setIsFindOpen(true);
        return;
      }

      // Pin / Unpin Note
      if (isTriggered("pin", "⇧⌘P")) {
        e.preventDefault();
        if (activeNoteId) {
          handleTogglePin(activeNoteId);
        }
        return;
      }

      // Copy Note as Markdown
      if (isTriggered("copy_markdown", "⇧⌘C")) {
        e.preventDefault();
        handleCopyNoteAsMarkdown();
        return;
      }

      // Copy Deeplink
      if (isTriggered("copy_deeplink", "⇧⌘D")) {
        e.preventDefault();
        handleCopyDeeplink();
        return;
      }

      // Export Note
      if (isTriggered("export_note", "⇧⌘E")) {
        e.preventDefault();
        handleExportNote();
        return;
      }

      // Delete current note
      if (isTriggered("delete", "⇧⌘⌫")) {
        e.preventDefault();
        if (activeNoteId) {
          promptDeleteNote(activeNoteId);
        }
        return;
      }

      // ⌘⌫ (Cmd+Backspace): Delete note only if not currently typing in text/inputs
      if (isCmd && !e.shiftKey && e.key === "Backspace") {
        const cmd = getCmd("delete", "⇧⌘⌫");
        if (cmd.enabled) {
          const active = document.activeElement;
          const isEditingText =
            active?.tagName === "INPUT" ||
            active?.tagName === "TEXTAREA" ||
            Boolean(active?.closest(".tiptap"));

          if (!isEditingText && activeNoteId) {
            e.preventDefault();
            promptDeleteNote(activeNoteId);
            return;
          }
        }
      }

      // Next note
      if (isTriggered("next_note", "⌥↓")) {
        e.preventDefault();
        handleNextNote();
        return;
      }

      // Previous note
      if (isTriggered("prev_note", "⌥↑")) {
        e.preventDefault();
        handlePreviousNote();
        return;
      }

      // Go back in history
      if (isTriggered("history_back", "⌘[")) {
        e.preventDefault();
        handleGoBack();
        return;
      }

      // Go forward in history
      if (isTriggered("history_forward", "⌘]")) {
        e.preventDefault();
        handleGoForward();
        return;
      }

      // Zoom In
      if (isTriggered("zoom_in", "⌘=")) {
        e.preventDefault();
        handleZoomIn();
        return;
      }

      // Zoom Out
      if (isTriggered("zoom_out", "⌘-")) {
        e.preventDefault();
        handleZoomOut();
        return;
      }

      // Reset Zoom
      if (isTriggered("reset_zoom", "⌘0")) {
        e.preventDefault();
        handleResetZoom();
        return;
      }

      // Toggle Shortcuts Cheatsheet
      if (isTriggered("shortcuts_help", "⌘/")) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
        return;
      }

      // Open Settings
      if (isTriggered("settings", "⌘,")) {
        e.preventDefault();
        openSettingsWindow().catch(console.error);
        return;
      }

      // Escape: Close overlays in order of hierarchy, or unfocus editor if escLosesFocus enabled
      if (e.key === "Escape") {
        if (isShortcutsModalOpen) {
          setIsShortcutsModalOpen(false);
          return;
        }
        if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
          return;
        }
        if (isFindOpen) {
          setIsFindOpen(false);
          return;
        }
        if (escLosesFocus) {
          const active = document.activeElement as HTMLElement | null;
          if (
            active &&
            (active.tagName === "INPUT" ||
              active.tagName === "TEXTAREA" ||
              active.isContentEditable ||
              Boolean(active.closest(".tiptap")))
          ) {
            active.blur();
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeNoteId,
    commandsConfig,
    escLosesFocus,
    handleNewNote,
    handleDuplicateNote,
    handleDeleteNote,
    promptDeleteNote,
    handleTogglePin,
    handleCopyNoteAsMarkdown,
    handleCopyDeeplink,
    handleExportNote,
    handleNextNote,
    handlePreviousNote,
    handleGoBack,
    handleGoForward,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    isShortcutsModalOpen,
    isCommandPaletteOpen,
    isFindOpen,
  ]);

  if (isLoading) {
    return (
      <div className="app-shell flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[#6C5CE7]/30 border-t-[#6C5CE7] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar
        title={activeNote ? getNoteTitle(activeNote.title, activeNote.content) : "NoteFast"}
        onNewNote={handleNewNote}
        onOpenCommandPalette={() => {
          setPaletteInitialView("actions");
          setIsCommandPaletteOpen(true);
        }}
        onDuplicateNote={handleDuplicateNote}
        onDeleteNote={() => activeNoteId && promptDeleteNote(activeNoteId)}
      />

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="command-overlay" onClick={() => setDeleteConfirm(null)}>
          <div
            className="delete-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="delete-confirm-header">
              <Trash2 size={18} className="text-red-400" />
              <span>Delete Note</span>
            </div>
            <p className="delete-confirm-text">
              This action cannot be undone. The note will be permanently removed.
            </p>
            <label className="delete-confirm-checkbox">
              <input
                type="checkbox"
                checked={deleteConfirm.agreed}
                onChange={(e) =>
                  setDeleteConfirm((prev) =>
                    prev ? { ...prev, agreed: e.target.checked } : null
                  )
                }
              />
              <span>I confirm I want to delete this note</span>
            </label>
            <div className="delete-confirm-actions">
              <button
                className="delete-confirm-cancel"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="delete-confirm-btn"
                disabled={!deleteConfirm.agreed}
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
        <NoteEditor
          note={activeNote}
          onUpdate={handleUpdateNote}
          zoomLevel={zoomLevel}
          isFindOpen={isFindOpen}
          onCloseFind={() => setIsFindOpen(false)}
        />
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        notes={notes}
        activeNoteId={activeNoteId}
        initialView={paletteInitialView}
        onNewNote={handleNewNote}
        onDuplicateNote={handleDuplicateNote}
        onSelectNote={handleSelectNote}
        onDeleteNote={handleDeleteNote}
        onTogglePin={handleTogglePin}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onFindInNote={() => setIsFindOpen(true)}
        onCopyNoteAsMarkdown={handleCopyNoteAsMarkdown}
        onCopyNoteAsText={handleCopyNoteAsText}
        onCopyDeeplink={handleCopyDeeplink}
        onExportNote={handleExportNote}
        onExportAllNotes={handleExportAllNotes}
        onShowToast={showToast}
        onPreviousNote={handlePreviousNote}
        onNextNote={handleNextNote}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onShowShortcuts={() => setIsShortcutsModalOpen(true)}
      />

      <ShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      <Toast toast={toast} />
    </div>
  );
}

export default App;
