import { ResourceUsageFooter } from "../components/ResourceUsage";
import { clearFormatMemory } from "./formatMemory";
/**
 * TipTap Note Editor Engine (Editor.tsx)
 *
 * Core architecture:
 * - Single Persistent Editor Instance: Maintains ONE mounted Tiptap editor across all note switches,
 *   completely eliminating component unmount/remount churn and layout flashes.
 * - In-Memory LRU Cache Integration: Queries `noteCache` for instantaneous 0ms document loading.
 * - Non-Blocking Debounced Persistence: Keeps typing latency at 0ms with a 300ms debounced save
 *   that synchronizes both the memory cache and SQLite.
 * - Zero Data-Loss Guarantees: Automatically flushes pending edits to cache and SQLite on note switch,
 *   window blur, or app exit.
 * - Scroll Memory: Restores per-note scroll positions seamlessly using requestAnimationFrame.
 * - Stale-While-Revalidate: Renders cached content immediately and verifies against SQLite in background.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useRef, useCallback, useState, useMemo, memo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getExtensions } from "./extensions";
import { SlashCommand } from "./SlashCommand";
import { BottomToolbar } from "../components/BottomToolbar";
import { FindBar } from "../components/FindBar";
import { SmoothCaret } from "../components/SmoothCaret";
import { FullscreenBlockControls } from "./FullscreenBlockControls";
import { ImageFullscreenContext } from "./ImageComponent";
import { FloatingCodeBlockToolbar } from "./FloatingCodeBlockToolbar";
import { DocumentTickSlider } from "../components/DocumentTickSlider";
import { useBlockDrag } from "../extensions/useBlockDrag";
import { getLastDragEndTime } from "../extensions/BlockSelection";
import {
  markdownToTipTapHtml,
  sliceToMarkdown,
} from "./markdownUtils";
import { noteCache, reconcileSnapshotWithDb } from "../lib/noteCache";
import { getNote, registerEditorFlush, registerEditorDiscard, registerEditorRecovery } from "../lib/db";
import { titleStore } from "../lib/titleStore";
import { saveStatusStore } from "../lib/saveStatusStore";
import { SwitchConflictInfo } from "../components/SwitchConflictModal";
import { clearActiveNoteSnapshot } from "../lib/storage";
import { preloadLanguagesForContent, scanCodeBlockLanguages, ensureLanguageLoaded } from "./extensions";
import { EditorContextMenu } from "./EditorContextMenu";
import { resolveContextMenuState, ContextMenuState } from "./contextMenuUtils";
import { LinkPopover, LinkPopoverData } from "./LinkPopover";
import { safeOpenUrl } from "../lib/linkUtils";

export interface EditorCharCountProps {
  editor: any;
  noteId: string;
}

/**
 * Adaptive debounce thresholds based on ProseMirror document size proxy (content.size).
 * Balances UI frame budget during continuous typing bursts against persistence frequency.
 */
export const DEBOUNCE_THRESHOLDS = {
  SMALL_DOC_MAX_SIZE: 20_000,
  MEDIUM_DOC_MAX_SIZE: 100_000,
  DELAY_SMALL_MS: 300,
  DELAY_MEDIUM_MS: 800,
  DELAY_LARGE_MS: 1500,
  MAX_WAIT_MS: 5000,
} as const;

export function getAdaptiveDebounceDelay(docSize: number): number {
  if (docSize >= DEBOUNCE_THRESHOLDS.MEDIUM_DOC_MAX_SIZE) {
    return DEBOUNCE_THRESHOLDS.DELAY_LARGE_MS;
  }
  if (docSize >= DEBOUNCE_THRESHOLDS.SMALL_DOC_MAX_SIZE) {
    return DEBOUNCE_THRESHOLDS.DELAY_MEDIUM_MS;
  }
  return DEBOUNCE_THRESHOLDS.DELAY_SMALL_MS;
}

export const EditorCharCount = memo(function EditorCharCount({
  editor,
  noteId,
}: EditorCharCountProps) {
  /**
   * Calculates character count incrementally across text nodes without creating or concatenating
   * intermediate string buffers in JavaScript heap. Debounced by 200ms during typing bursts.
   */
  const getDocCharCount = (doc: any): number => {
    if (!doc) return 0;
    if (typeof doc.descendants === "function") {
      let chars = 0;
      doc.descendants((node: any) => {
        if (node.isText && node.text) {
          chars += node.text.length;
        }
        return true;
      });
      return chars;
    }
    return doc.textContent?.length ?? 0;
  };

  const getDocWordCount = (doc: any): number => {
    if (!doc) return 0;
    const text = typeof doc.textBetween === "function"
      ? doc.textBetween(0, doc.content.size, "\n", " ")
      : doc.textContent ?? "";
    return text.trim() ? text.trim().split(/\s+/u).length : 0;
  };

  const [count, setCount] = useState<number>(() => {
    const doc = editor?.state?.doc;
    return getDocCharCount(doc);
  });
  const [words, setWords] = useState<number>(() => getDocWordCount(editor?.state?.doc));
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editor) return;

    const computeCount = () => {
      const doc = editor.state?.doc;
      const c = getDocCharCount(doc);
      setCount((prev: number) => (prev === c ? prev : c));
      setWords(getDocWordCount(doc));
    };

    // Immediate initial computation on load or note change
    computeCount();

    // Debounce recalculation by ~200ms during active typing to avoid O(N) traversals per keystroke
    const handleTransaction = ({ transaction }: { transaction: any }) => {
      if (transaction.docChanged) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          computeCount();
        }, 200);
      }
    };

    editor.on("transaction", handleTransaction);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      editor.off("transaction", handleTransaction);
    };
  }, [editor, noteId]);

  return (
    <div className="editor-char-count">
      <span>{words.toLocaleString()} {words === 1 ? "word" : "words"}</span>
      <span aria-hidden="true"> · </span>
      <span>{count.toLocaleString()} {count === 1 ? "character" : "characters"}</span>
    </div>
  );
});

interface EditorProps {
  initialContent?: string;
  content?: string;
  noteId: string;
  noteTitle?: string;
  onSetTitle?: (title: string) => void;
  onReadOnlyNoteChange?: (noteId: string | null) => void;
  onUpdate: (id: string, content: string, titleHint?: string) => Promise<string | void> | string | void;
  onRecoverOrphan?: (content: string, sourceId?: string) => void | Promise<void> | any;
  onSwitchFailed?: (failedId: string, error: unknown) => void;
  onSwitchConflict?: (info: SwitchConflictInfo) => void;
  discardedNoteId?: string | null;
  zoomLevel?: number;
  showBlockControls?: boolean;
  isFullscreen?: boolean;
  isFindOpen?: boolean;
  onCloseFind?: () => void;
  onEditorReady?: (editor: any) => void;
  onNavigateToNote?: (noteId: string) => void;
}

/**
 * Extracts note title from the document if the FIRST node is an explicit H1 heading.
 * Invariant (Title source rule): The title may come ONLY from child(0) being an H1.
 * Later H1 headings (typed or pasted) never change the title.
 * Returns undefined if child(0) is not an H1 so existing titles are never wiped.
 */
