/**
 * TipTap Note Editor Engine (Editor.tsx)
 *
 * Core architecture:
 * - Rich Text & ProseMirror Schema: Powered by TipTap core with GitHub Flavored Markdown (GFM)
 *   extensions, nested task lists, syntax-highlighted codeblocks (lowlight), smart horizontal rules,
 *   and responsive iframe video embeds.
 * - Bidirectional Markdown Interop: Seamlessly converts pasted Markdown files and clipboard
 *   syntax into TipTap DOM nodes, and serializes selected ProseMirror slices back into clean Markdown.
 * - Non-Blocking Debounced Persistence: Keeps typing latency at 0ms by separating fast O(1) UI
 *   updates (character count) from a 300ms debounced JSON serialization that flushes to SQLite.
 * - Zero Data-Loss Guarantees: Automatically flushes pending edits on window blur, note switching,
 *   or component unmount.
 * - Professional Caret Focus: Multi-stage focus recovery and native Cocoa activation listeners
 *   ensure the cursor is always positioned and ready to type.
 */

import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getExtensions } from "./extensions";
import { SlashCommand } from "./SlashCommand";
import { BottomToolbar } from "../components/BottomToolbar";
import { FindBar } from "../components/FindBar";
import { SmoothCaret } from "../components/SmoothCaret";
import { DocumentTickSlider } from "../components/DocumentTickSlider";
import {
  isMarkdownContent,
  markdownToTipTapHtml,
  sliceToMarkdown,
} from "./markdownUtils";

interface EditorProps {
  content: string;
  noteId: string;
  onUpdate: (content: string, titleHint?: string) => void;
  zoomLevel?: number;
  isFindOpen?: boolean;
  onCloseFind?: () => void;
}

/**
 * Extracts note title from the first document node (paragraph or heading)
 * to keep note drawer titles continuously up to date as the user types.
 */
const extractTitle = (json: any): string => {
  if (json && Array.isArray(json.content) && json.content.length > 0) {
    const firstNode = json.content[0];
    if (Array.isArray(firstNode.content)) {
      return firstNode.content.map((n: any) => n.text || "").join("");
    }
  }
  return "";
};

