// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../extensions";
import {
  smartToggleBlockFormat,
  smartToggleMark,
  getCurrentFormatKind,
  isFormatActive,
  getBlockMemoryKey,
} from "../formatMemory";

describe("Format Memory & Smart Toggle Engine", () => {
  let editor: Editor;

  function createEditor(content: string = "<p>Sample text</p>") {
    return new Editor({
      extensions: getExtensions(),
      content,
    });
  }

  beforeEach(() => {
    editor = createEditor();
  });

  afterEach(() => {
    editor?.destroy();
  });

  describe("Format Detection & State", () => {
    it("detects paragraph format correctly", () => {
      editor.commands.setTextSelection(3);
      expect(getCurrentFormatKind(editor)).toBe("paragraph");
      expect(isFormatActive(editor, "paragraph")).toBe(true);
      expect(isFormatActive(editor, "heading1")).toBe(false);
    });

    it("detects heading1, heading2, heading3", () => {
      editor.commands.toggleHeading({ level: 1 });
      expect(getCurrentFormatKind(editor)).toBe("heading1");
      expect(isFormatActive(editor, "heading1")).toBe(true);

      editor.commands.toggleHeading({ level: 2 });
      expect(getCurrentFormatKind(editor)).toBe("heading2");
      expect(isFormatActive(editor, "heading2")).toBe(true);

      editor.commands.toggleHeading({ level: 3 });
      expect(getCurrentFormatKind(editor)).toBe("heading3");
      expect(isFormatActive(editor, "heading3")).toBe(true);
    });

    it("detects lists (ordered, bullet, task) and blockquote", () => {
      editor.commands.toggleOrderedList();
      expect(getCurrentFormatKind(editor)).toBe("orderedList");
      expect(isFormatActive(editor, "orderedList")).toBe(true);

      editor.commands.toggleBulletList();
      expect(getCurrentFormatKind(editor)).toBe("bulletList");
      expect(isFormatActive(editor, "bulletList")).toBe(true);

      editor.commands.toggleTaskList();
      expect(getCurrentFormatKind(editor)).toBe("taskList");
      expect(isFormatActive(editor, "taskList")).toBe(true);

      editor.commands.setParagraph();
      editor.commands.toggleBlockquote();
      expect(getCurrentFormatKind(editor)).toBe("blockquote");
      expect(isFormatActive(editor, "blockquote")).toBe(true);
    });

    it("generates deterministic memory keys per cursor block location", () => {
      editor.commands.setTextSelection(2);
      const key1 = getBlockMemoryKey(editor);
      expect(key1).toMatch(/^block_\d+_\d+$/);

      const key2 = getBlockMemoryKey(editor);
      expect(key1).toBe(key2);
    });
  });

  describe("smartToggleBlockFormat Memory Behavior", () => {
    it("toggles heading1 on and off, reverting to paragraph when previous format was unformatted", () => {
      editor.commands.setTextSelection(3);
      expect(getCurrentFormatKind(editor)).toBe("paragraph");

      // Turn on H1
      smartToggleBlockFormat(editor, "heading1");
      expect(editor.isActive("heading", { level: 1 })).toBe(true);

      // Turn off H1
      smartToggleBlockFormat(editor, "heading1");
      expect(editor.isActive("heading")).toBe(false);
      expect(getCurrentFormatKind(editor)).toBe("paragraph");
    });

    it("converts ordered list to heading1, and toggling off heading1 restores ordered list", () => {
      editor.commands.setContent("<ol><li><p>Item one</p></li></ol>");
      editor.commands.setTextSelection(4);
      expect(editor.isActive("orderedList")).toBe(true);

      // Convert ordered list item to Heading 1
      smartToggleBlockFormat(editor, "heading1");
      expect(editor.isActive("heading", { level: 1 })).toBe(true);

      // Toggling off heading1 should restore ordered list instead of dropping to paragraph
      smartToggleBlockFormat(editor, "heading1");
      expect(editor.isActive("orderedList")).toBe(true);
      expect(editor.isActive("heading")).toBe(false);
    });

    it("converts bullet list to blockquote, and toggling off restores bullet list", () => {
      editor.commands.setContent("<ul><li><p>Bullet item</p></li></ul>");
      editor.commands.setTextSelection(4);
      expect(editor.isActive("bulletList")).toBe(true);

      // Convert to blockquote
      smartToggleBlockFormat(editor, "blockquote");
      expect(editor.isActive("blockquote")).toBe(true);

      // Toggle off blockquote -> restores bullet list
      smartToggleBlockFormat(editor, "blockquote");
      expect(editor.isActive("bulletList")).toBe(true);
      expect(editor.isActive("blockquote")).toBe(false);
    });

    it("converts task list to heading2, and toggling off restores task list", () => {
      editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>');
      editor.commands.setTextSelection(3);
      expect(editor.isActive("taskList")).toBe(true);

      smartToggleBlockFormat(editor, "heading2");
      expect(editor.isActive("heading", { level: 2 })).toBe(true);

      smartToggleBlockFormat(editor, "heading2");
      expect(editor.isActive("taskList")).toBe(true);
      expect(editor.isActive("heading")).toBe(false);
    });
  });

  describe("smartToggleMark Formatting", () => {
    it("toggles bold on selected range", () => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      smartToggleMark(editor, "bold");
      expect(editor.isActive("bold")).toBe(true);

      smartToggleMark(editor, "bold");
      expect(editor.isActive("bold")).toBe(false);
    });

    it("toggles italic, underline, strike, highlight", () => {
      editor.commands.setTextSelection({ from: 1, to: 6 });

      smartToggleMark(editor, "italic");
      expect(editor.isActive("italic")).toBe(true);
      smartToggleMark(editor, "italic");
      expect(editor.isActive("italic")).toBe(false);

      smartToggleMark(editor, "underline");
      expect(editor.isActive("underline")).toBe(true);
      smartToggleMark(editor, "underline");
      expect(editor.isActive("underline")).toBe(false);

      smartToggleMark(editor, "strike");
      expect(editor.isActive("strike")).toBe(true);
      smartToggleMark(editor, "strike");
      expect(editor.isActive("strike")).toBe(false);

      smartToggleMark(editor, "highlight");
      expect(editor.isActive("highlight")).toBe(true);
      smartToggleMark(editor, "highlight");
      expect(editor.isActive("highlight")).toBe(false);
    });
  });
});
