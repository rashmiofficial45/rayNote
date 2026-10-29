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

import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useRef, useCallback, useState, useMemo, memo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getExtensions } from "./extensions";
import { SlashCommand } from "./SlashCommand";
import { BottomToolbar } from "../components/BottomToolbar";
import { FindBar } from "../components/FindBar";
import { SmoothCaret } from "../components/SmoothCaret";
import { FloatingCodeBlockToolbar } from "./FloatingCodeBlockToolbar";
import { DocumentTickSlider } from "../components/DocumentTickSlider";
import { useBlockDrag } from "../extensions/useBlockDrag";
import { getLastDragEndTime } from "../extensions/BlockSelection";
import {
  markdownToTipTapHtml,
  sliceToMarkdown,
} from "./markdownUtils";
import { noteCache, reconcileSnapshotWithDb } from "../lib/noteCache";
import { getNote, registerEditorFlush } from "../lib/db";
import { titleStore } from "../lib/titleStore";
import { saveStatusStore } from "../lib/saveStatusStore";
import { SwitchConflictInfo } from "../components/SwitchConflictModal";
import { safeLocalStorageRemoveItem } from "../lib/storage";
import { preloadLanguagesForContent, scanCodeBlockLanguages, ensureLanguageLoaded } from "./extensions";

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

  const [count, setCount] = useState<number>(() => {
    const doc = editor?.state?.doc;
    return getDocCharCount(doc);
  });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editor) return;

    const computeCount = () => {
      const doc = editor.state?.doc;
      const c = getDocCharCount(doc);
      setCount((prev: number) => (prev === c ? prev : c));
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
      {count.toLocaleString()} {count === 1 ? "character" : "characters"}
    </div>
  );
});

interface EditorProps {
  initialContent?: string;
  content?: string;
  noteId: string;
  noteTitle?: string;
  onSetTitle?: (title: string) => void;
  onUpdate: (id: string, content: string, titleHint?: string) => Promise<string | void> | string | void;
  onRecoverOrphan?: (content: string, sourceId?: string) => void | Promise<void> | any;
  onSwitchFailed?: (failedId: string, error: unknown) => void;
  onSwitchConflict?: (info: SwitchConflictInfo) => void;
  discardedNoteId?: string | null;
  zoomLevel?: number;
  isFindOpen?: boolean;
  onCloseFind?: () => void;
  onEditorReady?: (editor: any) => void;
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
  onUpdate,
  onRecoverOrphan,
  onSwitchFailed,
  onSwitchConflict,
  discardedNoteId,
  zoomLevel,
  isFindOpen,
  onCloseFind,
  onEditorReady,
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

  const currentTitleRef = useRef<string>(noteTitle || "");
  useEffect(() => {
    currentTitleRef.current = noteTitle || "";
  }, [noteTitle]);

