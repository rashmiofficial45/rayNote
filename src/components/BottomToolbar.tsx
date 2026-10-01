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
  Table as TableIcon,
  Video,
  ALargeSmall,
  Type,
  ChevronDown,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import {
  ACCENT_OPTIONS,
  FONT_OPTIONS,
  AccentColor,
  ThemeMode,
  getStoredAccent,
  setStoredAccent,
  getStoredFont,
  setStoredFont,
  getStoredThemeMode,
  setStoredThemeMode,
} from "../lib/theme";

interface BottomToolbarProps {
  editor: Editor | null;
}

export function BottomToolbar({ editor }: BottomToolbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentAccent, setCurrentAccent] = useState<AccentColor>(getStoredAccent);
  const [currentFont, setCurrentFont] = useState<string>(getStoredFont);
  const [currentThemeMode, setCurrentThemeMode] = useState<ThemeMode>(getStoredThemeMode);
  const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);

  useEffect(() => {
    const handleAccent = (e: any) => {
      if (e.detail?.accent) setCurrentAccent(e.detail.accent);
    };
    const handleFont = (e: any) => {
      if (e.detail?.fontId) setCurrentFont(e.detail.fontId);
    };
    const handleTheme = (e: any) => {
      if (e.detail?.mode) setCurrentThemeMode(e.detail.mode);
    };
    window.addEventListener("notefast_accent_changed", handleAccent);
    window.addEventListener("notefast_font_changed", handleFont);
    window.addEventListener("notefast_theme_changed", handleTheme);
    return () => {
      window.removeEventListener("notefast_accent_changed", handleAccent);
      window.removeEventListener("notefast_font_changed", handleFont);
      window.removeEventListener("notefast_theme_changed", handleTheme);
    };
  }, []);

  const handleAccentChange = (accent: AccentColor) => {
    setStoredAccent(accent);
    setCurrentAccent(accent);
  };

  const handleThemeModeChange = (mode: ThemeMode) => {
    setStoredThemeMode(mode);
    setCurrentThemeMode(mode);
  };

  const handleFontChange = (fontId: string) => {
    setStoredFont(fontId);
    setCurrentFont(fontId);
    setIsFontPickerOpen(false);
  };

  useEffect(() => {
    if (!isMenuOpen) {
      setIsFontPickerOpen(false);
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
        setIsFontPickerOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
        setIsFontPickerOpen(false);
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
            <button
              onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
              className="toolbar-btn liquid-btn"
              title="Insert Table (3x3)"
            >
              <TableIcon size={14} />
            </button>
            <button
              onClick={() => {
                const input = window.prompt("Enter YouTube URL or <iframe> embed code:");
                if (!input || !input.trim()) return;
                const trimmed = input.trim();
                const iframeSrcMatch = trimmed.match(/src=["']([^"']+)["']/i);
                if (trimmed.startsWith("<iframe") && iframeSrcMatch) {
                  (editor.chain().focus() as any).setIframe({ src: iframeSrcMatch[1] }).run();
                } else if (trimmed.includes("youtube.com") || trimmed.includes("youtu.be")) {
                  (editor.chain().focus() as any).setYoutubeVideo({ src: trimmed }).run();
                } else {
                  (editor.chain().focus() as any).setIframe({ src: trimmed }).run();
                }
              }}
              className="toolbar-btn liquid-btn"
              title="Embed Video / Iframe"
            >
              <Video size={14} />
            </button>
          </div>

          <div className="expanded-toolbar-divider" />

          {/* Row 3: Appearance Mode (Dark/Light/System) + Accent Shade + Font Picker */}
          <div className="toolbar-theme-row">
            <div className="toolbar-theme-mode-group" title="Theme Mode: Dark, Light, or System">
              <button
                type="button"
                onClick={() => handleThemeModeChange("dark")}
                className={`theme-mode-btn ${currentThemeMode === "dark" ? "is-selected" : ""}`}
                title="Dark Mode"
                aria-label="Dark Mode"
              >
                <Moon size={11} />
              </button>
              <button
                type="button"
                onClick={() => handleThemeModeChange("light")}
                className={`theme-mode-btn ${currentThemeMode === "light" ? "is-selected" : ""}`}
                title="Light Mode"
                aria-label="Light Mode"
              >
                <Sun size={11} />
              </button>
              <button
                type="button"
                onClick={() => handleThemeModeChange("system")}
                className={`theme-mode-btn ${currentThemeMode === "system" ? "is-selected" : ""}`}
                title="System (Auto macOS)"
                aria-label="System Mode"
              >
                <Monitor size={11} />
              </button>
            </div>

            <div className="toolbar-separator" />

            <div className="toolbar-accent-group" title="Themes: 6 Liquid Glass Palettes">
              {ACCENT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleAccentChange(opt.id)}
                  className={`accent-color-btn ${currentAccent === opt.id ? "is-selected" : ""}`}
                  title={`Accent Shade: ${opt.name}`}
                  aria-label={`Accent: ${opt.name}`}
                >
                  <span
                    className="accent-color-btn-dot"
                    style={{ backgroundColor: opt.color }}
                  />
                </button>
              ))}
            </div>

            <div className="toolbar-separator" />

            <button
              onClick={() => setIsFontPickerOpen((prev) => !prev)}
              className="toolbar-font-btn"
              title="Change Editor Font"
            >
              <Type size={12} />
              <span>{FONT_OPTIONS.find((f) => f.id === currentFont)?.name || "Font"}</span>
              <ChevronDown size={11} style={{ opacity: 0.6 }} />
            </button>
          </div>

          {/* Collapsible 6-Font Grid */}
          {isFontPickerOpen && (
            <div className="toolbar-font-dropdown">
              {FONT_OPTIONS.map((font) => (
                <button
                  key={font.id}
                  onClick={() => handleFontChange(font.id)}
                  className={`toolbar-font-item ${currentFont === font.id ? "is-active" : ""}`}
                  style={{ fontFamily: font.family }}
                  title={font.name}
                >
                  {font.name}
                </button>
              ))}
            </div>
          )}
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