export const extractTitleFromDoc = (doc: any): string | undefined => {
  if (!doc || !doc.childCount) return undefined;
  const firstChild = doc.child(0);
  if (firstChild.type.name === "heading" && firstChild.attrs?.level === 1) {
    const text = firstChild.textContent?.trim();
    if (text) {
      return text.replace(/^#+\s*/, "").trim();
    }
  }
  return undefined;
};

const extractTitle = (json: any): string | undefined => {
  if (json && Array.isArray(json.content) && json.content.length > 0) {
    const firstNode = json.content[0];
    if (firstNode && firstNode.type === "heading" && firstNode.attrs?.level === 1) {
      if (Array.isArray(firstNode.content)) {
        const text = firstNode.content.map((n: any) => n.text || "").join("").trim();
        if (text) return text.replace(/^#+\s*/, "").trim();
      }
    }
  }
  return undefined;
};

export function ensureHeadingOneForDoc(docData: any): any {
  if (!docData) {
    return {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [] }],
    };
  }
  if (
    docData.type === "doc" &&
    Array.isArray(docData.content) &&
    docData.content.length === 1 &&
    docData.content[0].type === "paragraph" &&
    (!docData.content[0].content || docData.content[0].content.length === 0)
  ) {
    return {
      ...docData,
      content: [{ type: "heading", attrs: { level: 1 }, content: [] }],
    };
  }
  return docData;
}

