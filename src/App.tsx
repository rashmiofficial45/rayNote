import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { safeLocalStorageGetItem } from "./lib/storage";
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
import { SmartSearch, clearCachedRecentSearchResults } from "./components/SmartSearch";
import { SwitchConflictModal, SwitchConflictInfo } from "./components/SwitchConflictModal";
import { saveStatusStore } from "./lib/saveStatusStore";
import { copyToClipboard } from "./lib/clipboard";
import type { PreviewFileData } from "./components/MarkdownViewerModal";
const MarkdownViewerModal = lazy(() =>
  import("./components/MarkdownViewerModal").then((m) => ({ default: m.MarkdownViewerModal }))
);
import { WindowResizeHandles } from "./components/WindowResizeHandles";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeLocalStorageSetItem, safeLocalStorageRemoveItem, createCoalescedWriter, readActiveNoteSnapshot, clearActiveNoteSnapshot } from "./lib/storage";
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
  getAllNotes,
  getAdjacentNote,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  discardEditorNote,
  readEditorRecoverySnapshot,
  getEditorNoteId,
  handoffEditorRecovery,
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
  type Note,
  NoteSummary,
} from "./lib/db";
import { initTheme } from "./lib/theme";
import { registerEditorFlushHandler } from "./lib/editorFlush";
import { registerClearAllNotesHandler } from "./lib/noteDeletion";
import { noteCache } from "./lib/noteCache";
import { titleStore } from "./lib/titleStore";
import { blockSelectionPluginKey } from "./extensions/BlockSelection";
import { broadcastSync, listenToSettingsSync, matchesEvent, nativeShortcut } from "./lib/settingsSync";
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
      const cached = safeLocalStorageGetItem("notefast_cached_notes");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { }
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
    const saved = readActiveNoteSnapshot()?.id || safeLocalStorageGetItem("notefast_active_note_id");
    if (saved) return saved;
    try {
      const cached = safeLocalStorageGetItem("notefast_cached_notes");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
      }
    } catch { }
    return null;
  });

  // Active fetch tracker to guard against out-of-order SQLite responses
  const activeFetchIdRef = useRef(0);
  const [isClearingNotes, setIsClearingNotes] = useState(false);
  const clearingNotesRef = useRef<Promise<void> | null>(null);
  const deletingNoteRef = useRef<string | null>(null);

  const [isBootReady, setIsBootReady] = useState(false);
  const [activePanel, setActivePanel] = useState<"palette" | "notes" | "shortcuts" | "find" | null>(null);
  const [paletteInitialView, setPaletteInitialView] = useState<"actions" | "settings">("actions");
  const closePalette = useCallback(() => setActivePanel((panel) => panel === "palette" ? null : panel), []);
  const closeSmartSearch = useCallback(() => setActivePanel((panel) => panel === "notes" ? null : panel), []);
  const closeShortcuts = useCallback(() => setActivePanel((panel) => panel === "shortcuts" ? null : panel), []);
  const closeFind = useCallback(() => setActivePanel((panel) => panel === "find" ? null : panel), []);
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = safeLocalStorageGetItem("notefast_cached_notes");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch { }
    return true;
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{ noteId: string; agreed: boolean } | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = safeLocalStorageGetItem("notefast_zoom_level");
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0.6 && parsed <= 2.0) {
        return parsed;
      }
    }
    return 1.2; // 120% default
  });

  const [switchConflict, setSwitchConflict] = useState<SwitchConflictInfo | null>(null);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [discardedNoteId, setDiscardedNoteId] = useState<string | null>(null);

  const [escLosesFocus, setEscLosesFocus] = useState<boolean>(() => {
    return safeLocalStorageGetItem("notefast_esc_loses_focus") === "true";
  });

  const [commandsConfig, setCommandsConfig] = useState<CommandRow[]>(getStoredCommandsConfig);

  // Focus and cursor tracking for hiding menu bar and formatting controls in idle mode
  const [isWindowFocused, setIsWindowFocused] = useState(() => {
    return typeof document !== "undefined" ? document.hasFocus() : true;
  });
  const [isMouseOverApp, setIsMouseOverApp] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow().isFocused().then((focused) => {
      setIsWindowFocused(focused);
    }).catch(() => { });

    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      setIsWindowFocused(focused);
      if (!focused) {
        setIsMouseOverApp(false);
      }
    }).then((fn) => {
      if (disposed) fn(); else unlisten = fn;
    }).catch(() => { });

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
      disposed = true;
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
        activeFetchIdRef.current++;
        const snapshot = readActiveNoteSnapshot();
        if (snapshot) discardEditorNote(snapshot.id);
        setNotes([]);
        setActiveNoteId(null);
        setActiveNoteSummary(null);
        titleStore.reset();
        noteCache.clear();
        clearCachedRecentSearchResults();
        clearActiveNoteSnapshot();
      },
      onFlushRequested: () => {
        flushEditorNow().then(() => flushSaveQueue()).catch(console.error);
      },
    });
  }, []);

  // Ensure the app and window always gain focus on user click, interaction, or scrolling
  useEffect(() => {
    const handleInteraction = () => {
      if (!document.hasFocus()) {
        window.focus();
        getCurrentWindow().setFocus().catch(() => { });
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
  const navigationHistoryRef = useRef<{ ids: string[]; index: number }>({ ids: [], index: -1 });
  const pendingNavigationRef = useRef<{ sourceId: string | null; requestId: number; history: { ids: string[]; index: number } } | null>(null);
  const selectedNoteIdRef = useRef(activeNoteId);
  const pruneHistory = useCallback((deleted: Set<string>) => {
    const history = navigationHistoryRef.current;
    const index = history.ids.slice(0, history.index + 1).filter(id => !deleted.has(id)).length - 1;
    navigationHistoryRef.current = { ids: history.ids.filter(id => !deleted.has(id)), index };
  }, []);

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
      console.warn(`[switch] Note switch aborted:`, err);
      setActiveNoteId(failedId);

      // Restore title and summary of the retained note (R05)
      const inRecents = recentNotes.find((n) => n.id === failedId);
      const cached = noteCache.get(failedId);
      if (inRecents) {
        setActiveNoteSummary(inRecents);
        titleStore.setTitle(inRecents.title);
      } else if (cached) {
        const title = cached.title || extractTitleFromMarkdown(cached.content) || "Untitled";
        titleStore.setTitle(title);
        const iso = new Date(cached.updatedAt).toISOString();
        setActiveNoteSummary({
          id: failedId,
          title,
          preview: getPreviewText(cached.content),
          created_at: iso,
          updated_at: iso,
          is_pinned: false,
        });
      } else {
        const fallbackNote = notes.find((n) => n.id === failedId);
        if (fallbackNote) {
          setActiveNoteSummary(fallbackNote);
          titleStore.setTitle(fallbackNote.title);
        } else {
          titleStore.reset();
        }
      }

      if (cached) {
        noteCache.persistActiveToLocalStorage(failedId, cached.content, cached.baseUpdatedAt, cached.unsaved);
      } else {
        safeLocalStorageSetItem("notefast_active_note_id", failedId);
      }

      const pendingNavigation = pendingNavigationRef.current;
      if (pendingNavigation?.sourceId === failedId && pendingNavigation.requestId === activeFetchIdRef.current) {
        navigationHistoryRef.current = pendingNavigation.history;
        pendingNavigationRef.current = null;
      }
      selectedNoteIdRef.current = failedId;

      const isTargetLoadError =
        err instanceof Error &&
        (err.message.includes("could not be loaded") || err.message.includes("Failed to load"));

      showToast(
        isTargetLoadError
          ? "Failed to open note. Staying on current note."
          : "Save failed. Staying on current note to protect unsaved changes.",
        <AlertTriangle size={14} className="text-amber-400" />
      );
    },
    [notes, recentNotes, showToast]
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
  const handleSelectNote = useCallback((id: string, summaryHint?: NoteSummary, recordHistory = true, historyIndex?: number) => {
    const requestId = ++activeFetchIdRef.current;
    if (recordHistory || historyIndex !== undefined) {
      const history = navigationHistoryRef.current;
      const previousPending = pendingNavigationRef.current;
      const liveId = getEditorNoteId();
      const supersedesPending = liveId !== null && previousPending && liveId === previousPending.sourceId && liveId !== selectedNoteIdRef.current;
      pendingNavigationRef.current = {
        sourceId: supersedesPending ? previousPending.sourceId : selectedNoteIdRef.current, requestId,
        history: supersedesPending ? previousPending.history : { ids: [...history.ids], index: history.index },
      };
    }
    selectedNoteIdRef.current = id;
    setActiveNoteId(id);

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
      const history = navigationHistoryRef.current;
      const ids = [...history.ids.slice(0, history.index + 1), id].slice(-50);
      navigationHistoryRef.current = { ids, index: ids.length - 1 };
    } else if (historyIndex !== undefined) {
      navigationHistoryRef.current = { ...navigationHistoryRef.current, index: historyIndex };
    }

    // Fast in-memory LRU cache check (0ms instantaneous switch)
    let cached = noteCache.get(id);
    if (!cached) {
      const snapshot = readActiveNoteSnapshot();
      if (snapshot?.id === id && snapshot.unsaved) {
        noteCache.set(id, snapshot.content, snapshot.baseUpdatedAt, undefined, 0, true);
        cached = noteCache.get(id);
      }
    }
    if (!cached) {
      // A pending load must not leave the previous note's recovery content under this ID.
      noteCache.persistActiveToLocalStorage(id, "");
      // Single fetch: populates both noteCache and activeNoteSummary
      getNote(id)
        .then((fullNote) => {
          if (activeFetchIdRef.current === requestId && fullNote) {
            // The editor may have accepted edits while this duplicate summary fetch was pending.
            if (noteCache.peek(id)?.unsaved) return;
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
            noteCache.persistActiveToLocalStorage(id, fullNote.content, fullNote.updated_at, false);
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
      noteCache.persistActiveToLocalStorage(id, cached.content, cached.baseUpdatedAt, cached.unsaved);
    }
  }, [recentNotes]);

  if (typeof window !== "undefined") {
    (window as any).__RAYNOTE_SELECT_NOTE__ = handleSelectNote;
  }

  // Local Markdown File Import & Preview States
  const [previewFile, setPreviewFile] = useState<PreviewFileData | null>(null);
  const [droppedFilePrompt, setDroppedFilePrompt] = useState<{ file: File; text: string } | null>(null);

  const hasBlockingDialog = Boolean(deleteConfirm || droppedFilePrompt || previewFile || switchConflict);
  const visiblePanel = hasBlockingDialog ? null : activePanel;

  useEffect(() => {
    if (hasBlockingDialog) setActivePanel(null);
  }, [hasBlockingDialog]);
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
  const pendingRecoveriesRef = useRef(new Map<string, Promise<string>>());
  const handleRecoverOrphan = useCallback(
    (content: string, sourceId?: string): Promise<string> => {
      const recoveryKey = sourceId || readActiveNoteSnapshot()?.id || "unknown";
      const pending = pendingRecoveriesRef.current.get(recoveryKey);
      if (pending) return pending;
      const operation = (async () => {
      try {
        // Idempotent recovery check: was a recovery already started for THIS snapshot before a crash?
        const currentSourceId = sourceId || readActiveNoteSnapshot()?.id || safeLocalStorageGetItem("notefast_active_note_id") || "unknown";
        let existingRecoveredId: string | null = null;
        const rawRecovered = safeLocalStorageGetItem("notefast_recovered_note_id");
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
          // Canonical absence is null. Read failures must retain the recovery marker.
          note = await getNote(existingRecoveredId);
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

        const readLatest = (fallback = content) => readEditorRecoverySnapshot(currentSourceId)?.content
          ?? noteCache.peek(currentSourceId)?.content ?? fallback;
        const recoveryTitle = (value: string): string => {
          try {
            const doc = JSON.parse(value);
            for (const node of doc.content || []) {
              const text = (node.content || []).map((child: { text?: string }) => child.text || "").join("").trim();
              if (text) return text;
            }
            return title;
          } catch { return extractTitleFromMarkdown(value, title); }
        };
        let finalContent = readLatest();
        let finalUpdatedAt: string;
        // Recheck the live editor after every awaited write. The synchronous handoff
        // closes the last race and keeps its document/undo state intact.
        for (;;) {
          const finalTitle = recoveryTitle(finalContent);
          finalUpdatedAt = await updateNote(note.id, finalTitle, finalContent);
          noteCache.set(note.id, finalContent, finalUpdatedAt, finalTitle, 0, false);
          const latest = readLatest(finalContent);
          if (latest !== finalContent) { finalContent = latest; continue; }
          if (handoffEditorRecovery(currentSourceId, note.id, finalContent, finalTitle)) break;
          finalContent = readLatest(finalContent);
        }

        // The replacement is durable. Stop the old editor from saving/recovering its missing ID again.
        discardEditorNote(currentSourceId);
        setDiscardedNoteId(currentSourceId);
        noteCache.delete(currentSourceId);
        clearActiveNoteSnapshot(currentSourceId);

        // 3. Update localStorage pointers to point to the newly recovered note
        noteCache.persistActiveToLocalStorage(note.id, finalContent, finalUpdatedAt, false);
        safeLocalStorageRemoveItem("notefast_recovered_note_id");

        // 4. Switch active selection to the new note
        handleSelectNote(note.id);
        try {
          const freshRecents = await getRecentNotes(30);
          setRecentNotes(freshRecents);
          safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(freshRecents));
        } catch {
          // Failure to refresh recents must not reject an already durable recovery (R04)
        }

        showToast("Recovered unsaved note into a new document", <Check size={14} />);
        return note.id;
      } catch (err) {
        console.error("Failed to recover orphan note:", err);
        throw err;
      }
      })();
      pendingRecoveriesRef.current.set(recoveryKey, operation);
      operation.finally(() => pendingRecoveriesRef.current.delete(recoveryKey)).catch(() => {});
      return operation;
    },
    [handleSelectNote, showToast]
  );

  // Load notes, initialize theme & apply always on top on mount
  useEffect(() => {
    const stopTheme = initTheme();
    loadNotes();
    const savedAlwaysOnTop = safeLocalStorageGetItem("notefast_always_on_top") !== "false";
    setAlwaysOnTop(savedAlwaysOnTop).catch(console.error);
    return stopTheme;
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

      const snapshot = readActiveNoteSnapshot();
      const savedId = snapshot?.id || safeLocalStorageGetItem("notefast_active_note_id");
      const savedContent = snapshot?.content;
      const isUnsaved = snapshot?.unsaved === true;

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
          let inDb: Note | null = null;
          let dbCheckFailed = false;
          try {
            inDb = await getNote(savedId);
          } catch (e: any) {
            const msg = String(e?.message || e || "");
            if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("does not exist")) {
              inDb = null;
            } else {
              dbCheckFailed = true;
              console.warn("Failed to check note existence in DB:", e);
            }
          }

          if (dbCheckFailed) {
            // Read failed, NOT absent! Do not treat as missing note or recover orphan (R03).
            handleSelectNote(savedId);
          } else if (inDb) {
            handleSelectNote(inDb.id, {
              id: inDb.id,
              title: inDb.title,
              preview: inDb.preview,
              created_at: inDb.created_at,
              updated_at: inDb.updated_at,
              is_pinned: inDb.is_pinned,
            }, false);
          } else {
            // Note row is cleanly MISSING from DB!
            let recoveredId: string | null = null;
            const rawRecovered = safeLocalStorageGetItem("notefast_recovered_note_id");
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
              let recoveredNote: Note | null = null;
              let recoveredCheckFailed = false;
              try {
                recoveredNote = await getNote(recoveredId);
              } catch (e: any) {
                const msg = String(e?.message || e || "");
                if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("does not exist")) {
                  recoveredNote = null;
                } else {
                  recoveredCheckFailed = true;
                  console.warn("Failed to lookup recovered note:", e);
                }
              }
              if (recoveredCheckFailed) {
                // Read failed for recovered note - do not assume absent or re-clone
                handleSelectNote(recoveredId);
                return;
              }
              if (recoveredNote && isUnsaved && savedContent) {
                await handleRecoverOrphan(savedContent, savedId);
                return;
              }
              if (recoveredNote) {
                // The recovered note was already created and persisted in SQLite before previous crash
                clearActiveNoteSnapshot(savedId);
                noteCache.persistActiveToLocalStorage(recoveredNote.id, recoveredNote.content, recoveredNote.updated_at, false);
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
              // Unsaved snapshot whose note is genuinely missing from DB: create new note with content, switch to it, clear snapshot
              await handleRecoverOrphan(savedContent, savedId);
            } else {
              // Clean orphan: clear snapshot and select first recent note if any
              clearActiveNoteSnapshot();
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
      setIsBootReady(true);
    }
  };

  /**
   * Navigates backward in the note navigation history stack.
   */
  const handleGoBack = useCallback(() => {
    const history = navigationHistoryRef.current;
    if (history.index > 0) {
      const index = history.index - 1;
      handleSelectNote(history.ids[index], undefined, false, index);
      showToast("Navigated Back");
    }
  }, [handleSelectNote, showToast]);

  const handleGoForward = useCallback(() => {
    const history = navigationHistoryRef.current;
    if (history.index < history.ids.length - 1) {
      const index = history.index + 1;
      handleSelectNote(history.ids[index], undefined, false, index);
      showToast("Navigated Forward");
    }
  }, [handleSelectNote, showToast]);

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
      await flushEditorNow();
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
      await flushEditorNow();
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
      await flushEditorNow();
      await flushSaveQueue();
      let content = noteCache.get(activeNoteId)?.content;
      if (!content) {
        const full = await getNote(activeNoteId);
        content = full?.content || "";
      }
      const currentSummary = notes.find((n) => n.id === activeNoteId);
      const note = await createNote();
      const sourceTitle = noteCache.peek(activeNoteId)?.title || currentSummary?.title || activeNoteSummary?.title;
      const title = sourceTitle ? `${sourceTitle} (Copy)` : "Untitled (Copy)";
      try {
        const doc = JSON.parse(content);
        if (doc.content?.[0]?.type === "heading" && doc.content[0].attrs?.level === 1) {
          doc.content[0].content = [{ type: "text", text: title }];
          content = JSON.stringify(doc);
        }
      } catch {
        content = content.replace(/^#\s+[^\r\n]+/, `# ${title}`);
      }
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

  const nativeActionsRef = useRef({ handleNewNote, handleSelectNote, showToast, isBootReady });
  nativeActionsRef.current = { handleNewNote, handleSelectNote, showToast, isBootReady };
  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const subscribe = (event: string, action: () => void | Promise<unknown>) => {
      listen(event, action).then(stop => { if (disposed) stop(); else stops.push(stop); }).catch(console.error);
    };
    subscribe("new-note", () => nativeActionsRef.current.handleNewNote());
    const openPending = async () => {
      if (disposed || !nativeActionsRef.current.isBootReady) return;
      const id = await invoke<string | null>("take_pending_note_link");
      if (!disposed && id) nativeActionsRef.current.handleSelectNote(id);
    };
    subscribe("open-note", openPending);
    subscribe("app-exit-canceled", () => nativeActionsRef.current.showToast("Unable to quit: changes could not be saved. Please retry or copy your text.", <AlertTriangle size={14} />));
    return () => { disposed = true; stops.forEach(stop => stop()); };
  }, []);
  useEffect(() => {
    if (!isBootReady) return;
    invoke<string | null>("take_pending_note_link").then(id => {
      if (id) nativeActionsRef.current.handleSelectNote(id);
    }).catch(console.error);
  }, [isBootReady]);

  useEffect(() => {
    const command = commandsConfig.find(c => c.id === "toggle");
    try {
      invoke("set_toggle_shortcut", { shortcut: command?.enabled === false ? null : nativeShortcut(command?.hotkey || "⌘⇧Space") }).catch(console.error);
    } catch (error) { console.error("Invalid global shortcut", error); }
  }, [commandsConfig]);

  const handleOpenCommandPalette = useCallback(
    (view: "actions" | "settings" = "actions") => {
      // 1. Open palette immediately (0ms) with existing cached recents
      setPaletteInitialView(view);
      setActivePanel("palette");

      // 2. Concurrently flush in-flight editor/title saves and replace with fresh recents once drained
      const pendingFlush = flushEditorNow();
      flushPendingTitle();
      pendingFlush.then(() => flushSaveQueue()).then(async () => {
        try {
          const freshRecents = await getRecentNotes(30);
          setRecentNotes(freshRecents);
        } catch (e) {
          console.error("Failed to refresh recents on command palette open:", e);
        }
      }).catch(console.error);
    },
    [flushPendingTitle]
  );

  const handleOpenSmartSearch = useCallback(() => {
    // 1. Open SmartSearch immediately (0ms) with existing cached recents
    setActivePanel("notes");

    // 2. Concurrently flush in-flight editor/title saves and replace with fresh recents once drained
    const pendingFlush = flushEditorNow();
    flushPendingTitle();
    pendingFlush.then(() => flushSaveQueue()).then(async () => {
      try {
        const freshRecents = await getRecentNotes(30);
        setRecentNotes(freshRecents);
      } catch (e) {
        console.error("Failed to refresh recents on smart search open:", e);
      }
    }).catch(console.error);
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
      flushEditorNow().catch(console.error);
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
      if (deletingNoteRef.current || clearingNotesRef.current) return;
      deletingNoteRef.current = id;
      setIsClearingNotes(true);
      try {
        await flushEditorNow();
        flushPendingTitle();
        await flushSaveQueue();
        await deleteNote(id);
        pruneHistory(new Set([id]));
        discardEditorNote(id);
        if (activeNoteId === id) {
          activeFetchIdRef.current++;
          setDiscardedNoteId(id);
        }
        noteCache.delete(id);
        clearCachedRecentSearchResults();
        clearActiveNoteSnapshot(id);
        // Refetch recents after every delete
        const freshRecents = await getRecentNotes(30).catch(error => {
          console.error("Failed to refresh after deletion", error);
          return recentNotes.filter(note => note.id !== id);
        });
        setRecentNotes(freshRecents);
        safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(freshRecents));

        if (activeNoteId === id) {
          if (freshRecents.length > 0) {
            handleSelectNote(freshRecents[0].id, freshRecents[0]);
          } else {
            setActiveNoteId(null);
            setActiveNoteSummary(null);
            clearActiveNoteSnapshot(id);
          }
        }
        showToast("Note deleted", <Trash2 size={14} />);
      } catch (err) {
        console.error("Failed to delete note:", err);
      } finally {
        deletingNoteRef.current = null;
        setIsClearingNotes(false);
      }
    },
    [activeNoteId, handleSelectNote, showToast, flushPendingTitle]
  );

  const handleClearAllNotes = useCallback((): Promise<void> => {
    if (clearingNotesRef.current) return clearingNotesRef.current;
    if (deletingNoteRef.current) return Promise.reject(new Error("A note is being deleted. Please try again."));
    setIsClearingNotes(true);
    const operation = (async () => {
      await flushEditorNow();
      flushPendingTitle();
      await flushSaveQueue();
      const allNotes = await getAllNotes();
      const results = await Promise.allSettled(allNotes.map((n) => deleteNote(n.id)));
      const deleted = new Set(allNotes.filter((_, i) => results[i].status === "fulfilled").map(n => n.id));
      for (const id of deleted) {
        discardEditorNote(id);
        noteCache.delete(id);
      }
      pruneHistory(deleted);
      activeFetchIdRef.current++;
      const failures = results.filter(r => r.status === "rejected");
      const remaining = failures.length ? (await getRecentNotes(30).catch(error => {
        console.error("Failed to refresh after partial deletion", error);
        return allNotes;
      })).filter(n => !deleted.has(n.id)) : [];
      setNotes(remaining);
      clearCachedRecentSearchResults();
      cachedNotesWriterRef.current.cancel();
      pendingCachedNotesJsonRef.current = null;
      safeLocalStorageSetItem("notefast_cached_notes", JSON.stringify(remaining));
      if (!activeNoteId || deleted.has(activeNoteId)) {
        setDiscardedNoteId(activeNoteId);
        if (remaining.length) handleSelectNote(remaining[0].id, remaining[0]);
        else {
          setActiveNoteId(null);
          setActiveNoteSummary(null);
          titleStore.reset();
        }
      }
      if (!failures.length) {
        noteCache.clear();
        clearActiveNoteSnapshot();
        navigationHistoryRef.current = { ids: [], index: -1 };
      }
      if (failures.length) throw new Error(`Could not delete ${failures.length} note(s). Remaining notes were kept.`);
    })();
    clearingNotesRef.current = operation.finally(() => {
      clearingNotesRef.current = null;
      setIsClearingNotes(false);
    });
    return clearingNotesRef.current;
  }, [activeNoteId, flushPendingTitle]);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    registerClearAllNotesHandler(handleClearAllNotes).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    }).catch(console.error);
    return () => { disposed = true; stop?.(); };
  }, [handleClearAllNotes]);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    registerEditorFlushHandler(async () => {
      await flushEditorNow();
      await flushSaveQueue();
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(console.error);
    return () => { disposed = true; stop?.(); };
  }, []);

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
    if (!switchConflict) return false;
    const textToCopy = switchConflict.text || switchConflict.content;
    const ok = await copyToClipboard(textToCopy);
    if (ok) {
      showToast("Note content copied to clipboard", <Check size={14} />);
    } else {
      showToast("Failed to copy to clipboard", <AlertTriangle size={14} className="text-amber-400" />);
    }
    return ok;
  }, [switchConflict, showToast]);

  const conflictDiscardInFlightRef = useRef(false);
  const handleConflictDiscard = useCallback(async () => {
    if (!switchConflict || conflictDiscardInFlightRef.current) return;
    conflictDiscardInFlightRef.current = true;
    try {
    const targetId = switchConflict.targetNoteId;
    if (!targetId || targetId === switchConflict.failedNoteId) {
      try {
        await flushSaveQueue();
        const saved = await getNote(switchConflict.failedNoteId);
        if (!saved) throw new Error("The saved note is no longer available");
        if (getEditorNoteId() !== saved.id) return;
        // Invalidate the old editor before unmount so it cannot flush discarded
        // changes back over the saved version. Mount a clean editing session.
        discardEditorNote(saved.id);
        noteCache.set(saved.id, saved.content, saved.updated_at, saved.title, 0, false);
        noteCache.persistActiveToLocalStorage(saved.id, saved.content, saved.updated_at, false);
        setActiveNoteSummary(saved);
        titleStore.setTitle(saved.title);
        setDiscardedNoteId(null);
        setEditorReloadKey(key => key + 1);
        setSwitchConflict(null);
        saveStatusStore.reset();
      } catch (error) {
        console.error("Could not restore saved note", error);
        showToast("Could not restore saved note. Your edits are still available.");
      }
      return;
    }
    setDiscardedNoteId(switchConflict.failedNoteId);
    setSwitchConflict(null);
    saveStatusStore.reset();
    if (targetId && targetId !== switchConflict.failedNoteId) {
      handleSelectNote(targetId);
    }
    } finally {
      conflictDiscardInFlightRef.current = false;
    }
  }, [switchConflict, handleSelectNote, showToast]);

  const handleOpenSaveConflict = useCallback(() => {
    if (activeNoteId) {
      const cached = noteCache.get(activeNoteId);
      const content = readEditorRecoverySnapshot(activeNoteId)?.content || cached?.content || "";
      setSwitchConflict({
        failedNoteId: activeNoteId,
        targetNoteId: null,
        content,
        text: noteContentToPlainText(content),
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
    try {
    await flushEditorNow();
    await flushSaveQueue();
    let content = noteCache.get(activeNoteId)?.content;
    if (!content) {
      const full = await getNote(activeNoteId);
      content = full?.content || "";
    }
    const md = noteContentToMarkdown(content, noteCache.peek(activeNoteId)?.title || activeNote?.title);
    const ok = await copyToClipboard(md);
    if (ok) {
      showToast("Copied note as Markdown", <Check size={14} />);
    } else {
      showToast("Failed to copy to clipboard", <AlertTriangle size={14} className="text-amber-400" />);
    }
    } catch (error) {
      console.error("Unable to read the latest note content", error);
      showToast("Changes could not be saved. Please retry before copying or exporting.", <AlertTriangle size={14} />);
    }
  }, [activeNoteId, activeNote, showToast]);

  /**
   * Strips all formatting and copies the active note as plain text.
   */
  const handleCopyNoteAsText = useCallback(async () => {
    if (!activeNoteId) return;
    try {
    await flushEditorNow();
    await flushSaveQueue();
    let content = noteCache.get(activeNoteId)?.content;
    if (!content) {
      const full = await getNote(activeNoteId);
      content = full?.content || "";
    }
    const text = noteContentToPlainText(content, noteCache.peek(activeNoteId)?.title || activeNote?.title);
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast("Copied note as Plain Text", <Check size={14} />);
    } else {
      showToast("Failed to copy to clipboard", <AlertTriangle size={14} className="text-amber-400" />);
    }
    } catch (error) {
      console.error("Unable to read the latest note content", error);
      showToast("Changes could not be saved. Please retry before copying or exporting.", <AlertTriangle size={14} />);
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
    try {
    await flushEditorNow();
    await flushSaveQueue();
    let content = noteCache.get(activeNoteId)?.content;
    if (!content) {
      const full = await getNote(activeNoteId);
      content = full?.content || "";
    }
    const title = getNoteTitle(noteCache.peek(activeNoteId)?.title || activeNote?.title || "", activeNote?.preview || content);
    const filename = `${title.replace(/[/\\?%*:|"<>]/g, "-") || "Note"}.md`;
    const md = noteContentToMarkdown(content, noteCache.peek(activeNoteId)?.title || activeNote?.title);
    downloadFile(filename, md, "text/markdown");
    showToast(`Exported "${filename}"`, <FileDown size={14} />);
    } catch (error) {
      console.error("Unable to read the latest note content", error);
      showToast("Changes could not be saved. Please retry before copying or exporting.", <AlertTriangle size={14} />);
    }
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
      await flushEditorNow();
      await flushSaveQueue();
      const resultMsg = await exportAllNotesFromDb();
      showToast(resultMsg || `Exported ${notes.length} note${notes.length > 1 ? "s" : ""}`, <FileDown size={14} />);
    } catch (err) {
      console.error("Export all failed:", err);
      showToast("Changes could not be saved. Export aborted to protect unwritten edits.", <AlertTriangle size={14} className="text-amber-400" />);
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
      if (clearingNotesRef.current || deletingNoteRef.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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
        if (hasBlockingDialog) {
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        if (visiblePanel === "palette" && paletteInitialView === "actions") {
          closePalette();
        } else {
          handleOpenCommandPalette("actions");
        }
        return;
      }

      // Dedicated Smart Document Search & Quick Switcher (Cmd+P)
      if (isTriggered("browse", "⌘P")) {
        e.preventDefault();
        if (hasBlockingDialog) {
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        if (visiblePanel === "notes") {
          closeSmartSearch();
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
      const editor = (window as any).__RAYNOTE_EDITOR__;
      const hasBlockSelection = Boolean(
        editor?.state && blockSelectionPluginKey.getState(editor.state)?.selectedPositions?.length
      );
      if (isTriggered("duplicate", "⌘D") && !hasBlockSelection) {
        e.preventDefault();
        handleDuplicateNote();
        return;
      }

      // Find in Note
      if (isTriggered("find", "⌘F")) {
        e.preventDefault();
        if (hasBlockingDialog) {
          e.stopPropagation();
          return;
        }
        setActivePanel("find");
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
        if (hasBlockingDialog) {
          e.stopPropagation();
          return;
        }
        setActivePanel((panel) => panel === "shortcuts" ? null : "shortcuts");
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
        if (visiblePanel === "shortcuts") {
          closeShortcuts();
          return;
        }
        if (visiblePanel === "notes") {
          closeSmartSearch();
          return;
        }
        if (visiblePanel === "palette") {
          // Let the palette handle Escape from its own controls, including subviews.
          if (!(e.target instanceof Element && e.target.closest(".command-palette"))) closePalette();
          return;
        }
        if (visiblePanel === "find") {
          closeFind();
          return;
        }
        if (!escLosesFocus) {
          e.preventDefault();
          e.stopPropagation();
          hideWindow().catch(console.error);
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
    visiblePanel,
    hasBlockingDialog,
    paletteInitialView,
    handleOpenCommandPalette,
    handleOpenSmartSearch,
    closePalette,
    closeSmartSearch,
    closeShortcuts,
    closeFind,
  ]);

  if (isLoading) {
    return (
      <div className="app-shell flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[var(--color-accent-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`app-shell ${isCursorInPage ? "is-cursor-in-page is-interactive" : "is-idle"}`}
      inert={isClearingNotes}
      aria-busy={isClearingNotes}
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
            <Upload size={38} className="text-[var(--color-accent)] animate-bounce" />
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
                <FileText size={22} className="text-[var(--color-accent)]" />
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
          key={editorReloadKey}
          noteId={activeNoteId}
          hasNotes={isBootReady ? notes.length > 0 : undefined}
          onNewNote={handleNewNote}
          noteTitle={activeNote?.title || ""}
          onSetTitle={handleSetTitle}
          onUpdate={handleUpdateNote}
          onRecoverOrphan={handleRecoverOrphan}
          onSwitchFailed={handleSwitchFailed}
          onSwitchConflict={(info) => setSwitchConflict(info)}
          discardedNoteId={discardedNoteId}
          zoomLevel={zoomLevel}
          isFindOpen={visiblePanel === "find"}
          onCloseFind={closeFind}
        />
      </div>


      {visiblePanel === "palette" && (
        <CommandPalette
          isOpen
          onClose={closePalette}
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
          onFindInNote={() => setActivePanel("find")}
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
          onShowShortcuts={() => setActivePanel("shortcuts")}
          onTriggerImportFile={handleTriggerImportFile}
          onTriggerViewFile={handleTriggerViewFile}
          zoomLevel={zoomLevel}
          onSetZoom={(zoom) => {
            setZoomLevel(zoom);
            broadcastSync({ type: "zoom", value: zoom });
          }}
          onPromptClearAllNotes={async () => {
            if (!window.confirm("Are you sure you want to delete all notes? This cannot be undone.")) return;
            try {
              await handleClearAllNotes();
              showToast("All notes cleared", <Trash2 size={14} />);
            } catch (error) {
              console.error("Failed to clear notes:", error);
              showToast("Failed to clear all notes", <AlertTriangle size={14} />);
            }
          }}
          onOpenSmartSearch={handleOpenSmartSearch}
        />
      )}

      <ShortcutsModal
        isOpen={visiblePanel === "shortcuts"}
        onClose={closeShortcuts}
      />

      <SmartSearch
        isOpen={visiblePanel === "notes"}
        onClose={closeSmartSearch}
        onSelectNote={handleSelectNote}
        activeNoteId={activeNoteId}
        notes={notes}
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
                showToast(`Imported "${title}" to notes`, <Check size={14} />);
              } catch (err) {
                console.error(err);
                showToast("Failed to import note", <Trash2 size={14} />);
                throw err;
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