  // Track the active note ID internally to identify transitions (starts null so initial note mounts cleanly)
  const currentNoteIdRef = useRef<string | null>(null);

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
            noteCache.setBaseUpdatedAt(currentId, saveRes, isStillDirty);
            noteCache.persistActiveToLocalStorage(currentId, strContent, saveRes, isStillDirty);
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
      getExtensions(SlashCommand, {
        getCurrentTitle: () => currentTitleRef.current,
        onSetTitle: (newTitle: string) => {
          currentTitleRef.current = newTitle;
          onSetTitleRef.current?.(newTitle);
        },
      }),
    []
  );

  /**
   * Hydrates initial document payload on mount from LRU cache or initialContent.
   */
  const seedContent = useMemo(() => {
    const cached = noteCache.get(noteId);
    const raw = cached?.content ?? (initialContent || content || "");
    if (!raw) return ensureHeadingOneForDoc(null);
    try {
      return ensureHeadingOneForDoc(JSON.parse(raw));
    } catch {
      return ensureHeadingOneForDoc(markdownToTipTapHtml(raw, { ensureFirstLineH1: true }));
    }
  }, []); // Only runs once on mount

  /**
   * Single Persistent TipTap Editor Instance:
   * Notice: Dependency array is empty `[]`! The editor is created ONCE and stays mounted.
   * Switching notes happens in place via `editor.commands.setContent()`, eliminating remount flicker.
   */
  const editor = useEditor(
    {
      shouldRerenderOnTransaction: false,
      extensions,
      content: seedContent,
      onUpdate: ({ editor }) => {
        handleEditorUpdate(editor);
      },
      editorProps: {
        attributes: {
          class: "tiptap",
          spellcheck: "false",
        },
        handleDOMEvents: {
          blur: () => {
            saveNow();
            return false;
          },
        },
        clipboardTextSerializer: (slice) => {
          return sliceToMarkdown(slice, editorRef.current);
        },
        handlePaste: (_view, event) => {
          const clipboardData = event.clipboardData;
          if (!clipboardData) return false;

          // 1. Check if a Markdown or text file was pasted directly
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
              file.text().then((mdText) => {
                if (editorRef.current) {
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
              });
              return true;
            }
          }

          return false;
        },
      },
      autofocus: "end",
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
    if (prevId === noteId) return; // Same note, no-op

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
        currentNoteIdRef.current = noteId;
        lastSavedDocRef.current = editor.state.doc;
        isDirtyRef.current = false;
        saveAgainRef.current = false;
        activeSavePromiseRef.current = null;

        // 3. High-performance document swap:
        // Clears prosemirror-history undo stack and detaches old document nodes,
        // preventing cross-note history accumulation while keeping the single editor mounted with 0ms flicker.
        const applyDocumentInPlace = (docData: any) => {
          editor.commands.setContent(ensureHeadingOneForDoc(docData), { emitUpdate: false });
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

        const loadAndApplyDoc = async (rawContent: string, targetId: string, targetScroll: number) => {
          // Pre-scan and await all code block languages before setContent so lowlight decorates on first render
          await preloadLanguagesForContent(rawContent);
          if (cancelled || currentNoteIdRef.current !== targetId || editor.isDestroyed) {
            return;
          }

          let docData: any;
          try {
            docData = JSON.parse(rawContent);
          } catch {
            docData = markdownToTipTapHtml(rawContent, { ensureFirstLineH1: true });
          }

          applyDocumentInPlace(docData);

          requestAnimationFrame(() => {
            if (scrollContainerRef.current && currentNoteIdRef.current === targetId) {
              scrollContainerRef.current.scrollTop = targetScroll;
            }
          });
        };

        // 4. Retrieve incoming note from in-memory LRU cache
        const cached = noteCache.get(noteId);
        if (cached) {
          await loadAndApplyDoc(cached.content, noteId, cached.scrollTop);

          // Background Stale-While-Revalidate: verify with SQLite without blocking UI
          getNote(noteId)
            .then((fullNote) => {
              if (currentNoteIdRef.current === noteId && !cancelled) {
                const reconciliation = reconcileSnapshotWithDb(cached, fullNote);
                if (reconciliation.action === "recover_orphan_as_new") {
                  noteCache.delete(noteId);
                  if (onRecoverOrphan) {
                    Promise.resolve(onRecoverOrphan(reconciliation.content))
                      .then(() => {
                        safeLocalStorageRemoveItem("notefast_active_note_content");
                        safeLocalStorageRemoveItem("notefast_active_note_id");
                        safeLocalStorageRemoveItem("notefast_active_note_base_updated_at");
                        safeLocalStorageRemoveItem("notefast_active_note_unsaved");
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
                  noteCache.set(noteId, fullNote.content, fullNote.updated_at, fullNote.title, cached.scrollTop, false);
                  loadAndApplyDoc(fullNote.content, noteId, cached.scrollTop);
                  isDirtyRef.current = false;
                } else if (reconciliation.action === "evict_orphan") {
                  noteCache.delete(noteId);
                  safeLocalStorageRemoveItem("notefast_active_note_content");
                  safeLocalStorageRemoveItem("notefast_active_note_id");
                  safeLocalStorageRemoveItem("notefast_active_note_base_updated_at");
                  safeLocalStorageRemoveItem("notefast_active_note_unsaved");
                }
              }
            })
            .catch(() => { });
        } else {
          // CACHE MISS: fetch from SQLite asynchronously
          try {
            const fullNote = await getNote(noteId);
            if (fullNote && currentNoteIdRef.current === noteId && !cancelled) {
              noteCache.set(noteId, fullNote.content, fullNote.updated_at, fullNote.title, 0, false);
              await loadAndApplyDoc(fullNote.content, noteId, 0);
            }
          } catch (err) {
            console.error("Failed to load note from SQLite:", err);
          }
        }
      } finally {
        if (editor && !editor.isDestroyed) {
          editor.setEditable(true, false);
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
  }, [noteId, editor, saveNow]);

  // Passive, lightweight scroll position tracking (0ms, no React state re-renders)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (currentNoteIdRef.current) {
        noteCache.updateScrollTop(currentNoteIdRef.current, container.scrollTop);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);


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
  }, []);

  const selectionBoxRef = useRef<HTMLDivElement>(null);

  // Notion-style Block Drag & Auto-Scroll
  useBlockDrag({ editor, scrollContainerRef, rubberBandRef: selectionBoxRef });

  /**
   * Focus restoration without resetting restored scroll position:
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const focusNote = () => {
      if (editor && !editor.isDestroyed && !editor.isFocused && currentNoteIdRef.current === noteId) {
        // focus with scrollIntoView: false prevents jumping away from restored scrollTop
        editor.commands.focus("end", { scrollIntoView: false });
      }
    };

    focusNote();
    const t1 = setTimeout(focusNote, 40);
    const t2 = setTimeout(focusNote, 150);

    const handleWindowFocus = () => {
      focusNote();
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [editor, noteId]);

  /**
   * Refocus editor on Tauri app-focused event
   */
  useEffect(() => {
    let isCleanedUp = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .listen("app-focused", () => {
        if (editorRef.current && !editorRef.current.isDestroyed) {
          editorRef.current.commands.focus("end", { scrollIntoView: false });
        }
      })
      .then((fn) => {
        if (isCleanedUp) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => { });

    return () => {
      isCleanedUp = true;
      unlisten?.();
    };
  }, []);

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
      if (!editor.isDestroyed && !editor.isFocused) {
        editor.commands.focus("end", { scrollIntoView: false });
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
      if (href && href !== "#") {
        e.preventDefault();
        e.stopPropagation();
        openUrl(href).catch((err) => {
          console.warn("Could not open URL via tauri opener, fallback to window.open", err);
          window.open(href, "_blank");
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
    registerEditorFlush(saveNow);
    return () => {
      registerEditorFlush(null);
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
      if (!target) return;

      // Clicks inside .tiptap or its child elements are handled natively by ProseMirror
      if (target.closest(".tiptap")) return;
      if (target.closest(".floating-code-block-toolbar")) return;
      if (target.closest(".document-tick-slider")) return;

      // If a drag just concluded, ignore
      if (Date.now() - getLastDragEndTime() < 300) return;

      if (editor && !editor.isDestroyed) {
        editor.chain().focus("end").run();
      }
    },
    [editor]
  );

  if (!editor) return null;

  return (
    <div className="editor-wrapper relative h-full flex flex-col min-h-0">
      <FindBar
        isOpen={Boolean(isFindOpen)}
        onClose={() => onCloseFind?.()}
        editor={editor}
      />
      <div
        ref={scrollContainerRef}
        data-scroll-container
        onClick={handleWrapperClick}
        className="flex-1 min-h-0 overflow-y-auto relative"
      >
        <div
          style={zoomLevel && zoomLevel !== 1 ? ({ zoom: zoomLevel } as React.CSSProperties) : undefined}
          className="relative"
        >
          <SmoothCaret
            editor={editor}
            zoomLevel={zoomLevel}
            scrollContainerRef={scrollContainerRef}
            isFindOpen={Boolean(isFindOpen)}
          />
          <EditorContent editor={editor} />
          <FloatingCodeBlockToolbar
            editor={editor}
            scrollContainerRef={scrollContainerRef}
            zoomLevel={zoomLevel}
          />
        </div>
        {/* Notion-style Rubber-band Selection Box */}
        <div
          ref={selectionBoxRef}
          style={{
            position: "absolute",
            display: "none",
            backgroundColor: "rgba(14, 165, 233, 0.08)",
            border: "1px solid rgba(14, 165, 233, 0.35)",
            borderRadius: "8px",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      </div>
      <DocumentTickSlider scrollContainerRef={scrollContainerRef} />
      <EditorCharCount editor={editor} noteId={noteId} />
      {/* Bottom frosted glass blend scrim for scrolling text */}
      <div className="app-bottom-blend" aria-hidden="true" />
      <BottomToolbar editor={editor} />
    </div>
  );
}
