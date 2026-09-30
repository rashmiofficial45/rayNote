import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useRef, useCallback } from "react";
import { getExtensions } from "./extensions";
import { SlashCommand } from "./SlashCommand";
import { BottomToolbar } from "../components/BottomToolbar";
import { FindBar } from "../components/FindBar";
import { SmoothCaret } from "../components/SmoothCaret";

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
  const pendingUpdateRef = useRef<{ content: string; title: string } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleUpdate = useCallback(
    (json: any) => {
      const title = extractTitle(json);
      const strContent = JSON.stringify(json);
      pendingUpdateRef.current = { content: strContent, title };

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        onUpdate(strContent, title);
        pendingUpdateRef.current = null;
      }, 300);
    },
    [onUpdate]
  );

  const editor = useEditor(
    {
      extensions: getExtensions(SlashCommand),
      content: content ? JSON.parse(content) : undefined,
      onUpdate: ({ editor }) => {
        handleUpdate(editor.getJSON());
      },
      editorProps: {
        attributes: {
          class: "tiptap",
          spellcheck: "true",
        },
      },
      autofocus: "end",
    },
    [noteId]
  );

  // Flush pending update on unmount to prevent lost keystrokes and free memory
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (pendingUpdateRef.current) {
        onUpdate(pendingUpdateRef.current.content, pendingUpdateRef.current.title);
        pendingUpdateRef.current = null;
      }
    };
  }, [onUpdate]);

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
      <BottomToolbar editor={editor} />
    </div>
  );
}
