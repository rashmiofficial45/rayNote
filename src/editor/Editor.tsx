import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useRef, useCallback, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
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

  // Synchronously serializes and flushes pending changes to SQLite
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

  const editor = useEditor(
    {
      extensions: getExtensions(SlashCommand),
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

  // Intercept external links and open via native system browser
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

  // Flush pending update on unmount or note switch to guarantee zero data loss
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
        className="flex-1 min-h-0 overflow-y-auto scroll-smooth pt-3 relative"
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
