import { Editor, useEditorState } from "@tiptap/react";
import "@tiptap/extension-underline";
import { useState, useEffect, useRef } from "react";
import {
  Heading1,
  Heading2,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code2,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter as HighlightIcon,
  Minus,
  Table as TableIcon,
  ALargeSmall,
  Type,
  ChevronDown,
  Sun,
  Moon,
  Monitor,
  Mic,
} from "lucide-react";
import { smartToggleBlockFormat, smartToggleMark } from "../editor/formatMemory";
import { toggleDictation, subscribeDictationState } from "../lib/dictation";
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

import { getCurrentWindow } from "@tauri-apps/api/window";

interface BottomToolbarProps {
  editor: Editor | null;
}

export function BottomToolbar({ editor }: BottomToolbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isHoveredRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentAccent, setCurrentAccent] = useState<AccentColor>(getStoredAccent);
  const [currentFont, setCurrentFont] = useState<string>(getStoredFont);
  const [currentThemeMode, setCurrentThemeMode] = useState<ThemeMode>(getStoredThemeMode);
  const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);
  const [isDictating, setIsDictating] = useState(false);

  useEffect(() => {
    return subscribeDictationState((listening) => {
      setIsDictating(listening);
    });
  }, []);

  useEffect(() => {
    const handleAccent = (e: Event) => {
      const customEvent = e as CustomEvent<{ accent?: AccentColor }>;
      if (customEvent.detail?.accent) setCurrentAccent(customEvent.detail.accent);
    };
    const handleFont = (e: Event) => {
      const customEvent = e as CustomEvent<{ fontId?: string }>;
      if (customEvent.detail?.fontId) setCurrentFont(customEvent.detail.fontId);
    };
    const handleTheme = (e: Event) => {
      const customEvent = e as CustomEvent<{ mode?: ThemeMode }>;
      if (customEvent.detail?.mode) setCurrentThemeMode(customEvent.detail.mode);
    };
    window.addEventListener("notefast_accent_changed", handleAccent);
    window.addEventListener("notefast_font_changed", handleFont);
    window.addEventListener("notefast_theme_changed", handleTheme);

    let unlistenFocus: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) {
          isHoveredRef.current = false;
          setIsHovered(false);
          setIsMenuOpen(false);
          setIsFontPickerOpen(false);
        }
      })
      .then((fn) => {
        unlistenFocus = fn;
      })
      .catch(() => {});

    // Active pointer tracking: only dispatches state when crossing window boundaries
    const handlePointerMove = (e: PointerEvent) => {
      const inPage =
        e.clientX >= 0 &&
        e.clientX <= window.innerWidth &&
        e.clientY >= 0 &&
        e.clientY <= window.innerHeight;

      if (isHoveredRef.current !== inPage) {
        isHoveredRef.current = inPage;
        setIsHovered(inPage);
        if (!inPage) {
          setIsMenuOpen(false);
          setIsFontPickerOpen(false);
        }
      }
    };

    const handleReset = () => {
      if (isHoveredRef.current) {
        isHoveredRef.current = false;
        setIsHovered(false);
        setIsMenuOpen(false);
        setIsFontPickerOpen(false);
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        handleReset();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("mouseout", handleMouseOut);
    window.addEventListener("blur", handleReset);
    document.addEventListener("mouseleave", handleReset);


    return () => {
      window.removeEventListener("notefast_accent_changed", handleAccent);
      window.removeEventListener("notefast_font_changed", handleFont);
      window.removeEventListener("notefast_theme_changed", handleTheme);
      if (unlistenFocus) unlistenFocus();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("blur", handleReset);
      document.removeEventListener("mouseleave", handleReset);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
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

  const formatState = useEditorState({
    editor,
    selector: (ctx) => {
      const ed = ctx.editor;
      if (!ed) {
        return {
          isBold: false,
          isItalic: false,
          isUnderline: false,
          isStrike: false,
          isHighlight: false,
          isHeading1: false,
          isHeading2: false,
          isBulletList: false,
          isOrderedList: false,
          isTaskList: false,
          isBlockquote: false,
          isCodeBlock: false,
          canUndo: false,
          canRedo: false,
        };
      }
      return {
        isBold: ed.isActive("bold"),
        isItalic: ed.isActive("italic"),
        isUnderline: ed.isActive("underline"),
        isStrike: ed.isActive("strike"),
        isHighlight: ed.isActive("highlight"),
        isHeading1: ed.isActive("heading", { level: 1 }),
        isHeading2: ed.isActive("heading", { level: 2 }),
        isBulletList: ed.isActive("bulletList"),
        isOrderedList: ed.isActive("orderedList"),
        isTaskList: ed.isActive("taskList"),
        isBlockquote: ed.isActive("blockquote"),
        isCodeBlock: ed.isActive("codeBlock"),
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
      };
    },
  });

  if (!editor) return null;

  const hasActiveFormatting = Boolean(
    formatState?.isBold ||
    formatState?.isItalic ||
    formatState?.isUnderline ||
    formatState?.isStrike ||
    formatState?.isHighlight ||
    formatState?.isHeading1 ||
    formatState?.isHeading2 ||
    formatState?.isBulletList ||
    formatState?.isOrderedList ||
    formatState?.isTaskList ||
    formatState?.isBlockquote ||
    formatState?.isCodeBlock
  );

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsMenuOpen(false);
    setIsFontPickerOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`bottom-toolbar-corner-container ${isMenuOpen ? "is-menu-open" : ""} ${isHovered ? "is-hovered" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isMenuOpen && (
        <div className="bottom-toolbar-expanded-menu">
          <div className="expanded-toolbar-row">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "heading1")}
              className={`toolbar-btn liquid-btn ${formatState?.isHeading1 ? "is-active" : ""}`}
              title="Heading 1 (⌘⌥1)"
            >
              <Heading1 size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "heading2")}
              className={`toolbar-btn liquid-btn ${formatState?.isHeading2 ? "is-active" : ""}`}
              title="Heading 2 (⌘⌥2)"
            >
              <Heading2 size={14} />
            </button>
            <div className="toolbar-separator" />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleMark(editor, "bold")}
              className={`toolbar-btn liquid-btn ${formatState?.isBold ? "is-active" : ""}`}
              title="Bold (⌘B)"
            >
              <Bold size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleMark(editor, "italic")}
              className={`toolbar-btn liquid-btn ${formatState?.isItalic ? "is-active" : ""}`}
              title="Italic (⌘I)"
            >
              <Italic size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleMark(editor, "underline")}
              className={`toolbar-btn liquid-btn ${formatState?.isUnderline ? "is-active" : ""}`}
              title="Underline (⌘U)"
            >
              <UnderlineIcon size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleMark(editor, "strike")}
              className={`toolbar-btn liquid-btn ${formatState?.isStrike ? "is-active" : ""}`}
              title="Strikethrough (⇧⌘X)"
            >
              <Strikethrough size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleMark(editor, "highlight")}
              className={`toolbar-btn liquid-btn ${formatState?.isHighlight ? "is-active" : ""}`}
              title="Highlight (⇧⌘H)"
            >
              <HighlightIcon size={14} />
            </button>
            <div className="toolbar-separator" />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggleDictation(editor)}
              className={`toolbar-btn liquid-btn ${isDictating ? "is-dictating is-active" : ""}`}
              title={isDictating ? "Stop Dictation (⌥D)" : "Voice Dictation (⌥D or Fn twice)"}
            >
              <Mic size={14} className={isDictating ? "animate-pulse" : ""} />
            </button>
          </div>

          <div className="expanded-toolbar-divider" />

          <div className="expanded-toolbar-row">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "bulletList")}
              className={`toolbar-btn liquid-btn ${formatState?.isBulletList ? "is-active" : ""}`}
              title="Bullet List (⇧⌘8)"
            >
              <List size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "orderedList")}
              className={`toolbar-btn liquid-btn ${formatState?.isOrderedList ? "is-active" : ""}`}
              title="Numbered List (⇧⌘7)"
            >
              <ListOrdered size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "taskList")}
              className={`toolbar-btn liquid-btn ${formatState?.isTaskList ? "is-active" : ""}`}
              title="Task List (⇧⌘9)"
            >
              <CheckSquare size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "blockquote")}
              className={`toolbar-btn liquid-btn ${formatState?.isBlockquote ? "is-active" : ""}`}
              title="Quote (⇧⌘B)"
            >
              <Quote size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "codeBlock")}
              className={`toolbar-btn liquid-btn ${formatState?.isCodeBlock ? "is-active" : ""}`}
              title="Code Block (⌘⌥C)"
            >
              <Code2 size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              className="toolbar-btn liquid-btn"
              title="Horizontal Ruler / Separation Line (--- or ⌘⌥-)"
            >
              <Minus size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
              className="toolbar-btn liquid-btn"
              title="Insert Table (3x3)"
            >
              <TableIcon size={14} />
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

      <div className="bottom-corner-buttons-row">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleDictation(editor)}
          className={`format-corner-btn liquid-btn dictation-corner-btn ${isDictating ? "is-dictating is-active" : ""}`}
          title={isDictating ? "Stop Dictation (⌥D)" : "Voice Dictation (⌥D or Fn twice)"}
          aria-label="Voice Dictation"
        >
          <Mic size={17} className={isDictating ? "animate-pulse" : ""} />
        </button>

        <button
          type="button"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          className={`format-corner-btn liquid-btn ${hasActiveFormatting ? "has-formatting" : ""} ${isMenuOpen ? "is-active" : ""}`}
          title="Format (Aa)"
          aria-label="Format"
        >
          <ALargeSmall size={19} />
          {hasActiveFormatting && <span className="format-indicator-dot" />}
        </button>
      </div>
    </div>
  );
}