export function Editor({
  initialContent,
  content,
  noteId,
  noteTitle,
  onSetTitle,
  onReadOnlyNoteChange,
  onUpdate,
  onRecoverOrphan,
  onSwitchFailed,
  onSwitchConflict,
  discardedNoteId,
  zoomLevel,
  showBlockControls,
  isFullscreen = false,
  isFindOpen,
  onCloseFind,
  onEditorReady,
  onNavigateToNote,
}: EditorProps) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPendingChangeTimeRef = useRef<number | null>(null);
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const saveAgainRef = useRef(false);
  const consecutiveSaveFailuresRef = useRef<number>(0);
  const isHalfOpenAttemptRef = useRef<boolean>(false);
  const halfOpenRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSavePromiseRef = useRef<Promise<void> | null>(null);
  const lastSaveErrorRef = useRef<any>(null);
  const lastSavedDocRef = useRef<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onSetTitleRef = useRef(onSetTitle);
  onSetTitleRef.current = onSetTitle;
  const onSwitchFailedRef = useRef(onSwitchFailed);
  onSwitchFailedRef.current = onSwitchFailed;
  const onSwitchConflictRef = useRef(onSwitchConflict);
  onSwitchConflictRef.current = onSwitchConflict;
  const discardedNoteIdRef = useRef(discardedNoteId);
  discardedNoteIdRef.current = discardedNoteId;
  const onNavigateToNoteRef = useRef(onNavigateToNote);
  onNavigateToNoteRef.current = onNavigateToNote;

  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const [linkPopover, setLinkPopover] = useState<{
    isOpen: boolean;
    mode: "preview" | "edit";
    data: LinkPopoverData | null;
  }>({
    isOpen: false,
    mode: "preview",
    data: null,
  });
  const [readOnly, setReadOnly] = useState(false);
  const readOnlyRef = useRef(false);
  const applyingDocumentRef = useRef(false);
  const onReadOnlyNoteChangeRef = useRef(onReadOnlyNoteChange);
  onReadOnlyNoteChangeRef.current = onReadOnlyNoteChange;

  const loadReadOnly = useCallback((id: string) => {
    try {
      readOnlyRef.current = localStorage.getItem(`raynote:read-only:${id}`) === "true";
    } catch {
      readOnlyRef.current = false;
    }
    setReadOnly(readOnlyRef.current);
    onReadOnlyNoteChangeRef.current?.(readOnlyRef.current ? id : null);
  }, []);

  useEffect(() => {
    setContextMenuState(null);
    setLinkPopover({ isOpen: false, mode: "preview", data: null });
  }, [noteId]);

  const currentTitleRef = useRef<string>(noteTitle || "");
  useEffect(() => {
    currentTitleRef.current = noteTitle || "";
  }, [noteTitle]);

  const openLinkPopover = useCallback((mode: "preview" | "edit" = "edit") => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    if (readOnlyRef.current || !editor.isEditable) return;

    const { state } = editor;
    const { selection, doc } = state;
    const { from, to, empty } = selection;

    // Check if caret or selection is inside a link mark
    const $from = doc.resolve(from);
    const linkMark = $from.marks().find((m: any) => m.type.name === "link");

    if (linkMark) {
      let start = from;
      let end = to;
      $from.parent.forEach((child: any, offset: number) => {
        if (child.marks.some((m: any) => m.type.name === "link" && m.attrs.href === linkMark.attrs.href)) {
          const nodeStart = $from.start() + offset;
          const nodeEnd = nodeStart + child.nodeSize;
          if (nodeStart <= from && nodeEnd >= from) {
            start = nodeStart;
            end = nodeEnd;
          }
        }
      });

      const linkText = doc.textBetween(start, end, " ");
      setLinkPopover({
        isOpen: true,
        mode,
        data: {
          text: linkText,
          href: (linkMark.attrs.href as string) || "",
          from: start,
          to: end,
          isNew: false,
        },
      });
      return;
    }

    if (!empty) {
      const selectedText = doc.textBetween(from, to, " ");
      setLinkPopover({
        isOpen: true,
        mode: "edit",
        data: {
          text: selectedText,
          href: "",
          from,
          to,
          isNew: false,
        },
      });
      return;
    }

    // No selection, no link: insert at caret
    setLinkPopover({
      isOpen: true,
      mode: "edit",
      data: {
        text: "",
        href: "",
        from,
        to,
        isNew: true,
      },
    });
  }, []);

  useEffect(() => {
    const handleOpenLinkPopoverEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: "preview" | "edit" }>).detail;
      const mode = detail?.mode || "edit";
      openLinkPopover(mode);
    };

    window.addEventListener("raynote:open-link-popover", handleOpenLinkPopoverEvent);
    return () => {
      window.removeEventListener("raynote:open-link-popover", handleOpenLinkPopoverEvent);
    };
  }, [openLinkPopover]);

  // Track the active note ID internally to identify transitions (starts null so initial note mounts cleanly)
  const currentNoteIdRef = useRef<string | null>(null);
  const noteSwitchGenerationRef = useRef(0);

  /**
   * Synchronously flushes any uncommitted editor changes to the memory cache, parent state, & SQLite.
   * If a save is already in-flight, queues a follow-up (`saveAgainRef`) and awaits the complete chain.
   * Updates `lastSavedDocRef` only after the DB write resolves successfully, and marks `isDirtyRef`
   * based on whether subsequent edits occurred during flight.
   */
  const saveNow = useCallback((): Promise<void> => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    firstPendingChangeTimeRef.current = null;

    if (currentNoteIdRef.current && discardedNoteIdRef.current === currentNoteIdRef.current) {
      isDirtyRef.current = false;
      return Promise.resolve();
    }

    if (isSavingRef.current) {
      saveAgainRef.current = true;
      return activeSavePromiseRef.current ?? Promise.resolve();
    }

    if (!isDirtyRef.current || !editorRef.current) {
      return Promise.resolve();
    }

    const currentEditor = editorRef.current;
    const currentId = currentNoteIdRef.current;
    if (!currentId) {
      return Promise.resolve();
    }

    const currentDoc = currentEditor.state?.doc;
    if (currentDoc && lastSavedDocRef.current && (lastSavedDocRef.current === currentDoc || lastSavedDocRef.current.eq(currentDoc))) {
      isDirtyRef.current = false;
      return Promise.resolve();
    }

    // Circuit breaker: cap consecutive save failures to prevent infinite retry loops
    if (consecutiveSaveFailuresRef.current >= 5) {
      if (!isHalfOpenAttemptRef.current) {
        console.warn(`[save] Consecutive save failures reached ${consecutiveSaveFailuresRef.current}. Pausing autosave loop.`);
        saveStatusStore.setBlocked(true, currentId, "Autosave paused after 5 consecutive failures");
        return Promise.resolve();
      }
      // Half-open retry attempt granted: consume the single allowed attempt and proceed
      isHalfOpenAttemptRef.current = false;
    }

    isSavingRef.current = true;
    saveStatusStore.setSaving(true);
    saveAgainRef.current = false;
    const docToSave = currentDoc;

    let strContent: string;
    let title: string;
    let extractedTitle: string | undefined;
    try {
      const json = currentEditor.getJSON();
      extractedTitle = extractTitle(json);
      title = (extractedTitle !== undefined && extractedTitle.length > 0)
        ? extractedTitle
        : (currentTitleRef.current || "Untitled");
      currentTitleRef.current = title;
      titleStore.setTitle(title);
      strContent = JSON.stringify(json);
    } catch (err) {
      console.error("Failed to serialize editor content:", err);
      isSavingRef.current = false;
      saveStatusStore.setSaving(false);
      return Promise.resolve();
    }

    // Update in-memory LRU cache immediately
    noteCache.updateContent(currentId, strContent, title);
    noteCache.persistActiveToLocalStorage(currentId, strContent, noteCache.peek(currentId)?.baseUpdatedAt, true);

    const runCycle = async (): Promise<void> => {
      try {
        const saveRes = await onUpdateRef.current(currentId, strContent, extractedTitle);
        consecutiveSaveFailuresRef.current = 0; // Reset counter on success
        isHalfOpenAttemptRef.current = false;
        if (halfOpenRetryTimerRef.current) {
          clearTimeout(halfOpenRetryTimerRef.current);
          halfOpenRetryTimerRef.current = null;
        }
        lastSaveErrorRef.current = null;
        saveStatusStore.setSaved();
        if (currentNoteIdRef.current === currentId) {
          lastSavedDocRef.current = docToSave;
          const currentDocNow = editorRef.current?.state?.doc;
          const isStillDirty = Boolean(currentDocNow && lastSavedDocRef.current && !currentDocNow.eq(lastSavedDocRef.current));
          isDirtyRef.current = isStillDirty;
          if (typeof saveRes === "string") {
            const recoveryContent = isStillDirty ? JSON.stringify(editorRef.current.getJSON()) : strContent;
            if (isStillDirty) {
              noteCache.updateContent(currentId, recoveryContent, currentTitleRef.current);
            }
            noteCache.setBaseUpdatedAt(currentId, saveRes, isStillDirty);
            noteCache.persistActiveToLocalStorage(currentId, recoveryContent, saveRes, isStillDirty);
          }
        }
      } catch (err) {
        saveStatusStore.setSaving(false);
        consecutiveSaveFailuresRef.current += 1;
        lastSaveErrorRef.current = err;
        console.error("Failed to save editor content to DB:", err);
        if (consecutiveSaveFailuresRef.current >= 5) {
          saveStatusStore.setBlocked(true, currentId, String((err as any)?.message || err || "Save failed"));

          // Half-open retry schedule: 1 attempt after backoff (start 10s, double each failure, cap 60s)
          if (halfOpenRetryTimerRef.current) {
            clearTimeout(halfOpenRetryTimerRef.current);
          }
          const exponent = Math.max(0, consecutiveSaveFailuresRef.current - 5);
          const backoffDelay = Math.min(60000, 10000 * Math.pow(2, exponent));
          halfOpenRetryTimerRef.current = setTimeout(() => {
            halfOpenRetryTimerRef.current = null;
            if (consecutiveSaveFailuresRef.current >= 5 && currentNoteIdRef.current === currentId) {
              isHalfOpenAttemptRef.current = true;
              saveNow();
            }
          }, backoffDelay);
        }
        if (currentNoteIdRef.current === currentId) {
          isDirtyRef.current = true;
        }
      } finally {
        isSavingRef.current = false;
        if (currentNoteIdRef.current === currentId && editorRef.current) {
          const docNow = editorRef.current.state?.doc;
          const hasNewEdits = Boolean(docNow && docToSave && !docNow.eq(docToSave));
          if ((saveAgainRef.current || hasNewEdits) && consecutiveSaveFailuresRef.current < 5) {
            saveAgainRef.current = false;
            try {
              await saveNow();
            } catch (err) {
              console.error("Failed follow-up saveNow:", err);
            }
          }
        } else if (currentNoteIdRef.current && isDirtyRef.current && consecutiveSaveFailuresRef.current < 5) {
          saveAgainRef.current = false;
          await saveNow();
        }
      }
    };

    const cyclePromise = runCycle();
    cyclePromise.catch(() => { });
    activeSavePromiseRef.current = cyclePromise;
    cyclePromise.finally(() => {
      if (activeSavePromiseRef.current === cyclePromise) {
        activeSavePromiseRef.current = null;
      }
    });

    return cyclePromise;
  }, []);

  /**
   * Handles document change events:
   * 1. Sets dirty flag so exit/switch handlers know changes exist.
   * 2. Extracts title from the first document line instantly so titleStore updates with 0ms delay (0 React renders of App/Editor).
   * 3. Adaptive debounce: 300ms (<20k), 800ms (<100k), 1500ms otherwise, with a 5000ms max-wait.
   */
  const handleEditorUpdate = useCallback(
    (editorInstance: any) => {
      const currentDoc = editorInstance?.state?.doc;
      if (currentDoc && lastSavedDocRef.current && lastSavedDocRef.current.eq(currentDoc)) {
        // Structural comparison: transaction did not alter document content (e.g. table normalization, trailing node, selection change)
        isDirtyRef.current = false;
        return;
      }

      isDirtyRef.current = true;

      if (consecutiveSaveFailuresRef.current >= 5) {
        // Fresh edits trigger 1 half-open save attempt
        isHalfOpenAttemptRef.current = true;
      }

      // Instant synchronization of the title store with the first line H1 ONLY
      const docTitle = extractTitleFromDoc(currentDoc);
      if (docTitle !== undefined && docTitle !== currentTitleRef.current) {
        currentTitleRef.current = docTitle;
        titleStore.setTitle(docTitle);
        onSetTitleRef.current?.(docTitle);
      }

      // Pre-fetch any newly typed code block grammar in the background so it highlights on the next keystroke
      const langs = scanCodeBlockLanguages(editorInstance?.state?.doc);
      for (const l of langs) {
        ensureLanguageLoaded(l);
      }

      const now = Date.now();
      if (firstPendingChangeTimeRef.current === null) {
        firstPendingChangeTimeRef.current = now;
      }

      // O(1) document size proxy via ProseMirror content.size and centralized thresholds
      const docSize = editorInstance?.state?.doc?.content?.size ?? 0;
      const delay = getAdaptiveDebounceDelay(docSize);

      // Max-wait bound
      const elapsed = now - firstPendingChangeTimeRef.current;
      const remainingMaxWait = Math.max(0, DEBOUNCE_THRESHOLDS.MAX_WAIT_MS - elapsed);
      const effectiveDelay = Math.min(delay, remainingMaxWait);

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      if (effectiveDelay <= 0) {
        saveNow();
      } else {
        debounceTimer.current = setTimeout(() => {
          saveNow();
        }, effectiveDelay);
      }
    },
    [saveNow]
  );

  const extensions = useMemo(
    () =>
      [...getExtensions(SlashCommand, {
        getCurrentTitle: () => currentTitleRef.current,
        onSetTitle: (newTitle: string) => {
          if (readOnlyRef.current) return;
          currentTitleRef.current = newTitle;
          onSetTitleRef.current?.(newTitle);
        },
      }), Extension.create({
        name: "documentReadOnly",
        addProseMirrorPlugins() {
          return [new Plugin({
            filterTransaction(transaction) {
              return !transaction.docChanged || !readOnlyRef.current || applyingDocumentRef.current;
            },
          })];
        },
      })],
    []
  );

  /**
   * Single Persistent TipTap Editor Instance:
   * Notice: Dependency array is empty `[]`! The editor is created ONCE and stays mounted.
   * Switching notes happens in place via `editor.commands.setContent()`, eliminating remount flicker.
   */
  const editor = useEditor(
    {
      shouldRerenderOnTransaction: false,
      extensions,
      // The note loader validates and installs the initial document as well as later switches.
      editable: false,
      content: ensureHeadingOneForDoc(null),
      onUpdate: ({ editor }) => {
        handleEditorUpdate(editor);
      },
      editorProps: {
        attributes: {
          class: "tiptap",
          spellcheck: "false",
        },
        scrollMargin: {
          top: 66,
          bottom: 96,
          left: 0,
          right: 0,
        },
        scrollThreshold: {
          top: 66,
          bottom: 96,
          left: 0,
          right: 0,
        },
        handleDOMEvents: {
          blur: () => {
            saveNow();
            return false;
          },
          contextmenu: (_view, event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!editorRef.current || editorRef.current.isDestroyed) return true;
            const resolved = resolveContextMenuState(editorRef.current, {
              x: event.clientX,
              y: event.clientY,
            });
            if (resolved) {
              setContextMenuState(resolved);
            }
            return true;
          },
        },
        clipboardTextSerializer: (slice) => {
          return sliceToMarkdown(slice, editorRef.current);
        },
        handlePaste: (_view, event) => {
          const clipboardData = event.clipboardData;
          if (!clipboardData) return false;

          // 1. Check if an image or screenshot was pasted directly
          let imageFile: File | Blob | null = null;
          if (clipboardData.files && clipboardData.files.length > 0) {
            for (let i = 0; i < clipboardData.files.length; i++) {
              const f = clipboardData.files[i];
              if (f.type.startsWith("image/")) {
                imageFile = f;
                break;
              }
            }
          }
          if (!imageFile && clipboardData.items && clipboardData.items.length > 0) {
            for (let i = 0; i < clipboardData.items.length; i++) {
              const item = clipboardData.items[i];
              if (item.type.startsWith("image/")) {
                const f = item.getAsFile();
                if (f) {
                  imageFile = f;
                  break;
                }
              }
            }
          }

          if (imageFile) {
            event.preventDefault();
            const pasteNoteId = currentNoteIdRef.current;
            const pasteGeneration = noteSwitchGenerationRef.current;
            const pasteEditor = editorRef.current;

            const reader = new FileReader();
            reader.onload = (e) => {
              const dataUrl = e.target?.result as string;
              if (!dataUrl) return;

              const img = new Image();
              img.onload = () => {
                if (
                  pasteEditor &&
                  !pasteEditor.isDestroyed &&
                  editorRef.current === pasteEditor &&
                  currentNoteIdRef.current === pasteNoteId &&
                  noteSwitchGenerationRef.current === pasteGeneration
                ) {
                  const editorWidth = pasteEditor.view.dom.clientWidth || 600;
                  const initialWidth = Math.round(
                    Math.min(img.naturalWidth || 500, Math.max(300, editorWidth - 32))
                  );

                  pasteEditor.chain().focus().setImage({
                    src: dataUrl,
                    alt: (imageFile as File).name || "Pasted image",
                    width: `${initialWidth}px`,
                    alignment: "center",
                  }).run();
                }
              };
              img.src = dataUrl;
            };
            reader.readAsDataURL(imageFile);
            return true;
          }

          // 2. Check if a Markdown or text file was pasted directly
          const files = clipboardData.files;
          if (files && files.length > 0) {
            const file = files[0];
            const isMdFile =
              file.name.endsWith(".md") ||
              file.name.endsWith(".markdown") ||
              file.name.endsWith(".txt") ||
              file.type.includes("markdown");

            if (isMdFile) {
              event.preventDefault();
              const pasteNoteId = currentNoteIdRef.current;
              const pasteGeneration = noteSwitchGenerationRef.current;
              const pasteEditor = editorRef.current;
              file.text().then((mdText) => {
                if (pasteEditor && !pasteEditor.isDestroyed && editorRef.current === pasteEditor &&
                    currentNoteIdRef.current === pasteNoteId && noteSwitchGenerationRef.current === pasteGeneration) {
                  const fallbackTitle = file.name.replace(/\.[^/.]+$/, "");
                  const html = markdownToTipTapHtml(mdText, {
                    ensureFirstLineH1: true,
                    fallbackTitle,
                  });

                  const isBlankNote =
                    editorRef.current.state.doc.textContent.trim().length === 0;
                  const isAtStart =
                    (editorRef.current.state.selection.from ?? 0) <= 2;

                  if (isBlankNote) {
                    editorRef.current.commands.setContent(html, { emitUpdate: true });
                  } else if (isAtStart) {
                    const firstNode = editorRef.current.state.doc.child(0);
                    if (firstNode.textContent.trim().length === 0) {
                      editorRef.current.chain()
                        .deleteRange({ from: 0, to: firstNode.nodeSize })
                        .insertContentAt(0, html)
                        .run();
                    } else {
                      editorRef.current.commands.insertContent(html);
                    }
                  } else {
                    editorRef.current.commands.insertContent(html);
                  }
                }
              }).catch((error) => {
                console.error("Failed to read pasted Markdown file:", error);
              });
              return true;
            }
          }

          return false;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;

          let imageFile: File | null = null;
          for (let i = 0; i < files.length; i++) {
            if (files[i].type.startsWith("image/")) {
              imageFile = files[i];
              break;
            }
          }

          if (!imageFile) return false;

          event.preventDefault();
          const pasteNoteId = currentNoteIdRef.current;
          const pasteGeneration = noteSwitchGenerationRef.current;
          const pasteEditor = editorRef.current;

          const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
          const dropPos = coordinates ? coordinates.pos : undefined;

          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (!dataUrl) return;

            const img = new Image();
            img.onload = () => {
              if (
                pasteEditor &&
                !pasteEditor.isDestroyed &&
                editorRef.current === pasteEditor &&
                currentNoteIdRef.current === pasteNoteId &&
                noteSwitchGenerationRef.current === pasteGeneration
              ) {
                const editorWidth = pasteEditor.view.dom.clientWidth || 600;
                const initialWidth = Math.round(
                  Math.min(img.naturalWidth || 500, Math.max(300, editorWidth - 32))
                );

                if (dropPos !== undefined) {
                  pasteEditor.chain().focus().insertContentAt(dropPos, {
                    type: "image",
                    attrs: {
                      src: dataUrl,
                      alt: imageFile.name || "Dropped image",
                      width: `${initialWidth}px`,
                      alignment: "center",
                    },
                  }).run();
                } else {
                  pasteEditor.chain().focus().setImage({
                    src: dataUrl,
                    alt: imageFile.name || "Dropped image",
                    width: `${initialWidth}px`,
                    alignment: "center",
                  }).run();
                }
              }
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(imageFile);
          return true;
        },
      },
    },
    [] // Permanent editor lifetime
  );

  editorRef.current = editor;
  if (typeof window !== "undefined") {
    (window as any).__RAYNOTE_EDITOR__ = editor;
  }

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  /**
   * Note Switching Transition Handler (Zero-Flicker in-place replacement):
   * Runs whenever `noteId` prop changes while maintaining the same mounted editor shell.
   * Invariant: Awaits the full saveNow() chain (including any in-flight save AND follow-up)
   * for the departing note BEFORE changing currentNoteIdRef or replacing the editor content.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const prevId = currentNoteIdRef.current;
    if (prevId === noteId) {
      loadReadOnly(noteId);
      editor.setEditable(!readOnlyRef.current, false);
      return;
    }
    noteSwitchGenerationRef.current += 1;
    editor.setEditable(false, false);

    let cancelled = false;

    const performSwitch = async () => {
      const switchStart = performance.now();
      try {
        // 1. If switching from an existing note, await full save & follow-up chain before switching ID or replacing doc
        // Make editor read-only during switch wait to prevent any edits from landing in limbo
        if (prevId && editor && !editor.isDestroyed) {
          if (discardedNoteIdRef.current === prevId) {
            isDirtyRef.current = false;
            consecutiveSaveFailuresRef.current = 0;
            isHalfOpenAttemptRef.current = false;
            if (halfOpenRetryTimerRef.current) {
              clearTimeout(halfOpenRetryTimerRef.current);
              halfOpenRetryTimerRef.current = null;
            }
            saveStatusStore.setBlocked(false);
            discardedNoteIdRef.current = null;
          } else {
            editor.setEditable(false, false);
            editor.commands.clearBlockSelection?.();
            if (scrollContainerRef.current) {
              noteCache.updateScrollTop(prevId, scrollContainerRef.current.scrollTop);
            }
            try {
              await saveNow();
            } catch (err: any) {
              console.error("Failed to flush edits before note switch:", err);
            }

            const saveErr = lastSaveErrorRef.current;
            const errMsg = String(saveErr?.message || saveErr || "");
            const isMissingRow =
              errMsg === "NOTE_NOT_FOUND" ||
              errMsg.includes("NOTE_NOT_FOUND") ||
              errMsg.includes("Query returned no rows") ||
              errMsg.includes("QueryReturnedNoRows");

            if (isMissingRow) {
              console.warn(`[switch] Note ${prevId} missing from SQLite during note switch. Routing to orphan recovery.`);
              const currentContent = JSON.stringify(editor.getJSON());
              let recoverySucceeded = false;
              if (onRecoverOrphan) {
                try {
                  await onRecoverOrphan(currentContent, prevId);
                  recoverySucceeded = true;
                } catch (recoveryErr) {
                  console.error("Orphan recovery failed during note switch:", recoveryErr);
                }
              }
              if (recoverySucceeded) {
                isDirtyRef.current = false;
                consecutiveSaveFailuresRef.current = 0;
                isHalfOpenAttemptRef.current = false;
                if (halfOpenRetryTimerRef.current) {
                  clearTimeout(halfOpenRetryTimerRef.current);
                  halfOpenRetryTimerRef.current = null;
                }
                saveStatusStore.setBlocked(false);
              } else {
                console.warn(`[switch] Orphan recovery failed for note ${prevId}. Keeping dirty state and opening conflict modal.`);
                // Keep isDirtyRef.current = true and keep localStorage snapshot intact
                onSwitchConflictRef.current?.({
                  failedNoteId: prevId,
                  targetNoteId: noteId,
                  content: currentContent,
                  text: editor.getText(),
                });
                return;
              }
            } else if (isDirtyRef.current || consecutiveSaveFailuresRef.current >= 5) {
              console.warn(`[switch] Note switch failed for note ${prevId}. Prompting user conflict options.`);
              onSwitchFailedRef.current?.(prevId, saveErr || new Error("Failed to save editor content before switch"));
              onSwitchConflictRef.current?.({
                failedNoteId: prevId,
                targetNoteId: noteId,
                content: JSON.stringify(editor.getJSON()),
                text: editor.getText(),
              });
              return;
            }
          }
        }

        if (cancelled || editor.isDestroyed) {
          return;
        }

        // 2. ONLY AFTER full flush chain resolves, update active note reference
        // Document identity is published only when its content is ready to apply.
        isDirtyRef.current = false;
        saveAgainRef.current = false;
        activeSavePromiseRef.current = null;

        // 3. High-performance document swap:
        // Clears prosemirror-history undo stack and detaches old document nodes,
        // preventing cross-note history accumulation while keeping the single editor mounted with 0ms flicker.
        const applyDocumentInPlace = (docData: any) => {
          clearFormatMemory(editor);
          applyingDocumentRef.current = true;
          try {
            const applied = editor.commands.setContent(ensureHeadingOneForDoc(docData), { emitUpdate: false, errorOnInvalidContent: true });
            if (!applied) throw new Error("Note content could not be applied");
          } finally {
            applyingDocumentRef.current = false;
          }
          currentNoteIdRef.current = noteId;
          loadReadOnly(noteId);
          lastSavedDocRef.current = editor.state.doc;
          isDirtyRef.current = false;
          // Reset ProseMirror undo/redo history stack cleanly without leaking document DOM nodes
          try {
            const histPlugin = editor.state.plugins.find((p: any) => p.key?.startsWith?.("history$"));
            if (histPlugin && (histPlugin as any).spec?.state?.init) {
              const emptyHistory = (histPlugin as any).spec.state.init();
              const tr = editor.state.tr.setMeta((histPlugin as any).key, { historyState: emptyHistory });
              editor.view.dispatch(tr);
            }
          } catch { }
        };

        const loadAndApplyDoc = async (rawContent: string, targetId: string, targetScroll: number | undefined, expectedDoc?: ProseMirrorNode) => {
          // Pre-scan and await all code block languages before setContent so lowlight decorates on first render
          await preloadLanguagesForContent(rawContent);
          if (cancelled || editor.isDestroyed ||
              (expectedDoc && editor.state.doc !== expectedDoc)) {
            return;
          }

          let docData: any;
          try {
            docData = JSON.parse(rawContent);
          } catch {
            docData = markdownToTipTapHtml(rawContent, { ensureFirstLineH1: true });
          }

          const container = scrollContainerRef.current;
          const scrollBeforeApply = container?.scrollTop ?? 0;
          applyDocumentInPlace(docData);

          // A background refresh keeps the live position. Initial restoration
          // only runs if the user hasn't scrolled while the note was loading.
          if (container && targetScroll === undefined) {
            container.scrollTop = scrollBeforeApply;
          } else if (container) {
            const scrollAfterApply = container.scrollTop;
            requestAnimationFrame(() => {
              if (!cancelled && currentNoteIdRef.current === targetId &&
                  scrollContainerRef.current === container && container.scrollTop === scrollAfterApply) {
                container.scrollTop = targetScroll ?? scrollBeforeApply;
                container.scrollLeft = 0;
              }
            });
          }
          return true;
        };

        // 4. Retrieve incoming note from in-memory LRU cache
        const cached = noteCache.get(noteId) ?? (!prevId && (initialContent || content) ? {
          content: initialContent || content || "", scrollTop: 0, baseUpdatedAt: "", unsaved: false,
        } : undefined);
        if (cached) {
          const applied = await loadAndApplyDoc(cached.content, noteId, cached.scrollTop);
          if (!applied) return;
          if (cached.unsaved) {
            lastSavedDocRef.current = null;
            isDirtyRef.current = true;
          }
          noteCache.persistActiveToLocalStorage(noteId, cached.content, cached.baseUpdatedAt, cached.unsaved);

          const revalidationDoc = editor.state.doc;
          // Background Stale-While-Revalidate: verify with SQLite without blocking UI
          getNote(noteId)
            .then(async (fullNote) => {
              if (currentNoteIdRef.current === noteId && !cancelled &&
                  !editor.isDestroyed && editor.state.doc === revalidationDoc) {
                const reconciliation = reconcileSnapshotWithDb(cached, fullNote);
                if (reconciliation.action === "recover_orphan_as_new") {
                  if (onRecoverOrphan) {
                    const recoveryDoc = editor.state.doc;
                    Promise.resolve(onRecoverOrphan(reconciliation.content, noteId))
                      .then(async (newNoteId) => {
                        if (currentNoteIdRef.current === noteId && !editor.isDestroyed) {
                          if (newNoteId && (!editor.state.doc.eq(recoveryDoc) || isDirtyRef.current)) {
                            // User typed edits while recovery was in flight!
                            // Transfer ownership to newNoteId so edits persist to the replacement row
                            currentNoteIdRef.current = newNoteId;
                            noteCache.delete(noteId);
                            clearActiveNoteSnapshot(noteId);
                            isDirtyRef.current = true;
                            await saveNow();
                            return;
                          }
                        }
                        noteCache.delete(noteId);
                        clearActiveNoteSnapshot(noteId);
                      })
                      .catch((err) => {
                        console.error("Orphan recovery failed:", err);
                      });
                  }
                } else if (reconciliation.action === "keep_snapshot_and_mark_dirty") {
                  // User had unsaved edits based on this DB row; re-apply snapshot and mark editor dirty
                  isDirtyRef.current = true;
                  saveNow();
                } else if (reconciliation.action === "apply_db" && fullNote) {
                  const applied = fullNote.content === cached.content ||
                    await loadAndApplyDoc(fullNote.content, noteId, undefined, revalidationDoc);
                  if (applied) {
                    const scroll = scrollContainerRef.current?.scrollTop ?? cached.scrollTop;
                    noteCache.set(noteId, fullNote.content, fullNote.updated_at, fullNote.title, scroll, false);
                    noteCache.persistActiveToLocalStorage(noteId, fullNote.content, fullNote.updated_at, false);
                  }
                } else if (reconciliation.action === "evict_orphan") {
                  noteCache.delete(noteId);
                  clearActiveNoteSnapshot(noteId);
                }
              }
            })
            .catch(() => { });
        } else {
          // CACHE MISS: fetch from SQLite asynchronously
          try {
            const fullNote = await getNote(noteId);
            if (!fullNote) {
              const error = new Error("Note could not be loaded");
              error.name = "NoteUnavailableError";
              throw error;
            }
            if (!cancelled && !editor.isDestroyed) {
              noteCache.set(noteId, fullNote.content, fullNote.updated_at, fullNote.title, 0, false);
              const applied = await loadAndApplyDoc(fullNote.content, noteId, 0);
              if (applied) {
                noteCache.persistActiveToLocalStorage(noteId, fullNote.content, fullNote.updated_at, false);
              }
            }
          } catch (err) {
            console.error("Failed to load note from SQLite:", err);
            if (!cancelled && prevId) onSwitchFailedRef.current?.(prevId, err);
          }
        }
      } catch (error) {
        console.error("Could not apply note document", error);
        if (!cancelled && prevId) onSwitchFailedRef.current?.(prevId, error);
      } finally {
        if (!cancelled && editor && !editor.isDestroyed) {
          editor.setEditable(Boolean(currentNoteIdRef.current) && !readOnlyRef.current, false);
          if (currentNoteIdRef.current === noteId && editor.isEditable) {
            const active = document.activeElement;
            if (!active || active === document.body || active === editor.view.dom) {
              editor.commands.focus("end", { scrollIntoView: false });
            }
          }
        }
        if ((import.meta as any).env?.DEV) {
          const switchDuration = performance.now() - switchStart;
          console.debug(
            `[performSwitch lock duration] ${switchDuration.toFixed(3)} ms (prevId=${prevId}, nextId=${noteId})`
          );
        }
      }
    };

    performSwitch();

    return () => {
      cancelled = true;
      if (halfOpenRetryTimerRef.current) {
        clearTimeout(halfOpenRetryTimerRef.current);
        halfOpenRetryTimerRef.current = null;
      }
      isHalfOpenAttemptRef.current = false;
    };
  }, [noteId, editor, saveNow, loadReadOnly]);

  // Passive, lightweight scroll position tracking (0ms, no React state re-renders)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !editor) return;

    const atEdge = () => container.scrollTop <= 0 ||
      container.scrollTop + container.clientHeight >= container.scrollHeight - 1;

    // Cancel outward trackpad gestures before WebKit starts elastic scrolling.
    // Keep the interior of the note on the asynchronous scrolling path.
    const guardEdge = (event: WheelEvent) => {
      if (!event.cancelable || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const outward = event.deltaY < 0 ? container.scrollTop <= 0 :
        event.deltaY > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      if (!outward) return;
      for (let el = event.target instanceof Element ? event.target : null;
        el && el !== container; el = el.parentElement) {
        if (el.scrollHeight <= el.clientHeight || !/^(auto|scroll)$/.test(getComputedStyle(el).overflowY)) continue;
        if (event.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return;
      }
      event.preventDefault();
    };
    const syncGuard = () => {
      if (atEdge()) container.addEventListener("wheel", guardEdge, { passive: false });
      else container.removeEventListener("wheel", guardEdge);
    };
    const handleScroll = () => {
      syncGuard();
      if (currentNoteIdRef.current) {
        noteCache.updateScrollTop(currentNoteIdRef.current, container.scrollTop);
      }
    };
    const resize = new ResizeObserver(syncGuard);
    resize.observe(container);
    resize.observe(editor.view.dom);
    syncGuard();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      resize.disconnect();
      container.removeEventListener("wheel", guardEdge);
      container.removeEventListener("scroll", handleScroll);
    };
  }, [editor]);


  // Register lightweight zero-overhead diagnostic metrics for memory profiling
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__RAYNOTE_DIAGNOSTICS__ = {
        getCachedNotesCount: () => noteCache.size,
        getCachedBytes: () => noteCache.totalBytes,
        getEditorInstanceCount: () => (editorRef.current && !editorRef.current.isDestroyed ? 1 : 0),
        getMountedEditorDomCount: () => document.querySelectorAll(".tiptap").length,
        getMountedEditorChildrenCount: () => document.querySelector(".tiptap")?.childElementCount || 0,
        getMountedCodeBlocksCount: () => document.querySelectorAll(".code-block-wrapper").length,
      };
    }
    return () => {
      delete (window as any).__RAYNOTE_EDITOR__;
      delete (window as any).__RAYNOTE_DIAGNOSTICS__;
    };
  }, []);

  const selectionBoxRef = useRef<HTMLDivElement>(null);

  // Notion-style Block Drag & Auto-Scroll
  useBlockDrag({ editor, scrollContainerRef, rubberBandRef: selectionBoxRef });

  // Refocus on window activation without replacing the caret or selection.
  useEffect(() => {
    if (!editor) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refocus = () => {
      if (editor.isDestroyed || !editor.isEditable || editor.isFocused) return;
      const active = document.activeElement;
      if (!active || active === document.body || active === editor.view.dom) {
        editor.commands.focus(undefined, { scrollIntoView: false });
      }
    };

    window.addEventListener("focus", refocus);
    getCurrentWindow().listen("app-focused", refocus).then(stop => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", refocus);
    };
  }, [editor]);

  /**
   * Keystroke auto-focus restoration
   */
  useEffect(() => {
    if (!editor) return;
    let armedUntil = 0;
    const arm = () => {
      armedUntil = Date.now() + 1500;
    };

    window.addEventListener("focus", arm);
    let isCleanedUp = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .listen("app-focused", arm)
      .then((fn) => {
        if (isCleanedUp) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => { });

    const onKeyDown = (e: KeyboardEvent) => {
      if (Date.now() > armedUntil) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const a = document.activeElement;
      if (a && a !== document.body) return;
      if (!editor.isDestroyed && editor.isEditable && !editor.isFocused) {
        editor.view.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      isCleanedUp = true;
      window.removeEventListener("focus", arm);
      window.removeEventListener("keydown", onKeyDown, true);
      unlisten?.();
    };
  }, [editor]);

  /**
   * External Link click interceptor
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleLinkClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href || href === "#") return;

      e.preventDefault();
      e.stopPropagation();

      const isMetaOrCtrl = e.metaKey || e.ctrlKey;
      const isReadOnly = readOnlyRef.current || !editorRef.current?.isEditable;

      // In read-only mode OR on Cmd/Ctrl+Click in edit mode: open destination directly
      if (isReadOnly || isMetaOrCtrl) {
        safeOpenUrl(href, { onNavigateNote: onNavigateToNoteRef.current });
        return;
      }

      // In edit mode without Cmd key: preview the link in the popover
      if (editorRef.current && !editorRef.current.isDestroyed) {
        const view = editorRef.current.view;
        let linkFrom = 0;
        let linkTo = 0;
        try {
          const pos = view.posAtDOM(link, 0);
          const $pos = view.state.doc.resolve(pos);
          let start = pos;
          let end = pos;
          $pos.parent.forEach((child: any, offset: number) => {
            if (child.marks.some((m: any) => m.type.name === "link" && m.attrs.href === href)) {
              const nodeStart = $pos.start() + offset;
              const nodeEnd = nodeStart + child.nodeSize;
              if (nodeStart <= pos && nodeEnd >= pos) {
                start = nodeStart;
                end = nodeEnd;
              }
            }
          });
          linkFrom = start;
          linkTo = end;
        } catch {
          linkFrom = view.state.selection.from;
          linkTo = view.state.selection.to;
        }

        setLinkPopover({
          isOpen: true,
          mode: "preview",
          data: {
            text: link.textContent || "",
            href,
            from: linkFrom,
            to: linkTo,
            anchorEl: link,
            isNew: false,
          },
        });
      }
    };

    container.addEventListener("click", handleLinkClick);
    return () => {
      container.removeEventListener("click", handleLinkClick);
    };
  }, []);

  /**
   * Flush uncommitted edits on component unmount to prevent data loss.
   */
  useEffect(() => {
    return () => {
      saveNow();
      if (scrollContainerRef.current && currentNoteIdRef.current) {
        noteCache.updateScrollTop(currentNoteIdRef.current, scrollContainerRef.current.scrollTop);
      }
    };
  }, []);

  // Register editor flush handler so exit and blur handlers can synchronously commit dirty state
  useEffect(() => {
    registerEditorFlush(async () => {
      await saveNow();
      if (isDirtyRef.current && discardedNoteIdRef.current !== currentNoteIdRef.current) {
        throw lastSaveErrorRef.current || new Error("Unsaved changes could not be persisted");
      }
    });
    registerEditorRecovery({
      getNoteId: () => currentNoteIdRef.current,
      read: id => currentNoteIdRef.current === id && editorRef.current && !editorRef.current.isDestroyed
        ? { content: JSON.stringify(editorRef.current.getJSON()) } : null,
      handoff: (sourceId, targetId, content, title) => {
        const live = editorRef.current;
        if (currentNoteIdRef.current !== sourceId || !live || live.isDestroyed) return true;
        if (JSON.stringify(live.getJSON()) !== content) return false;
        currentNoteIdRef.current = targetId;
        noteSwitchGenerationRef.current += 1;
        currentTitleRef.current = title;
        titleStore.setTitle(title);
        lastSavedDocRef.current = live.state.doc;
        isDirtyRef.current = false;
        discardedNoteIdRef.current = null;
        saveAgainRef.current = false;
        lastSaveErrorRef.current = null;
        consecutiveSaveFailuresRef.current = 0;
        isHalfOpenAttemptRef.current = false;
        if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
        if (halfOpenRetryTimerRef.current) { clearTimeout(halfOpenRetryTimerRef.current); halfOpenRetryTimerRef.current = null; }
        saveStatusStore.setSaved();
        return true;
      },
    });
    registerEditorDiscard((id) => {
      if (currentNoteIdRef.current !== id) return;
      discardedNoteIdRef.current = id;
      isDirtyRef.current = false;
      saveAgainRef.current = false;
      lastSaveErrorRef.current = null;
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      if (halfOpenRetryTimerRef.current) {
        clearTimeout(halfOpenRetryTimerRef.current);
        halfOpenRetryTimerRef.current = null;
      }
    });
    return () => {
      registerEditorFlush(null);
      registerEditorDiscard(null);
      registerEditorRecovery(null);
    };
  }, [saveNow]);

  // Flush pending update on window blur / defocus
  useEffect(() => {
    const handleBlur = () => {
      if (isDirtyRef.current) {
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
        }
        saveNow();
      }
    };
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
    };
  }, [saveNow]);

  const handleWrapperClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      // React portal events bubble through EditorContent even when the popup is in document.body.
      if (!target || !e.currentTarget.contains(target)) return;

      // Clicks inside .tiptap or its child elements are handled natively by ProseMirror
      if (target.closest(".tiptap")) return;
      if (target.closest(".floating-code-block-toolbar")) return;
      if (target.closest(".document-tick-slider")) return;

      // If a drag just concluded, ignore
      if (Date.now() - getLastDragEndTime() < 300) return;

      if (!editor || editor.isDestroyed) return;

      // Clear any active block selection
      editor.commands.clearBlockSelection?.();

      const tiptapDom = editor.view.dom as HTMLElement | null;
      const editorRect = tiptapDom?.getBoundingClientRect();

      if (editorRect) {
        // Clicks in top padding or above editor text -> focus at start
        if (e.clientY < editorRect.top + 60) {
          editor.chain().focus("start").run();
          return;
        }

        // Clicks strictly below editor content -> focus at end
        if (e.clientY > editorRect.bottom) {
          editor.chain().focus("end").run();
          return;
        }

        // Clicks in side margins -> place caret at corresponding line
        const clampedX = Math.max(
          editorRect.left + 10,
          Math.min(editorRect.right - 10, e.clientX)
        );
        const pos = editor.view.posAtCoords({ left: clampedX, top: e.clientY });
        if (pos) {
          editor.chain().focus().setTextSelection(pos.pos).run();
          return;
        }
      }

      editor.chain().focus("end").run();
    },
    [editor]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (!editor || editor.isDestroyed) return;

      const target = e.target as HTMLElement | null;
      if (target?.closest(".find-bar") || target?.closest(".document-tick-slider")) {
        return;
      }

      const resolved = resolveContextMenuState(editor, { x: e.clientX, y: e.clientY });
      if (resolved) {
        setContextMenuState(resolved);
      }
    },
    [editor]
  );

  const toggleReadOnly = () => {
    if (!editor || editor.isDestroyed || currentNoteIdRef.current !== noteId ||
        (!editor.isEditable && !readOnlyRef.current)) return;
    const locked = !readOnlyRef.current;
    readOnlyRef.current = locked;
    setReadOnly(locked);
    onReadOnlyNoteChangeRef.current?.(locked ? noteId : null);
    editor.setEditable(!locked, false);
    try {
      const key = `raynote:read-only:${noteId}`;
      if (locked) localStorage.setItem(key, "true");
      else localStorage.removeItem(key);
    } catch (error) {
      console.error("Could not save the note's read-only setting", error);
    }
  };

  if (!editor) return null;

  return (
    <div className="editor-wrapper relative h-full flex flex-col min-h-0">
      <FindBar
        isOpen={Boolean(isFindOpen)}
        onClose={() => onCloseFind?.()}
        editor={editor}
        readOnly={readOnly}
      />
      <div
        ref={scrollContainerRef}
        data-scroll-container
        onClick={handleWrapperClick}
        onContextMenu={handleContextMenu}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative"
      >
        <div
          style={zoomLevel && zoomLevel !== 1 ? ({ zoom: zoomLevel } as React.CSSProperties) : undefined}
          className="editor-content-frame relative"
        >
          <SmoothCaret
            editor={editor}
            zoomLevel={zoomLevel}
            isFindOpen={Boolean(isFindOpen)}
          />
          <ImageFullscreenContext.Provider value={isFullscreen}>
            <EditorContent editor={editor} />
          </ImageFullscreenContext.Provider>
          {!readOnly && <FloatingCodeBlockToolbar
            editor={editor}
            scrollContainerRef={scrollContainerRef}
            zoomLevel={zoomLevel}
          />}
        </div>
        {showBlockControls && !readOnly && !contextMenuState && (
          <FullscreenBlockControls key={noteId} editor={editor} zoomLevel={zoomLevel} scrollContainerRef={scrollContainerRef}
            onMenu={(point) => setContextMenuState(resolveContextMenuState(editor, point))} />
        )}
        {/* Notion-style Rubber-band Selection Box */}
        <div
          ref={selectionBoxRef}
          style={{
            position: "absolute",
            display: "none",
            backgroundColor: "var(--color-accent-subtle)",
            border: "1px solid var(--color-accent-border)",
            borderRadius: "8px",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      </div>
      <DocumentTickSlider scrollContainerRef={scrollContainerRef} />
      <div className="editor-status-footer">
        <EditorCharCount editor={editor} noteId={noteId} />
        <ResourceUsageFooter />
      </div>
      {/* Bottom frosted glass blend scrim for scrolling text */}
      <div className="app-bottom-blend" aria-hidden="true" />
      {!readOnly && <BottomToolbar editor={editor} />}
      <EditorContextMenu
        editor={editor}
        menuState={contextMenuState}
        readOnly={readOnly}
        onToggleReadOnly={toggleReadOnly}
        onClose={() => setContextMenuState(null)}
      />
      <LinkPopover
        editor={editor}
        isOpen={linkPopover.isOpen}
        mode={linkPopover.mode}
        linkData={linkPopover.data}
        onClose={() => setLinkPopover((prev) => ({ ...prev, isOpen: false }))}
        onNavigateNote={onNavigateToNoteRef.current}
        onSwitchToEdit={() => setLinkPopover((prev) => ({ ...prev, mode: "edit" }))}
      />
    </div>
  );
}
