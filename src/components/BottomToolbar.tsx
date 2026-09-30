import { Editor } from "@tiptap/react";
import { useState, useEffect, useRef } from "react";
import {
  Heading1,
  Heading2,
  List,
  CheckSquare,
  Quote,
  Code2,
  Link as LinkIcon,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter as HighlightIcon,
  Minus,
  ALargeSmall,
} from "lucide-react";

interface BottomToolbarProps {
  editor: Editor | null;
}

export function BottomToolbar({ editor }: BottomToolbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  if (!editor) return null;

  const handleLinkClick = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl || "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const hasActiveFormatting =
    editor.isActive("bold") ||
    editor.isActive("italic") ||
    editor.isActive("underline") ||
    editor.isActive("strike") ||
    editor.isActive("highlight") ||
    editor.isActive("heading") ||
    editor.isActive("bulletList") ||
    editor.isActive("taskList") ||
    editor.isActive("blockquote") ||
    editor.isActive("codeBlock") ||
    editor.isActive("link");

  return (
    <div ref={containerRef} className="bottom-toolbar-corner-container">
      {isMenuOpen && (
        <div className="bottom-toolbar-expanded-menu">
          <div className="expanded-toolbar-row">
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("heading", { level: 1 }) ? "is-active" : ""}`}
              title="Heading 1 (⌘⌥1)"
            >
              <Heading1 size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("heading", { level: 2 }) ? "is-active" : ""}`}
              title="Heading 2 (⌘⌥2)"
            >
              <Heading2 size={14} />
            </button>
            <div className="toolbar-separator" />
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("bold") ? "is-active" : ""}`}
              title="Bold (⌘B)"
            >
              <Bold size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("italic") ? "is-active" : ""}`}
              title="Italic (⌘I)"
            >
              <Italic size={14} />
            </button>
            <button
              onClick={() => (editor.chain().focus() as any).toggleUnderline().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("underline") ? "is-active" : ""}`}
              title="Underline (⌘U)"
            >
              <UnderlineIcon size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("strike") ? "is-active" : ""}`}
              title="Strikethrough (⇧⌘X)"
            >
              <Strikethrough size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("highlight") ? "is-active" : ""}`}
              title="Highlight (⇧⌘H)"
            >
              <HighlightIcon size={14} />
            </button>
            <button
              onClick={handleLinkClick}
              className={`toolbar-btn liquid-btn ${editor.isActive("link") ? "is-active" : ""}`}
              title="Link (⌘L)"
            >
              <LinkIcon size={14} />
            </button>
          </div>

          <div className="expanded-toolbar-divider" />

          <div className="expanded-toolbar-row">
            <button
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("bulletList") ? "is-active" : ""}`}
              title="Bullet List (⇧⌘8)"
            >
              <List size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("taskList") ? "is-active" : ""}`}
              title="Task List (⇧⌘9)"
            >
              <CheckSquare size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("blockquote") ? "is-active" : ""}`}
              title="Quote (⇧⌘B)"
            >
              <Quote size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              className={`toolbar-btn liquid-btn ${editor.isActive("codeBlock") ? "is-active" : ""}`}
              title="Code Block (⌘⌥C)"
            >
              <Code2 size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              className="toolbar-btn liquid-btn"
              title="Horizontal Ruler / Separation Line (--- or ⌘⌥-)"
            >
              <Minus size={14} />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setIsMenuOpen((prev) => !prev)}
        className={`format-corner-btn liquid-btn ${hasActiveFormatting ? "has-formatting" : ""} ${isMenuOpen ? "is-active" : ""}`}
        title="Format (Aa)"
        aria-label="Format"
      >
        <ALargeSmall size={16} />
        {hasActiveFormatting && <span className="format-indicator-dot" />}
      </button>
    </div>
  );
}
