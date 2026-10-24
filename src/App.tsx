/**
 * NoteFast Main Application Controller (App.tsx)
 *
 * Core architectural responsibilities:
 * - State Management & Note Caching: Delivers 0ms note switching via two-tier caching:
 *   synchronous in-memory LRU cache (`noteCache`),
 *   coupled with asynchronous reconciliation against SQLite via Tauri IPC.
 * - File Ingestion & Drag-and-Drop: Handles drag-over overlays, local Markdown import,
 *   and zero-write non-destructive file previews via `MarkdownViewerModal`.
 * - Window Lifecycle & Sizing: Controls native borderless window resizing, focus restoration,
 *   window dimension persistence across restarts, and always-on-top toggling.
 * - Global Shortcuts & Palette Dispatch: Listens to Cmd/Ctrl shortcuts (search, new note,
 *   delete, zoom, formatting) and coordinates the Raycast-style Command Palette.
 * - Multi-Window Sync: Subscribes to settings events to propagate theme, font, zoom,
 *   and alias modifications immediately across Tauri windows.
 */

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette } from "./components/CommandPalette";
import { NoteEditor } from "./components/NoteEditor";
import { Toast, ToastData } from "./components/Toast";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { SmartSearch } from "./components/SmartSearch";
import { SwitchConflictModal, SwitchConflictInfo } from "./components/SwitchConflictModal";
import { saveStatusStore } from "./lib/saveStatusStore";
import { copyToClipboard } from "./lib/clipboard";
import type { PreviewFileData } from "./components/MarkdownViewerModal";
const MarkdownViewerModal = lazy(() =>
  import("./components/MarkdownViewerModal").then((m) => ({ default: m.MarkdownViewerModal }))
);
import { WindowResizeHandles } from "./components/WindowResizeHandles";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeLocalStorageSetItem, safeLocalStorageRemoveItem, createCoalescedWriter } from "./lib/storage";
import {
  getNoteTitle,
  getPreviewText,
  noteContentToMarkdown,
  noteContentToPlainText,
  downloadFile,
  extractTitleFromMarkdown,
} from "./lib/utils";
import { ensureFirstLineHeading } from "./editor/markdownUtils";
import {
  getRecentNotes,
  getAdjacentNote,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  togglePin,
  saveWindowSize,
  hideWindow,
  quitApp,
  openSettingsWindow,
  setAlwaysOnTop,
  exportAllNotesFromDb,
  registerExitFlushHandler,
  registerPanelHideHandler,
  flushEditorNow,
  flushSaveQueue,
  NoteSummary,
} from "./lib/db";
import { initTheme } from "./lib/theme";
import { noteCache } from "./lib/noteCache";
import { titleStore } from "./lib/titleStore";
import { broadcastSync, listenToSettingsSync, matchesEvent } from "./lib/settingsSync";
import { getStoredCommandsConfig, CommandRow } from "./lib/commandsConfig";
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
  AlertTriangle,
} from "lucide-react";