export function Editor({
  content,
  noteId,
  onUpdate,
  zoomLevel,
  isFindOpen,
  onCloseFind,
}: EditorProps) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const [charCount, setCharCount] = useState(0);

  /**
   * Synchronously flushes any uncommitted editor changes to the parent state & SQLite.
   * Clears the `isDirtyRef` flag so redundant writes are avoided.
   */
  const saveNow = useCallback(() => {
    if (!isDirtyRef.current || !editorRef.current) return;
    try {
      const currentEditor = editorRef.current;
      const json = currentEditor.getJSON();
      const title = extractTitle(json);
      const strContent = JSON.stringify(json);
      isDirtyRef.current = false;
      onUpdateRef.current(strContent, title);
    } catch (err) {
      console.error("Failed to save editor content:", err);
    }
  }, []);

  /**
   * Handles document change events:
   * 1. Sets dirty flag so exit/blur handlers know changes exist.
   * 2. Computes character count in O(1) time without expensive JSON serialization.
   * 3. Schedules a debounced 300ms save to disk.
   */
  const handleEditorUpdate = useCallback(
    (editorInstance: any) => {
      // 1. Mark dirty
      isDirtyRef.current = true;

      // 2. Update cheap metadata (O(1) / direct text length, no JSON serialization)
      const count = editorInstance?.state?.doc?.textContent?.length ?? 0;
      setCharCount(count);

      // 3. Reset 300ms debounce timer
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        saveNow();
      }, 300);
    },
    [saveNow]
  );

  const extensions = useMemo(() => getExtensions(SlashCommand), []);

  /**
   * TipTap Editor Instance Setup:
   * - `extensions`: Configures full typography, syntax highlighting, task lists, and custom commands.
   * - `content`: Hydrates either from parsed TipTap JSON or converts markdown strings into schema-valid HTML.
   * - `clipboardTextSerializer`: Preserves rich Markdown structure when copying text selections from the note.
   * - `handlePaste`: Intercepts clipboard events:
   *     1. Detects dropped/pasted Markdown files (.md/.txt) and parses them into rich TipTap nodes.
   *     2. Detects raw Markdown text strings and converts them to formatted HTML before insertion.
   */
  const editor = useEditor(
    {
      extensions,
      content: content
        ? (() => {
            try {
              return JSON.parse(content);
            } catch {
              return markdownToTipTapHtml(content);
            }
          })()
        : undefined,
      onUpdate: ({ editor }) => {
        handleEditorUpdate(editor);
      },
      editorProps: {
        attributes: {
          class: "tiptap",
          spellcheck: "true",
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
                  const html = markdownToTipTapHtml(mdText);
                  editorRef.current.commands.insertContent(html);
                }
              });
              return true;
            }
          }

          // 2. Check if pasted plain text contains Markdown formatting
          const plainText = clipboardData.getData("text/plain");
          if (plainText && isMarkdownContent(plainText)) {
            event.preventDefault();
            const html = markdownToTipTapHtml(plainText);
            if (editorRef.current) {
              editorRef.current.commands.insertContent(html);
            }
            return true;
          }

          return false;
        },
      },
      autofocus: "end",
    },
    [noteId]
  );

  editorRef.current = editor;

  // Initialize character count once on mount or content load
  useEffect(() => {
    if (editor) {
      setCharCount(editor.state.doc.textContent.length);
    }
  }, [editor]);

  /**
   * Multi-stage cursor focus restoration:
   * Guarantees that when switching notes or when the macOS window gains focus,
   * the text caret is restored to the end of the note without requiring a mouse click.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const focusNote = () => {
      if (editor && !editor.isDestroyed && !editor.isFocused) {
        editor.commands.focus("end");
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
   * Listens for Tauri backend `app-focused` IPC event to refocus the editor
   * when the app is brought forward from a background state.
   */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .listen("app-focused", () => {
        if (editorRef.current && !editorRef.current.isDestroyed) {
          editorRef.current.commands.focus("end");
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  /**
   * Typing safety net: for ~1.5s after the panel gains focus, if a printable key
   * arrives while nothing is focused, focus the editor first so the character lands.
   * Time-limited on purpose so "Esc loses focus" still works.
   */
  useEffect(() => {
    if (!editor) return;
    let armedUntil = 0;
    const arm = () => {
      armedUntil = Date.now() + 1500;
    };

    window.addEventListener("focus", arm);
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .listen("app-focused", arm)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    const onKeyDown = (e: KeyboardEvent) => {
      if (Date.now() > armedUntil) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return; // printable only, keep shortcuts intact
      const a = document.activeElement;
      if (a && a !== document.body) return; // don't hijack FindBar/palette inputs
      if (!editor.isDestroyed && !editor.isFocused) editor.commands.focus("end");
    };
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("focus", arm);
      window.removeEventListener("keydown", onKeyDown, true);
      unlisten?.();
    };
  }, [editor]);

  /**
   * Intercepts `<a>` link clicks inside the note document to open external URLs
   * in the user's default system browser via the `@tauri-apps/plugin-opener` plugin.
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
   * Flush uncommitted edits on unmount or note switch to prevent data loss.
   */
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (isDirtyRef.current && editorRef.current) {
        try {
          const currentEditor = editorRef.current;
          const json = currentEditor.getJSON();
          const title = extractTitle(json);
          const strContent = JSON.stringify(json);
          isDirtyRef.current = false;
          onUpdateRef.current(strContent, title);
        } catch (err) {
          console.error("Failed to flush editor update on unmount:", err);
        }
      }
    };
  }, []);

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
    return () => window.removeEventListener("blur", handleBlur);
  }, [saveNow]);

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
        className="flex-1 min-h-0 overflow-y-auto pt-3 relative"
      >
        <div style={{ zoom: zoomLevel } as React.CSSProperties} className="relative">
          <SmoothCaret
            editor={editor}
            zoomLevel={zoomLevel}
            scrollContainerRef={scrollContainerRef}
          />
          <EditorContent editor={editor} />
        </div>
      </div>
      <DocumentTickSlider scrollContainerRef={scrollContainerRef} />
      <div className="editor-char-count">
        {charCount.toLocaleString()} {charCount === 1 ? "character" : "characters"}
      </div>
      <BottomToolbar editor={editor} />
    </div>
  );
}
