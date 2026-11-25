import { listenToSettingsSync } from "../lib/settingsSync";
import { getStoredCommandsConfig, useCommandsConfig, getCommandHotkey } from "../lib/commandsConfig";
import { Editor, useEditorState } from "@tiptap/react";
import { GlassClaritySlider } from "./GlassClaritySlider";
import "@tiptap/extension-underline";
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Heading,
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
  Code,
  Minus,
  Table as TableIcon,
  ALargeSmall,
  Type,
  ChevronDown,
  X,
  Plus,
  Palette,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { blockSelectionPluginKey } from "../extensions/BlockSelection";
import { HIGHLIGHT_COLORS, HIGHLIGHT_STYLES } from "../editor/textHighlight";
import { smartToggleBlockFormat, smartToggleMark } from "../editor/formatMemory";
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

type FormatGroup = "headings" | "text" | "highlight" | "lists" | "insert" | "appearance";

interface BottomToolbarProps {
  editor: Editor | null;
}

export function BottomToolbar({ editor }: BottomToolbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const formatButtonRef = useRef<HTMLButtonElement>(null);
  const [currentAccent, setCurrentAccent] = useState<AccentColor>(getStoredAccent);
  const [currentFont, setCurrentFont] = useState<string>(getStoredFont);
  const [currentThemeMode, setCurrentThemeMode] = useState<ThemeMode>(getStoredThemeMode);
  const [group, setGroup] = useState<FormatGroup | null>(null);
  const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);
  const commandsConfig = useCommandsConfig();

  const formatTitle = (label: string, id: string, defaultHotkey = "") => {
    const { hotkey, enabled } = getCommandHotkey(commandsConfig, id, defaultHotkey);
    return enabled && hotkey ? `${label} (${hotkey})` : label;
  };

  useEffect(() => {
    const stopSettings = listenToSettingsSync({ onThemeModeChange: setCurrentThemeMode, onAccentChange: setCurrentAccent, onFontChange: setCurrentFont });
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

    return () => {
      stopSettings();
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
      setGroup(null);
      setIsFontPickerOpen(false);
      return;
    }

    if (document.activeElement === formatButtonRef.current) {
      containerRef.current?.querySelector<HTMLButtonElement>(".toolbar-btn")?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".command-overlay")) return;
      event.preventDefault();
      event.stopPropagation();
      if (containerRef.current?.contains(document.activeElement)) {
        formatButtonRef.current?.focus();
      }
      setIsMenuOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
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
          hasSelectedBlocks: false,
          highlightColor: null,
          highlightStyle: "classic",
          isCode: false,
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
      const highlight = ed.getAttributes("highlight");
      return {
        isBold: ed.isActive("bold"),
        isItalic: ed.isActive("italic"),
        isUnderline: ed.isActive("underline"),
        isStrike: ed.isActive("strike"),
        isHighlight: ed.isActive("highlight"),
        hasSelectedBlocks: Boolean(blockSelectionPluginKey.getState(ed.state)?.selectedPositions.length),
        highlightColor: highlight.color ?? null,
        highlightStyle: highlight.style ?? "classic",
        isCode: ed.isActive("code"),
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
    formatState?.isCode ||
    formatState?.isHeading1 ||
    formatState?.isHeading2 ||
    formatState?.isBulletList ||
    formatState?.isOrderedList ||
    formatState?.isTaskList ||
    formatState?.isBlockquote ||
    formatState?.isCodeBlock
  );

  const pickerStyle = formatState?.isHighlight ? formatState.highlightStyle : "stripes";
  const applyHighlight = (color: string | null, style: string) => {
    smartToggleMark(editor, "highlight", { color, style });
  };

  const groupButton = (id: FormatGroup, label: string, icon: ReactNode, active = false) => (
    <button
      type="button"
      className={`toolbar-btn format-group-btn ${active || group === id ? "is-active" : ""}`}
      aria-label={label}
      title={label}
      aria-expanded={group === id}
      aria-controls={group === id ? "editor-format-options" : undefined}
      onMouseDown={event => event.preventDefault()}
      onClick={() => {
        setGroup(current => current === id ? null : id);
        setIsFontPickerOpen(false);
      }}
    >
      {icon}
      <ChevronDown className="format-group-chevron" aria-hidden="true" />
    </button>
  );

  return (
    <div
      ref={containerRef}
      className={`bottom-toolbar-corner-container ${isMenuOpen ? "is-menu-open" : ""}`}
    >
      {isMenuOpen && (
        <div id="editor-format-menu" className="bottom-toolbar-expanded-menu" role="group" aria-label="Editor formatting">
          <div className="format-dock-strip">
            {groupButton("headings", "Headings", <Heading size={16} />, formatState?.isHeading1 || formatState?.isHeading2)}
            {groupButton("text", "Text styles", <Italic size={16} />, formatState?.isBold || formatState?.isItalic || formatState?.isUnderline || formatState?.isStrike)}
            {groupButton("highlight", "Highlight options", <HighlightIcon size={16} />, formatState?.isHighlight)}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleMark(editor, "code")}
              className={`toolbar-btn ${formatState?.isCode ? "is-active" : ""}`}
              title={formatTitle("Inline Code", "code", "⌘E")}
              aria-label="Inline Code"
              aria-pressed={formatState?.isCode ?? false}
            >
              <Code size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "codeBlock")}
              className={`toolbar-btn ${formatState?.isCodeBlock ? "is-active" : ""}`}
              aria-pressed={formatState?.isCodeBlock ?? false}
              title={formatTitle("Code Block", "code_block", "⌘⌥C")}
            >
              <Code2 size={14} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smartToggleBlockFormat(editor, "blockquote")}
              className={`toolbar-btn ${formatState?.isBlockquote ? "is-active" : ""}`}
              aria-pressed={formatState?.isBlockquote ?? false}
              title={formatTitle("Quote", "blockquote", "⇧⌘B")}
            >
              <Quote size={14} />
            </button>
            {groupButton("lists", "Lists", formatState?.isOrderedList ? <ListOrdered size={16} /> : <List size={16} />, formatState?.isBulletList || formatState?.isOrderedList || formatState?.isTaskList)}
            {groupButton("insert", "Insert", <Plus size={16} />)}
            {groupButton("appearance", "Appearance", <Palette size={16} />)}
          </div>

          {group && (
            <div id="editor-format-options" className="format-dock-options" role="group" aria-label="Format options">
              {group === "headings" && (
                <div className="expanded-toolbar-row" role="group" aria-label="Heading levels">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => smartToggleBlockFormat(editor, "heading1")}
                    className={`toolbar-btn ${formatState?.isHeading1 ? "is-active" : ""}`}
                    aria-pressed={formatState?.isHeading1 ?? false}
                    title={formatTitle("Heading 1", "heading1", "⌘⌥1")}
                  >
                    <Heading1 size={14} />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => smartToggleBlockFormat(editor, "heading2")}
                    className={`toolbar-btn ${formatState?.isHeading2 ? "is-active" : ""}`}
                    aria-pressed={formatState?.isHeading2 ?? false}
                    title={formatTitle("Heading 2", "heading2", "⌘⌥2")}
                  >
                    <Heading2 size={14} />
                  </button>
                </div>
              )}
              {group === "text" && (
                <>
                  <div className="expanded-toolbar-row" role="group" aria-label="Text styles">
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => smartToggleMark(editor, "bold")}
                      className={`toolbar-btn ${formatState?.isBold ? "is-active" : ""}`}
                      aria-pressed={formatState?.isBold ?? false}
                      title={formatTitle("Bold", "bold", "⌘B")}
                    >
                      <Bold size={14} />
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => smartToggleMark(editor, "italic")}
                      className={`toolbar-btn ${formatState?.isItalic ? "is-active" : ""}`}
                      aria-pressed={formatState?.isItalic ?? false}
                      title={formatTitle("Italic", "italic", "⌘I")}
                    >
                      <Italic size={14} />
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => smartToggleMark(editor, "underline")}
                      className={`toolbar-btn ${formatState?.isUnderline ? "is-active" : ""}`}
                      aria-pressed={formatState?.isUnderline ?? false}
                      title={formatTitle("Underline", "underline", "⌘U")}
                    >
                      <UnderlineIcon size={14} />
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => smartToggleMark(editor, "strike")}
                      className={`toolbar-btn ${formatState?.isStrike ? "is-active" : ""}`}
                      aria-pressed={formatState?.isStrike ?? false}
                      title={formatTitle("Strikethrough", "strike", "⇧⌘X")}
                    >
                      <Strikethrough size={14} />
                    </button>
                  </div>
                </>
              )}
              {group === "highlight" && (
                <div id="editor-highlight-options" className="editor-highlight-options"
                  onMouseDown={event => event.preventDefault()}>
                  <div className="highlight-options-header">
                    <span>Highlight</span>
                    <button type="button" className="highlight-remove" aria-label="Remove highlight"
                      disabled={!formatState?.isHighlight && !formatState?.hasSelectedBlocks}
                      onClick={() => smartToggleMark(editor, "highlight", null)}>
                      Clear
                    </button>
                  </div>
                  <div className="highlight-swatches" role="group" aria-label="Highlight color">
                    {HIGHLIGHT_COLORS.map(color => (
                      <button key={color} type="button" data-color={color}
                        data-highlight-style={pickerStyle}
                        title={color[0].toUpperCase() + color.slice(1)}
                        aria-label={color[0].toUpperCase() + color.slice(1)}
                        aria-pressed={formatState?.highlightColor === color}
                        onClick={() => applyHighlight(color, pickerStyle)} />
                    ))}
                  </div>
                  <div className="highlight-styles" role="group" aria-label="Highlight style">
                    {HIGHLIGHT_STYLES.map(([style, label]) => (
                      <button key={style} type="button" data-highlight-style={style}
                        data-color={formatState?.highlightColor ?? "yellow"}
                        aria-pressed={pickerStyle === style}
                        onClick={() => applyHighlight(formatState?.highlightColor ?? "yellow", style)}>
                        <span className="highlight-style-sample" aria-hidden="true">Aa</span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {group === "lists" && (
                <div className="expanded-toolbar-row" role="group" aria-label="List styles">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => smartToggleBlockFormat(editor, "bulletList")}
                    className={`toolbar-btn ${formatState?.isBulletList ? "is-active" : ""}`}
                    aria-pressed={formatState?.isBulletList ?? false}
                    title={formatTitle("Bullet List", "bullet_list", "⇧⌘8")}
                  >
                    <List size={14} />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => smartToggleBlockFormat(editor, "orderedList")}
                    className={`toolbar-btn ${formatState?.isOrderedList ? "is-active" : ""}`}
                    aria-pressed={formatState?.isOrderedList ?? false}
                    title={formatTitle("Numbered List", "ordered_list", "⇧⌘7")}
                  >
                    <ListOrdered size={14} />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => smartToggleBlockFormat(editor, "taskList")}
                    className={`toolbar-btn ${formatState?.isTaskList ? "is-active" : ""}`}
                    aria-pressed={formatState?.isTaskList ?? false}
                    title={formatTitle("Task List", "checklist", "⇧⌘9")}
                  >
                    <CheckSquare size={14} />
                  </button>
                </div>
              )}
              {group === "insert" && (
                <div className="expanded-toolbar-row" role="group" aria-label="Insert blocks">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => editor.chain().focus().setHorizontalRule().run()}
                    className="toolbar-btn"
                    title={formatTitle("Divider", "divider", "---")}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { if (getStoredCommandsConfig().find(c => c.id === "tables")?.enabled !== false) editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }}
                    className="toolbar-btn"
                    title="Insert Table (3x3)"
                  >
                    <TableIcon size={14} />
                  </button>
                </div>
              )}
              {group === "appearance" && (
                <>
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
                  <GlassClaritySlider />
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bottom-corner-buttons-row">
        <button
          type="button"
          ref={formatButtonRef}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setIsMenuOpen((prev) => !prev)}
          className={`format-corner-btn ${hasActiveFormatting ? "has-formatting" : ""} ${isMenuOpen ? "is-active" : ""}`}
          title={isMenuOpen ? "Close formatting (Esc)" : "Format (Aa)"}
          aria-label="Format"
          aria-expanded={isMenuOpen}
          aria-controls="editor-format-menu"
        >
          {isMenuOpen ? <X size={19} /> : <ALargeSmall size={19} />}
          {!isMenuOpen && hasActiveFormatting && <span className="format-indicator-dot" />}
        </button>
      </div>
    </div>
  );
}