function App() {
  /**
   * Note summaries list state.
   * Hydrates immediately from localStorage on startup to prevent white/empty-screen flashes,
   * then updates once SQLite asynchronous data is returned.
   */
  const [recentNotes, setRecentNotes] = useState<NoteSummary[]>(() => {
    try {
      const cached = localStorage.getItem("notefast_cached_notes");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [activeNoteSummary, setActiveNoteSummary] = useState<NoteSummary | null>(null);

  // Alias for compatibility with components expecting notes list
  const notes = recentNotes;
  const setNotes = setRecentNotes;

  /**
   * Tracks the currently selected note ID.
   * Priority: 1. Previously active note from localStorage, 2. First note in cache, 3. null.
   */
  const [activeNoteId, setActiveNoteId] = useState<string | null>(() => {
    const saved = localStorage.getItem("notefast_active_note_id");
    if (saved) return saved;
    try {
      const cached = localStorage.getItem("notefast_cached_notes");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
      }
    } catch {}
    return null;
  });

  // Active fetch tracker to guard against out-of-order SQLite responses
  const activeFetchIdRef = useRef<string | null>(null);

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSmartSearchOpen, setIsSmartSearchOpen] = useState(false);
  const [paletteInitialView, setPaletteInitialView] = useState<"actions" | "settings">("actions");
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = localStorage.getItem("notefast_cached_notes");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch {}
    return true;
  });
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

  const [switchConflict, setSwitchConflict] = useState<SwitchConflictInfo | null>(null);
  const [discardedNoteId, setDiscardedNoteId] = useState<string | null>(null);

  const [escLosesFocus, setEscLosesFocus] = useState<boolean>(() => {
    return localStorage.getItem("notefast_esc_loses_focus") === "true";
  });

  const [commandsConfig, setCommandsConfig] = useState<CommandRow[]>(getStoredCommandsConfig);

  // Focus and cursor tracking for hiding menu bar and formatting controls in idle mode
  const [isWindowFocused, setIsWindowFocused] = useState(() => {
    return typeof document !== "undefined" ? document.hasFocus() : true;
  });
  const [isMouseOverApp, setIsMouseOverApp] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow().isFocused().then((focused) => {
      setIsWindowFocused(focused);
    }).catch(() => {});

    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      setIsWindowFocused(focused);
      if (!focused) {
        setIsMouseOverApp(false);
      }
    }).then((fn) => {
      unlisten = fn;
    }).catch(() => {});

    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => {
      setIsWindowFocused(false);
      setIsMouseOverApp(false);
    };

    const handleMouseLeave = () => {
      setIsMouseOverApp(false);
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        setIsMouseOverApp(false);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const inBounds =
        e.clientX >= 0 &&
        e.clientX <= window.innerWidth &&
        e.clientY >= 0 &&
        e.clientY <= window.innerHeight;
      setIsMouseOverApp((prev) => (prev !== inBounds ? inBounds : prev));
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("mouseout", handleMouseOut);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      if (unlisten) unlisten();
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  const isCursorInPage = isWindowFocused && isMouseOverApp;

  useEffect(() => {
    safeLocalStorageSetItem("notefast_zoom_level", zoomLevel.toString());
  }, [zoomLevel]);

  // Synchronize settings changes across the entire app immediately
  useEffect(() => {
    return listenToSettingsSync({
      onZoomChange: (val) => setZoomLevel(val),
      onEscLosesFocusChange: (val) => setEscLosesFocus(val),
      onAlwaysOnTopChange: (val) => {
        setAlwaysOnTop(val).catch(console.error);
      },
      onCommandsConfigChange: (val) => setCommandsConfig(val || getStoredCommandsConfig()),
      onNotesCleared: () => {
        setNotes([]);
        setActiveNoteId(null);
        noteCache.clear();
      },
    });
  }, []);

  // Ensure the app and window always gain focus on user click, interaction, or scrolling
  useEffect(() => {
    const handleInteraction = () => {
      if (!document.hasFocus()) {
        window.focus();
        getCurrentWindow().setFocus().catch(() => {});
      }
    };
    window.addEventListener("pointerdown", handleInteraction, { passive: true });
    window.addEventListener("wheel", handleInteraction, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handleInteraction);
      window.removeEventListener("wheel", handleInteraction);
    };
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

  const activeNote =
    (activeNoteSummary && activeNoteSummary.id === activeNoteId ? activeNoteSummary : null) ||
    notes.find((n) => n.id === activeNoteId) ||
    null;

  const showToast = useCallback((message: string, icon?: React.ReactNode) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ id: Date.now(), message, icon });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 1900);
  }, []);

  const handleSwitchFailed = useCallback(
    (failedId: string, err: unknown) => {
      console.warn(`[switch] Note switch aborted because saving note ${failedId} failed:`, err);
      setActiveNoteId(failedId);
      safeLocalStorageSetItem("notefast_active_note_id", failedId);
      showToast(
        "Save failed. Staying on current note to protect unsaved changes.",
        <AlertTriangle size={14} className="text-amber-400" />
      );
    },
    [showToast]
  );

  /**
   * Switches the active note with instantaneous UI response.
   * Execution pipeline:
   * 1. Updates `activeNoteId` state & persists active note ID to localStorage.
   * 2. Appends ID to history stack (capped at 50 items) for back/forward navigation.
   * 3. Checks in-memory `noteCache` first (0ms latency, zero layout flicker).
   * 4. If cache miss, falls back to SQLite.
   * 5. Dispatches asynchronous `getNote(id)` to SQLite with concurrency check
   *    (`activeFetchIdRef`) to prevent out-of-order race conditions.
   */
  const handleSelectNote = useCallback((id: string, summaryHint?: NoteSummary, recordHistory = true) => {
    setActiveNoteId(id);
    safeLocalStorageSetItem("notefast_active_note_id", id);

    // Apply summary hint or find in recents/cache without DB fetch
    if (summaryHint) {
      setActiveNoteSummary(summaryHint);
      titleStore.setTitle(summaryHint.title);
    } else {
      const inRecents = recentNotes.find((n) => n.id === id);
      if (inRecents) {
        setActiveNoteSummary(inRecents);
        titleStore.setTitle(inRecents.title);
      } else {
        const cached = noteCache.get(id);
        if (cached && cached.title !== undefined) {
          titleStore.setTitle(cached.title);
        } else {
          // Reset titleStore so the previous note's title does not flash
          titleStore.reset();
        }
      }
    }

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

    // Fast in-memory LRU cache check (0ms instantaneous switch)
    const cached = noteCache.get(id);
    if (!cached) {
      activeFetchIdRef.current = id;
      // Single fetch: populates both noteCache and activeNoteSummary
      getNote(id)
        .then((fullNote) => {
          if (activeFetchIdRef.current === id && fullNote) {
            noteCache.set(fullNote.id, fullNote.content, fullNote.updated_at, fullNote.title, 0);
            titleStore.setTitle(fullNote.title);
            setActiveNoteSummary({
              id: fullNote.id,
              title: fullNote.title,
              preview: fullNote.preview,
              created_at: fullNote.created_at,
              updated_at: fullNote.updated_at,
              is_pinned: fullNote.is_pinned,
            });
            try {
              if (fullNote.content.length <= 65536) {
                safeLocalStorageSetItem("notefast_active_note_content", fullNote.content);
              } else {
                localStorage.removeItem("notefast_active_note_content");
              }
            } catch {}
          }
        })
        .catch((err) => {
          console.error("Failed to load note content:", err);
        });
    } else {
      if (!summaryHint) {
        const inRecents = recentNotes.find((n) => n.id === id);
        if (inRecents) {
          setActiveNoteSummary(inRecents);
        } else {
          const iso = new Date(cached.updatedAt).toISOString();
          setActiveNoteSummary((prev) => (prev && prev.id === id ? prev : {
            id,
            title: "Untitled",
            preview: getPreviewText(cached.content),
            created_at: iso,
            updated_at: iso,
            is_pinned: false,
          }));
        }
      }
      try {
        if (cached.content.length <= 65536) {
          safeLocalStorageSetItem("notefast_active_note_content", cached.content);
        } else {
          localStorage.removeItem("notefast_active_note_content");
        }
      } catch {}
    }
  }, [recentNotes]);

  if (typeof window !== "undefined") {
    (window as any).__RAYNOTE_SELECT_NOTE__ = handleSelectNote;
  }

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

  /**
   * Reads an imported file from disk, parses its title from YAML frontmatter / headings,
   * generates a new note in SQLite, stores it in memory cache, prepends it to the note list,
   * and navigates directly to the new note.
   */
  const processImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const fallbackTitle = file.name.replace(/\.[^/.]+$/, "");
        const formattedText = ensureFirstLineHeading(text, fallbackTitle);
        const title = extractTitleFromMarkdown(formattedText, file.name);
        const newNote = await createNote();
        await updateNote(newNote.id, title, formattedText);
        noteCache.set(newNote.id, formattedText, new Date().toISOString(), title, 0);
        const preview = getPreviewText(formattedText);
        const summary: NoteSummary = {
          id: newNote.id,
          title,
          preview,
          created_at: newNote.created_at,
          updated_at: new Date().toISOString(),
          is_pinned: false,
        };
        setNotes((prev) => [summary, ...prev.filter((n) => n.id !== summary.id)].slice(0, 30));
        handleSelectNote(newNote.id);
        showToast(`Imported "${title}" to notes`, <Check size={14} />);
      } catch (err) {
        console.error("Failed to import file:", err);
        showToast("Failed to import file", <Trash2 size={14} />);
      }
    },
    [handleSelectNote, showToast]
  );

  /**
   * Opens a file in the standalone MarkdownViewerModal for non-destructive reading.
   * Does NOT write to SQLite or mutate the user's note library unless they explicitly
   * choose "Import to Notes" inside the viewer.
   */
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

  /**
   * Triggers file import from the hidden `<input type="file">` element.
   * Resets input value after execution to allow selecting the same file sequentially.
   */
  const handleImportFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImportFile(file);
    }
    e.target.value = "";
  };

  /**
   * Triggers non-destructive file preview from the hidden preview input element.
   * Resets input value after execution.
   */
  const handleViewFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processViewFile(file);
    }
    e.target.value = "";
  };

  /**
   * Drag & drop file handler:
   * Displays the glassmorphism drop overlay when files are dragged into the window.
   */
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

  /**
   * Handles dropping markdown/text files onto the NoteFast window.
   * Validates file extensions (.md, .markdown, .txt) and prompts the user
   * with options to either "View without saving" or "Import to Notes".
   */
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

  /**
   * Recovers unsaved snapshot content whose note was removed from SQLite by creating
   * a fresh database row, switching to it, and evicting the orphan snapshot.
   */
  const handleRecoverOrphan = useCallback(
    async (content: string, sourceId?: string) => {
      try {
        // Idempotent recovery check: was a recovery already started for THIS snapshot before a crash?
        const currentSourceId = sourceId || localStorage.getItem("notefast_active_note_id") || "unknown";
        let existingRecoveredId: string | null = null;
        const rawRecovered = localStorage.getItem("notefast_recovered_note_id");
        if (rawRecovered) {
          try {
            const parsed = JSON.parse(rawRecovered);
            if (parsed && parsed.sourceId === currentSourceId && parsed.recoveredId) {
              existingRecoveredId = parsed.recoveredId;
            }
          } catch {
            existingRecoveredId = null;
          }
        }

        let note: any = null;
        if (existingRecoveredId) {
          try {
            note = await getNote(existingRecoveredId);
          } catch {
            note = null;
          }
        }

        let title = "Recovered Note";
        try {
          const doc = JSON.parse(content);
          if (doc.content && Array.isArray(doc.content)) {
            for (const node of doc.content) {
              if (Array.isArray(node.content)) {
                const text = node.content.map((n: any) => n.text || "").join("").trim();
                if (text) {
                  title = text;
                  break;
                }
              }
            }
          }
        } catch {
          title = extractTitleFromMarkdown(content, "Recovered Note");
        }

        if (!note) {
          // 1. Create fresh note row in SQLite
          note = await createNote();
          // Store recovered note ID alongside source snapshot ID ({ sourceId, recoveredId })
          safeLocalStorageSetItem(
            "notefast_recovered_note_id",
            JSON.stringify({ sourceId: currentSourceId, recoveredId: note.id })
          );
        }

        // 2. Persist content to SQLite before clearing snapshot keys
        await updateNote(note.id, title, content);
        noteCache.set(note.id, content, new Date().toISOString(), title, 0, false);

        // 3. Update localStorage pointers to point to the newly recovered note
        safeLocalStorageSetItem("notefast_active_note_id", note.id);
        safeLocalStorageSetItem("notefast_active_note_content", content);
        safeLocalStorageRemoveItem("notefast_active_note_unsaved");
        safeLocalStorageRemoveItem("notefast_recovered_note_id");

        // 4. Switch active selection to the new note
        handleSelectNote(note.id);
        const freshRecents = await getRecentNotes(30);
        setRecentNotes(freshRecents);
        safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(freshRecents));

        showToast("Recovered unsaved note into a new document", <Check size={14} />);
        return note.id;
      } catch (err) {
        console.error("Failed to recover orphan note:", err);
        throw err;
      }
    },
    [handleSelectNote, showToast]
  );

  // Load notes, initialize theme & apply always on top on mount
  useEffect(() => {
    initTheme();
    loadNotes();
    const savedAlwaysOnTop = localStorage.getItem("notefast_always_on_top") !== "false";
    setAlwaysOnTop(savedAlwaysOnTop).catch(console.error);
  }, []);

  /**
   * Initial notes loader:
   * 1. Fetches recent note summaries (capped at 30) from the SQLite database via Tauri IPC.
   * 2. Synchronously caches summaries in localStorage for instant cold start on next launch.
   * 3. Selects the previously active note (or falls back to the first available note).
   * 4. If an unsaved snapshot refers to a missing note row, recovers it as a new note.
   */
  const loadNotes = async () => {
    try {
      const recents = await getRecentNotes(30);
      setRecentNotes(recents);
      safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(recents.slice(0, 30)));

      const savedId = localStorage.getItem("notefast_active_note_id");
      const savedContent = localStorage.getItem("notefast_active_note_content");
      const isUnsaved = localStorage.getItem("notefast_active_note_unsaved") === "true";

      if (savedId) {
        const inRecents = recents.find((n) => n.id === savedId);
        if (inRecents) {
          if (!activeNoteId || activeNoteId !== inRecents.id) {
            handleSelectNote(inRecents.id, inRecents);
          } else {
            handleSelectNote(inRecents.id, inRecents, false);
          }
        } else {
          // Check if it exists beyond top 30 in DB
          const inDb = await getNote(savedId).catch(() => null);
          if (inDb) {
            handleSelectNote(inDb.id, {
              id: inDb.id,
              title: inDb.title,
              preview: inDb.preview,
              created_at: inDb.created_at,
              updated_at: inDb.updated_at,
              is_pinned: inDb.is_pinned,
            }, false);
          } else {
            // Note row is MISSING from DB!
            let recoveredId: string | null = null;
            const rawRecovered = localStorage.getItem("notefast_recovered_note_id");
            if (rawRecovered) {
              try {
                const parsed = JSON.parse(rawRecovered);
                if (parsed && parsed.sourceId === savedId && parsed.recoveredId) {
                  recoveredId = parsed.recoveredId;
                }
              } catch {
                recoveredId = null;
              }
            }
            if (recoveredId) {
              const recoveredNote = await getNote(recoveredId).catch(() => null);
              if (recoveredNote) {
                // The recovered note was already created and persisted in SQLite before previous crash
                safeLocalStorageSetItem("notefast_active_note_id", recoveredNote.id);
                safeLocalStorageRemoveItem("notefast_active_note_unsaved");
                safeLocalStorageRemoveItem("notefast_recovered_note_id");
                handleSelectNote(recoveredNote.id, {
                  id: recoveredNote.id,
                  title: recoveredNote.title,
                  preview: recoveredNote.preview,
                  created_at: recoveredNote.created_at,
                  updated_at: recoveredNote.updated_at,
                  is_pinned: recoveredNote.is_pinned,
                }, false);
                return;
              }
            }

            if (isUnsaved && savedContent) {
              // Unsaved snapshot whose note is missing from DB: create new note with content, switch to it, clear snapshot
              await handleRecoverOrphan(savedContent, savedId);
            } else {
              // Clean orphan: clear snapshot and select first recent note if any
              safeLocalStorageRemoveItem("notefast_active_note_id");
              safeLocalStorageRemoveItem("notefast_active_note_content");
              safeLocalStorageRemoveItem("notefast_active_note_base_updated_at");
              safeLocalStorageRemoveItem("notefast_active_note_unsaved");
              safeLocalStorageRemoveItem("notefast_recovered_note_id");
              if (recents.length > 0) {
                handleSelectNote(recents[0].id, recents[0]);
              }
            }
          }
        }
      } else if (recents.length > 0) {
        handleSelectNote(recents[0].id, recents[0]);
      }
    } catch (err) {
      console.error("Failed to load notes:", err);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Navigates backward in the note navigation history stack.
   */
  const handleGoBack = useCallback(() => {
    setHistoryIndex((prevIndex) => {
      if (prevIndex > 0) {
        const newIndex = prevIndex - 1;
        handleSelectNote(history[newIndex], undefined, false);
        showToast("Navigated Back");
        return newIndex;
      }
      return prevIndex;
    });
  }, [history, handleSelectNote, showToast]);

  /**
   * Navigates forward in the note navigation history stack.
   */
  const handleGoForward = useCallback(() => {
    setHistoryIndex((prevIndex) => {
      if (prevIndex < history.length - 1) {
        const newIndex = prevIndex + 1;
        handleSelectNote(history[newIndex], undefined, false);
        showToast("Navigated Forward");
        return newIndex;
      }
      return prevIndex;
    });
  }, [history, handleSelectNote, showToast]);


  /**
   * Sets note title explicitly, keeping React titleStore and in-memory cache in sync.
   * Updates external titleStore synchronously so TitleBar reflects first line edits instantly with 0ms lag
   * without triggering full App or Editor component re-renders per keystroke.
   * Persistence to SQLite is handled atomically alongside document content in handleUpdateNote.
   */
  const handleSetTitle = useCallback(
    (newTitle: string) => {
      if (!activeNoteId) return;
      try {
        const cached = noteCache.get(activeNoteId);
        const currentSummary = notes.find((n) => n.id === activeNoteId);
        const existingTitle = currentSummary?.title || cached?.title || "";
        if (newTitle === existingTitle) {
          titleStore.setTitle(newTitle);
          return;
        }
        const content = cached?.content || "";
        noteCache.updateContent(activeNoteId, content, newTitle);

        // Instant TitleBar update via external store without re-rendering App/Editor
        titleStore.setTitle(newTitle);

        setNotes((prev) =>
          prev.map((n) => (n.id === activeNoteId ? { ...n, title: newTitle } : n))
        );
      } catch (err) {
        console.error("Failed to set note title:", err);
      }
    },
    [activeNoteId, notes]
  );

  const flushPendingTitle = useCallback(() => {
    // No-op: title is always saved atomically with document AST in flushEditorNow
  }, []);

  const isNavigatingRef = useRef(false);

  /**
   * Cycles to the next note in keyset order across ALL database notes (wrapping around).
   * Coalesces and ignores rapid key-repeats (Option+Down) while an in-flight navigation is pending.
   */
  const handleNextNote = useCallback(async () => {
    if (!activeNoteId || isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    try {
      flushEditorNow();
      flushPendingTitle();
      await flushSaveQueue();
      const nextId = await getAdjacentNote(activeNoteId, "next");
      if (nextId) {
        handleSelectNote(nextId);
      }
    } catch (err) {
      console.error("Failed to navigate to next note:", err);
    } finally {
      isNavigatingRef.current = false;
    }
  }, [activeNoteId, flushPendingTitle, handleSelectNote]);

  /**
   * Cycles to the previous note in keyset order across ALL database notes (wrapping around).
   * Coalesces and ignores rapid key-repeats (Option+Up) while an in-flight navigation is pending.
   */
  const handlePreviousNote = useCallback(async () => {
    if (!activeNoteId || isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    try {
      flushEditorNow();
      flushPendingTitle();
      await flushSaveQueue();
      const prevId = await getAdjacentNote(activeNoteId, "prev");
      if (prevId) {
        handleSelectNote(prevId);
      }
    } catch (err) {
      console.error("Failed to navigate to previous note:", err);
    } finally {
      isNavigatingRef.current = false;
    }
  }, [activeNoteId, flushPendingTitle, handleSelectNote]);

  /**
   * Creates a brand new note:
   * 1. Inserts an empty note document into SQLite via `createNote()`.
   * 2. Sets the initial content in memory cache.
   * 3. Prepends the summary to the note list and selects it immediately.
   */
  const handleNewNote = useCallback(async () => {
    try {
      const note = await createNote();
      noteCache.set(note.id, note.content, note.updated_at, note.title, 0);
      const summary: NoteSummary = {
        id: note.id,
        title: note.title,
        preview: note.preview,
        created_at: note.created_at,
        updated_at: note.updated_at,
        is_pinned: note.is_pinned,
      };
      setActiveNoteSummary(summary);
      const freshRecents = await getRecentNotes(30);
      setRecentNotes(freshRecents);
      safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(freshRecents));
      handleSelectNote(note.id, summary);
      showToast("New note created", <Plus size={14} />);
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  }, [handleSelectNote, showToast]);

  /**
   * Duplicates the active note, preserving all rich-text content while appending '(Copy)' to the title.
   */
  const handleDuplicateNote = useCallback(async () => {
    if (!activeNoteId) return;
    try {
      let content = noteCache.get(activeNoteId)?.content;
      if (!content) {
        const full = await getNote(activeNoteId);
        content = full?.content || "";
      }
      const currentSummary = notes.find((n) => n.id === activeNoteId);
      const note = await createNote();
      const title = currentSummary?.title ? `${currentSummary.title} (Copy)` : "Untitled (Copy)";
      await updateNote(note.id, title, content);

      noteCache.set(note.id, content, new Date().toISOString(), title, 0);
      const preview = getPreviewText(content);
      const newSummary: NoteSummary = {
        id: note.id,
        title,
        preview,
        created_at: note.created_at,
        updated_at: new Date().toISOString(),
        is_pinned: false,
      };

      setActiveNoteSummary(newSummary);
      const freshRecents = await getRecentNotes(30);
      setRecentNotes(freshRecents);
      safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(freshRecents));
      handleSelectNote(note.id, newSummary);
      showToast("Note duplicated", <Copy size={14} />);
    } catch (err) {
      console.error("Failed to duplicate note:", err);
    }
  }, [activeNoteId, notes, handleSelectNote, showToast]);

  const handleOpenCommandPalette = useCallback(
    (view: "actions" | "settings" = "actions") => {
      // 1. Open palette immediately (0ms) with existing cached recents
      setPaletteInitialView(view);
      setIsCommandPaletteOpen(true);

      // 2. Concurrently flush in-flight editor/title saves and replace with fresh recents once drained
      flushEditorNow();
      flushPendingTitle();
      flushSaveQueue().then(async () => {
        try {
          const freshRecents = await getRecentNotes(30);
          setRecentNotes(freshRecents);
        } catch (e) {
          console.error("Failed to refresh recents on command palette open:", e);
        }
      });
    },
    [flushPendingTitle]
  );

  const handleOpenSmartSearch = useCallback(() => {
    // 1. Open SmartSearch immediately (0ms) with existing cached recents
    setIsSmartSearchOpen(true);

    // 2. Concurrently flush in-flight editor/title saves and replace with fresh recents once drained
    flushEditorNow();
    flushPendingTitle();
    flushSaveQueue().then(async () => {
      try {
        const freshRecents = await getRecentNotes(30);
        setRecentNotes(freshRecents);
      } catch (e) {
        console.error("Failed to refresh recents on smart search open:", e);
      }
    });
  }, [flushPendingTitle]);

  const pendingCachedNotesJsonRef = useRef<string | null>(null);
  const cachedNotesWriterRef = useRef(
    createCoalescedWriter(() => {
      if (pendingCachedNotesJsonRef.current !== null) {
        safeLocalStorageSetItem("notefast_cached_notes", pendingCachedNotesJsonRef.current);
      }
    }, 16)
  );

  useEffect(() => {
    const unlistenPromise = registerExitFlushHandler(() => {
      // 1. Flush pending title to saveQueue
      flushPendingTitle();
      // 2. Synchronously commit coalesced localStorage notes cache
      cachedNotesWriterRef.current.flush();
    });
    return () => {
      unlistenPromise?.then((unlisten) => unlisten());
    };
  }, [flushPendingTitle]);

  useEffect(() => {
    // Immediate lifecycle flush: blur, visibility hidden, or panel-will-hide commits
    // editor debounce and title timer immediately without any 16ms delay.
    const handleImmediateFlush = () => {
      flushEditorNow();
      flushPendingTitle();
      cachedNotesWriterRef.current.flush();
    };
    const handleVisibility = () => {
      if (document.hidden) {
        handleImmediateFlush();
      }
    };
    window.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleImmediateFlush);

    const unlistenHidePromise = registerPanelHideHandler(handleImmediateFlush);

    return () => {
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleImmediateFlush);
      unlistenHidePromise?.then((unlisten) => unlisten());
    };
  }, [flushPendingTitle]);

  // Prefetch secondary Settings window, Markdown modal, and CommandPalette sub-views chunks after 1500ms idle timer
  useEffect(() => {
    const timer = setTimeout(() => {
      import("./SettingsApp");
      import("./components/MarkdownViewerModal");
      import("./components/PaletteSubViews");
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Updates note content and metadata:
   * - Receives explicit target `id` captured when save started, NEVER reading mutable active note state.
   * - Extracts title from the first document node (or uses `titleHint` if provided).
   * - Updates synchronous memory cache and localStorage immediately for zero UI lag.
   * - Persists changes asynchronously into SQLite via `updateNote()`.
   * - Computes plain-text preview snippet and updates the note list summary for `id`.
   */
  const handleUpdateNote = useCallback(
    async (id: string, content: string, titleHint?: string) => {
      if (!id) return;
      try {
        const currentSummary = notes.find((n) => n.id === id);
        const cachedNote = noteCache.get(id);
        const existingTitle = (cachedNote?.title && cachedNote.title !== "Untitled")
          ? cachedNote.title
          : (currentSummary?.title || cachedNote?.title || "");
        const title = (titleHint !== undefined && titleHint.trim().length > 0)
          ? titleHint.trim()
          : (existingTitle || "Untitled");

        noteCache.updateContent(id, content, title);

        const newUpdatedAt = await updateNote(id, title, content);

        const preview = getPreviewText(content);

        setNotes((prev) => {
          const updated = prev.map((n) =>
            n.id === id
              ? {
                ...n,
                title,
                preview,
                updated_at: newUpdatedAt,
              }
              : n
          );
          pendingCachedNotesJsonRef.current = JSON.stringify(updated);
          cachedNotesWriterRef.current.schedule();
          return updated;
        });

        setActiveNoteSummary((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                title,
                preview,
                updated_at: newUpdatedAt,
              }
            : prev
        );

        return newUpdatedAt;
      } catch (err: any) {
        console.error("Failed to update note:", err);
        const errMsg = String(err?.message || err || "");
        if (
          errMsg === "NOTE_NOT_FOUND" ||
          errMsg.includes("NOTE_NOT_FOUND") ||
          errMsg.includes("Query returned no rows") ||
          errMsg.includes("QueryReturnedNoRows")
        ) {
          console.warn(`[save] Note ${id} missing from SQLite. Routing to orphan recovery.`);
          showToast(
            "Note no longer exists in database. Recovering changes...",
            <AlertTriangle size={14} className="text-amber-400" />
          );
          try {
            await handleRecoverOrphan(content, id);
            return;
          } catch (orphanErr) {
            console.error("Orphan recovery failed inside handleUpdateNote:", orphanErr);
            saveStatusStore.setBlocked(true, id, "Failed to recover missing note");
            throw orphanErr;
          }
        }
        throw err;
      }
    },
    [notes, handleRecoverOrphan, showToast]
  );

  /**
   * Deletes a note by ID:
   * 1. Permanently removes row from SQLite.
   * 2. Evicts note content from in-memory cache.
   * 3. Clears localStorage snapshot if it matches deleted ID.
   * 4. Selects the next available note if the deleted note was currently active.
   */
  const handleDeleteNote = useCallback(
    async (id: string) => {
      try {
        await deleteNote(id);
        noteCache.delete(id);
        const savedId = localStorage.getItem("notefast_active_note_id");
        if (savedId === id) {
          safeLocalStorageRemoveItem("notefast_active_note_id");
          safeLocalStorageRemoveItem("notefast_active_note_content");
          safeLocalStorageRemoveItem("notefast_active_note_base_updated_at");
          safeLocalStorageRemoveItem("notefast_active_note_unsaved");
        }
        // Refetch recents after every delete
        const freshRecents = await getRecentNotes(30);
        setRecentNotes(freshRecents);
        safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(freshRecents));

        if (activeNoteId === id) {
          if (freshRecents.length > 0) {
            handleSelectNote(freshRecents[0].id, freshRecents[0]);
          } else {
            setActiveNoteId(null);
            setActiveNoteSummary(null);
            try {
              localStorage.removeItem("notefast_active_note_id");
            } catch {}
          }
        }
        showToast("Note deleted", <Trash2 size={14} />);
      } catch (err) {
        console.error("Failed to delete note:", err);
      }
    },
    [activeNoteId, handleSelectNote, showToast]
  );

  const handleConflictSaveAsNew = useCallback(async () => {
    if (!switchConflict) return;
    await handleRecoverOrphan(switchConflict.content, switchConflict.failedNoteId);
    setSwitchConflict(null);
    saveStatusStore.reset();
    if (switchConflict.targetNoteId && switchConflict.targetNoteId !== switchConflict.failedNoteId) {
      handleSelectNote(switchConflict.targetNoteId);
    }
  }, [switchConflict, handleRecoverOrphan, handleSelectNote]);

  const handleConflictCopy = useCallback(async () => {
    if (!switchConflict) return;
    const textToCopy = switchConflict.text || switchConflict.content;
    const ok = await copyToClipboard(textToCopy);
    if (ok) {
      showToast("Note content copied to clipboard", <Check size={14} />);
    } else {
      showToast("Failed to copy to clipboard", <AlertTriangle size={14} className="text-amber-400" />);
    }
  }, [switchConflict, showToast]);

  const handleConflictDiscard = useCallback(() => {
    if (!switchConflict) return;
    setDiscardedNoteId(switchConflict.failedNoteId);
    const targetId = switchConflict.targetNoteId;
    setSwitchConflict(null);
    saveStatusStore.reset();
    if (targetId && targetId !== switchConflict.failedNoteId) {
      handleSelectNote(targetId);
    }
  }, [switchConflict, handleSelectNote]);

  const handleOpenSaveConflict = useCallback(() => {
    if (activeNoteId) {
      const cached = noteCache.get(activeNoteId);
      setSwitchConflict({
        failedNoteId: activeNoteId,
        targetNoteId: null,
        content: cached?.content || "",
        text: getPreviewText(cached?.content || ""),
      });
    }
  }, [activeNoteId]);

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

  /**
   * Toggles the pin status of a note.
   * Updates active summary and refetches recents to ensure strictly DB-canonical order.
   */
  const handleTogglePin = useCallback(
    async (id: string) => {
      try {
        const isPinned = await togglePin(id);
        setActiveNoteSummary((prev) => (prev && prev.id === id ? { ...prev, is_pinned: isPinned } : prev));
        const freshRecents = await getRecentNotes(30);
        setRecentNotes(freshRecents);
        safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(freshRecents));
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

  /**
   * Converts the active note's TipTap JSON/HTML to clean Markdown and writes to the system clipboard.
   */
  const handleCopyNoteAsMarkdown = useCallback(async () => {
    if (!activeNoteId) return;
    let content = noteCache.get(activeNoteId)?.content;
    if (!content) {
      const full = await getNote(activeNoteId);
      content = full?.content || "";
    }
    const md = noteContentToMarkdown(content, activeNote?.title);
    const ok = await copyToClipboard(md);
    if (ok) {
      showToast("Copied note as Markdown", <Check size={14} />);
    } else {
      showToast("Failed to copy to clipboard", <AlertTriangle size={14} className="text-amber-400" />);
    }
  }, [activeNoteId, activeNote, showToast]);

  /**
   * Strips all formatting and copies the active note as plain text.
   */
  const handleCopyNoteAsText = useCallback(async () => {
    if (!activeNoteId) return;
    let content = noteCache.get(activeNoteId)?.content;
    if (!content) {
      const full = await getNote(activeNoteId);
      content = full?.content || "";
    }
    const text = noteContentToPlainText(content, activeNote?.title);
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast("Copied note as Plain Text", <Check size={14} />);
    } else {
      showToast("Failed to copy to clipboard", <AlertTriangle size={14} className="text-amber-400" />);
    }
  }, [activeNoteId, activeNote, showToast]);

  /**
   * Copies the custom URI scheme (`notefast://note/<id>`) to the clipboard for linking notes.
   */
  const handleCopyDeeplink = useCallback(async () => {
    if (!activeNoteId) return;
    const deeplink = `notefast://note/${activeNoteId}`;
    const ok = await copyToClipboard(deeplink);
    if (ok) {
      showToast("Deeplink copied to clipboard", <Link2 size={14} />);
    } else {
      showToast("Failed to copy to clipboard", <AlertTriangle size={14} className="text-amber-400" />);
    }
  }, [activeNoteId, showToast]);

  /**
   * Exports the active note to a local `.md` file using browser download primitives.
   */
  const handleExportNote = useCallback(async () => {
    if (!activeNoteId) return;
    let content = noteCache.get(activeNoteId)?.content;
    if (!content) {
      const full = await getNote(activeNoteId);
      content = full?.content || "";
    }
    const title = getNoteTitle(activeNote?.title || "", activeNote?.preview || content);
    const filename = `${title.replace(/[/\\?%*:|"<>]/g, "-") || "Note"}.md`;
    const md = noteContentToMarkdown(content, activeNote?.title);
    downloadFile(filename, md, "text/markdown");
    showToast(`Exported "${filename}"`, <FileDown size={14} />);
  }, [activeNoteId, activeNote, showToast]);

  /**
   * Batch exports all notes from SQLite into individual Markdown files via Tauri native dialog.
   */
  const handleExportAllNotes = useCallback(async () => {
    if (notes.length === 0) {
      showToast("No notes to export");
      return;
    }
    try {
      const resultMsg = await exportAllNotesFromDb();
      showToast(resultMsg || `Exported ${notes.length} note${notes.length > 1 ? "s" : ""}`, <FileDown size={14} />);
    } catch (err) {
      console.error("Export all failed:", err);
      showToast("Export failed", <Trash2 size={14} />);
    }
  }, [notes.length, showToast]);

  /**
   * Increases editor typography scale by 10% (max 200%) and broadcasts change across windows.
   */
  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.min(Math.round((prev + 0.1) * 10) / 10, 2.0);
      showToast(`Zoom: ${Math.round(next * 100)}%`, <ZoomIn size={14} />);
      broadcastSync({ type: "zoom", value: next });
      return next;
    });
  }, [showToast]);

  /**
   * Decreases editor typography scale by 10% (min 60%) and broadcasts change across windows.
   */
  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.max(Math.round((prev - 0.1) * 10) / 10, 0.6);
      showToast(`Zoom: ${Math.round(next * 100)}%`, <ZoomOut size={14} />);
      broadcastSync({ type: "zoom", value: next });
      return next;
    });
  }, [showToast]);

  /**
   * Resets typography zoom to the 120% default setting.
   */
  const handleResetZoom = useCallback(() => {
    setZoomLevel(1.2);
    showToast("Zoom: 120% (Default)", <RotateCcw size={14} />);
    broadcastSync({ type: "zoom", value: 1.2 });
  }, [showToast]);

  /**
   * Master Global Keyboard Shortcuts Router:
   * Listens on window 'keydown' to handle hotkeys (Cmd+W hide, Cmd+N new note,
   * Cmd+K command palette, Cmd+F find, Cmd+D duplicate, Cmd+P pin, zoom shortcuts, etc.),
   * respecting customizable user-configured hotkey overrides.
   */
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

      // Command Palette (Cmd+K)
      if (isTriggered("search", "⌘K")) {
        e.preventDefault();
        e.stopPropagation();
        if (isCommandPaletteOpen && paletteInitialView === "actions") {
          setIsCommandPaletteOpen(false);
        } else {
          handleOpenCommandPalette("actions");
        }
        return;
      }

      // Dedicated Smart Document Search & Quick Switcher (Cmd+P)
      if (isTriggered("browse", "⌘P") || isTriggered("smart_search", "⌘P")) {
        e.preventDefault();
        e.stopPropagation();
        if (isSmartSearchOpen) {
          setIsSmartSearchOpen(false);
        } else {
          handleOpenSmartSearch();
        }
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
        if (isSmartSearchOpen) {
          setIsSmartSearchOpen(false);
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
        // Defocus and unselect: collapse window selection & blur active element
        window.getSelection()?.removeAllRanges();
        const active = document.activeElement as HTMLElement | null;
        if (active) {
          active.blur();
        }
        return;
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
    isSmartSearchOpen,
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
      className={`app-shell ${isCursorInPage ? "is-cursor-in-page is-interactive" : "is-idle"}`}
      onMouseEnter={() => setIsMouseOverApp(true)}
      onMouseLeave={() => setIsMouseOverApp(false)}
      onPointerMove={() => {
        if (!isMouseOverApp) setIsMouseOverApp(true);
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <WindowResizeHandles />

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
        title={activeNote ? getNoteTitle(activeNote.title, activeNote.preview) : "rayNote"}
        onNewNote={handleNewNote}
        onOpenCommandPalette={() => handleOpenCommandPalette("actions")}
        onOpenSmartSearch={handleOpenSmartSearch}
        onDuplicateNote={handleDuplicateNote}
        onDeleteNote={() => activeNoteId && promptDeleteNote(activeNoteId)}
        onCopyMarkdown={handleCopyNoteAsMarkdown}
        onTriggerImportFile={handleTriggerImportFile}
        onTriggerViewFile={handleTriggerViewFile}
        onOpenSaveConflict={handleOpenSaveConflict}
      />

      {/* Top frosted glass blend scrim */}
      <div className="app-top-blend" aria-hidden="true" />

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
              Would you like to import this Markdown document into your rayNote notes or just view it?
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
                  <span className="btn-sub-label">Save into rayNote notes database</span>
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
          noteId={activeNoteId}
          noteTitle={activeNote?.title || ""}
          onSetTitle={handleSetTitle}
          onUpdate={handleUpdateNote}
          onRecoverOrphan={handleRecoverOrphan}
          onSwitchFailed={handleSwitchFailed}
          onSwitchConflict={(info) => setSwitchConflict(info)}
          discardedNoteId={discardedNoteId}
          zoomLevel={zoomLevel}
          isFindOpen={isFindOpen}
          onCloseFind={() => setIsFindOpen(false)}
        />
      </div>


      {isCommandPaletteOpen && (
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
                noteCache.clear();
                showToast("All notes cleared", <Trash2 size={14} />);
              }).catch(console.error);
            }
          }}
          onOpenSmartSearch={handleOpenSmartSearch}
        />
      )}

      <ShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      <SmartSearch
        isOpen={isSmartSearchOpen}
        onClose={() => setIsSmartSearchOpen(false)}
        onSelectNote={handleSelectNote}
        activeNoteId={activeNoteId}
      />

      {/* Markdown Quick Viewer Modal (No Upload) */}
      {previewFile && (
        <Suspense fallback={null}>
          <MarkdownViewerModal
            fileData={previewFile}
            onClose={() => setPreviewFile(null)}
            onShowToast={showToast}
            onImportToNotes={async (title, markdown) => {
              try {
                const newNote = await createNote();
                await updateNote(newNote.id, title, markdown);
                const preview = getPreviewText(markdown);
                noteCache.set(newNote.id, markdown, new Date().toISOString(), preview);
                const summary: NoteSummary = {
                  id: newNote.id,
                  title,
                  preview,
                  created_at: newNote.created_at,
                  updated_at: new Date().toISOString(),
                  is_pinned: false,
                };
                setNotes((prev) => [summary, ...prev.filter((n) => n.id !== summary.id)].slice(0, 30));
                handleSelectNote(newNote.id);
                setPreviewFile(null);
                showToast(`Imported "${title}" to notes`, <Check size={14} />);
              } catch (err) {
                console.error(err);
                showToast("Failed to import note", <Trash2 size={14} />);
              }
            }}
          />
        </Suspense>
      )}

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

      <SwitchConflictModal
        conflict={switchConflict}
        onSaveAsNewNote={handleConflictSaveAsNew}
        onCopyText={handleConflictCopy}
        onDiscardAndSwitch={handleConflictDiscard}
        onClose={() => setSwitchConflict(null)}
      />

      <Toast toast={toast} />
    </div>
  );
}

export default App;
