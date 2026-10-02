import { useState, useEffect, useCallback, useRef } from "react";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette } from "./components/CommandPalette";
import { NoteEditor } from "./components/NoteEditor";
import { Toast, ToastData } from "./components/Toast";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { MarkdownViewerModal, PreviewFileData } from "./components/MarkdownViewerModal";
import {
  getNoteTitle,
  noteContentToMarkdown,
  noteContentToPlainText,
  downloadFile,
  extractTitleFromMarkdown,
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
  Upload,
  Eye,
  FileText,
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

  // Local Markdown File Import & Preview States
  const [previewFile, setPreviewFile] = useState<PreviewFileData | null>(null);
  const [droppedFilePrompt, setDroppedFilePrompt] = useState<{ file: File; text: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const viewFileInputRef = useRef<HTMLInputElement>(null);

  const handleTriggerImportFile = useCallback(() => {
    importFileInputRef.current?.click();
  }, []);

  const handleTriggerViewFile = useCallback(() => {
    viewFileInputRef.current?.click();
  }, []);

  const processImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const title = extractTitleFromMarkdown(text, file.name);
        const newNote = await createNote();
        await updateNote(newNote.id, title, text);
        newNote.title = title;
        newNote.content = text;
        setNotes((prev) => [newNote, ...prev]);
        setActiveNoteId(newNote.id);
        showToast(`Imported "${title}" to notes`, <Check size={14} />);
      } catch (err) {
        console.error("Failed to import file:", err);
        showToast("Failed to import file", <Trash2 size={14} />);
      }
    },
    [showToast]
  );

  const processViewFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        setPreviewFile({
          name: file.name,
          content: text,
          size: file.size,
        });
      } catch (err) {
        console.error("Failed to preview file:", err);
        showToast("Failed to preview file", <Trash2 size={14} />);
      }
    },
    [showToast]
  );

  const handleImportFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImportFile(file);
    }
    e.target.value = "";
  };

  const handleViewFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processViewFile(file);
    }
    e.target.value = "";
  };

  // Drag & drop file handler
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const isMd =
        file.name.endsWith(".md") ||
        file.name.endsWith(".markdown") ||
        file.name.endsWith(".txt") ||
        file.type.includes("markdown") ||
        file.type.includes("text");
      if (isMd) {
        const text = await file.text();
        setDroppedFilePrompt({ file, text });
      }
    }
  };

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

      // Search Notes / Toggle Command & Settings Palette (Option+P or Cmd+K)
      const isAltP =
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        (e.code === "KeyP" || e.key.toLowerCase() === "p" || e.key === "π");
      if (isAltP || isTriggered("search", "⌥P") || isTriggered("search", "⌘K")) {
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
        if (droppedFilePrompt) {
          setDroppedFilePrompt(null);
          return;
        }
        if (previewFile) {
          setPreviewFile(null);
          return;
        }
        if (deleteConfirm) {
          setDeleteConfirm(null);
          return;
        }
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
          }
          return;
        } else {
          hideWindow().catch(console.error);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeNoteId,
    commandsConfig,
    deleteConfirm,
    droppedFilePrompt,
    previewFile,
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
    <div
      className="app-shell"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & drop visual overlay */}
      {isDragOver && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-modal">
            <Upload size={38} className="text-[#6C5CE7] animate-bounce" />
            <h3 className="drag-drop-title">Drop Markdown File</h3>
            <p className="drag-drop-subtitle">
              Drop here to choose between Upload to notes or Quick View
            </p>
          </div>
        </div>
      )}

      <TitleBar
        title={activeNote ? getNoteTitle(activeNote.title, activeNote.content) : "NoteFast"}
        onNewNote={handleNewNote}
        onOpenCommandPalette={() => {
          setPaletteInitialView("actions");
          setIsCommandPaletteOpen(true);
        }}
        onDuplicateNote={handleDuplicateNote}
        onDeleteNote={() => activeNoteId && promptDeleteNote(activeNoteId)}
        onCopyMarkdown={handleCopyNoteAsMarkdown}
        onTriggerImportFile={handleTriggerImportFile}
        onTriggerViewFile={handleTriggerViewFile}
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

      {/* Dropped File Choice Modal (Upload vs View Only) */}
      {droppedFilePrompt && (
        <div className="command-overlay" onClick={() => setDroppedFilePrompt(null)}>
          <div className="drop-prompt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drop-prompt-header">
              <div className="drop-prompt-icon">
                <FileText size={22} className="text-[#6C5CE7]" />
              </div>
              <div>
                <h3 className="drop-prompt-title">Open Markdown Document</h3>
                <p className="drop-prompt-filename">{droppedFilePrompt.file.name}</p>
              </div>
            </div>
            <p className="drop-prompt-desc">
              Would you like to import this Markdown document into your NoteFast notes or just view it?
            </p>
            <div className="drop-prompt-actions">
              <button
                className="drop-prompt-btn view-btn"
                onClick={() => {
                  setPreviewFile({
                    name: droppedFilePrompt.file.name,
                    content: droppedFilePrompt.text,
                    size: droppedFilePrompt.file.size,
                  });
                  setDroppedFilePrompt(null);
                }}
              >
                <Eye size={16} />
                <div className="btn-text-block">
                  <span className="btn-main-label">Quick View (No Upload)</span>
                  <span className="btn-sub-label">Preview without saving to database</span>
                </div>
              </button>

              <button
                className="drop-prompt-btn upload-btn"
                onClick={async () => {
                  const file = droppedFilePrompt.file;
                  setDroppedFilePrompt(null);
                  await processImportFile(file);
                }}
              >
                <Upload size={16} />
                <div className="btn-text-block">
                  <span className="btn-main-label">Upload to Notes</span>
                  <span className="btn-sub-label">Save into NoteFast notes database</span>
                </div>
              </button>
            </div>
            <div className="drop-prompt-footer">
              <button
                className="drop-prompt-cancel"
                onClick={() => setDroppedFilePrompt(null)}
              >
                Cancel
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
        onTriggerImportFile={handleTriggerImportFile}
        onTriggerViewFile={handleTriggerViewFile}
        zoomLevel={zoomLevel}
        onSetZoom={(zoom) => {
          setZoomLevel(zoom);
          broadcastSync({ type: "zoom", value: zoom });
        }}
        onPromptClearAllNotes={() => {
          if (notes.length === 0) {
            showToast("No notes to clear", <Check size={14} />);
            return;
          }
          if (window.confirm("Are you sure you want to delete all notes? This cannot be undone.")) {
            Promise.all(notes.map((n) => deleteNote(n.id))).then(() => {
              setNotes([]);
              setActiveNoteId(null);
              showToast("All notes cleared", <Trash2 size={14} />);
            }).catch(console.error);
          }
        }}
      />

      <ShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* Markdown Quick Viewer Modal (No Upload) */}
      <MarkdownViewerModal
        fileData={previewFile}
        onClose={() => setPreviewFile(null)}
        onShowToast={showToast}
        onImportToNotes={async (title, markdown) => {
          try {
            const newNote = await createNote();
            await updateNote(newNote.id, title, markdown);
            newNote.title = title;
            newNote.content = markdown;
            setNotes((prev) => [newNote, ...prev]);
            setActiveNoteId(newNote.id);
            setPreviewFile(null);
            showToast(`Imported "${title}" to notes`, <Check size={14} />);
          } catch (err) {
            console.error(err);
            showToast("Failed to import note", <Trash2 size={14} />);
          }
        }}
      />

      {/* Hidden file inputs for local markdown file selection */}
      <input
        type="file"
        ref={importFileInputRef}
        onChange={handleImportFileInputChange}
        accept=".md,.markdown,.txt"
        style={{ display: "none" }}
      />
      <input
        type="file"
        ref={viewFileInputRef}
        onChange={handleViewFileInputChange}
        accept=".md,.markdown,.txt"
        style={{ display: "none" }}
      />

      <Toast toast={toast} />
    </div>
  );
}

export default App;
