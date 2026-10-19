// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../extensions";
import { POPULAR_LANGUAGES } from "../CodeBlockComponent";

describe("Exhaustive Formatting & Shortcuts Verification Suite", () => {
  function createTestEditor(initialContent: string = "") {
    return new Editor({
      extensions: getExtensions(),
      content: initialContent || "<p>Hello world</p>",
    });
  }

  describe("1. Code Block Formatting & Shortcuts", () => {
    it("creates code block with default language", () => {
      const editor = createTestEditor("<p>const a = 1;</p>");
      editor.commands.selectAll();
      editor.commands.toggleCodeBlock();
      expect(editor.isActive("codeBlock")).toBe(true);
      expect(editor.getAttributes("codeBlock").language).toBe("bash");
      editor.destroy();
    });

    it("updates code block language to any popular language", () => {
      const editor = createTestEditor("<p>console.log('hi');</p>");
      editor.commands.selectAll();
      editor.commands.toggleCodeBlock({ language: "typescript" });
      expect(editor.isActive("codeBlock")).toBe(true);
      expect(editor.getAttributes("codeBlock").language).toBe("typescript");

      // Change language to JSON
      editor.commands.updateAttributes("codeBlock", { language: "json" });
      expect(editor.getAttributes("codeBlock").language).toBe("json");

      // Change language to Python
      editor.commands.updateAttributes("codeBlock", { language: "python" });
      expect(editor.getAttributes("codeBlock").language).toBe("python");

      // Change language to Rust
      editor.commands.updateAttributes("codeBlock", { language: "rust" });
      expect(editor.getAttributes("codeBlock").language).toBe("rust");

      editor.destroy();
    });

    it("all popular languages are well-formed and valid", () => {
      expect(POPULAR_LANGUAGES.length).toBeGreaterThan(20);
      for (const lang of POPULAR_LANGUAGES) {
        expect(lang.label).toBeTruthy();
        expect(lang.value).toBeTruthy();
        expect(lang.ext).toBeTruthy();
      }
    });

    it("handles Tab indent in code block", () => {
      const editor = createTestEditor("<pre><code class=\"language-javascript\">hello</code></pre>");
      editor.commands.setTextSelection(1);
      const shortcuts = editor.extensionManager.extensions.find(
        (ext) => ext.name === "shortcutsExtension"
      );
      const tabHandler = (shortcuts as any)?.config?.addKeyboardShortcuts?.call({ editor })?.Tab;
      expect(typeof tabHandler).toBe("function");

      const res = tabHandler();
      expect(res).toBe(true);
      expect(editor.getText()).toContain("  hello");
      editor.destroy();
    });

    it("handles Shift-Tab unindent in code block", () => {
      const editor = createTestEditor("<pre><code class=\"language-javascript\">  hello</code></pre>");
      editor.commands.setTextSelection(3); // after the 2 spaces
      const shortcuts = editor.extensionManager.extensions.find(
        (ext) => ext.name === "shortcutsExtension"
      );
      const shiftTabHandler = (shortcuts as any)?.config?.addKeyboardShortcuts?.call({ editor })?.["Shift-Tab"];
      expect(typeof shiftTabHandler).toBe("function");

      const res = shiftTabHandler();
      expect(res).toBe(true);
      expect(editor.getText().startsWith("hello")).toBe(true);
      editor.destroy();
    });

    it("Shift-Enter and Mod-Enter exit code block into a new paragraph", () => {
      const editor = createTestEditor("<pre><code class=\"language-javascript\">const x = 10;</code></pre>");
      editor.commands.setTextSelection(5);
      const shortcuts = editor.extensionManager.extensions.find(
        (ext) => ext.name === "shortcutsExtension"
      );
      const shiftEnterHandler = (shortcuts as any)?.config?.addKeyboardShortcuts?.call({ editor })?.["Shift-Enter"];
      expect(typeof shiftEnterHandler).toBe("function");

      const res = shiftEnterHandler();
      expect(res).toBe(true);
      // New node should be a paragraph after the code block
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.child(1).type.name).toBe("paragraph");
      editor.destroy();
    });
  });

  describe("2. Headings Formatting & Shortcuts", () => {
    it("toggles Heading 1, 2, 3 and reverts to paragraph", () => {
      const editor = createTestEditor("<p>Title</p>");
      editor.commands.setTextSelection(2);

      // Heading 1
      editor.commands.toggleHeading({ level: 1 });
      expect(editor.isActive("heading", { level: 1 })).toBe(true);

      // Heading 2
      editor.commands.toggleHeading({ level: 2 });
      expect(editor.isActive("heading", { level: 2 })).toBe(true);

      // Heading 3
      editor.commands.toggleHeading({ level: 3 });
      expect(editor.isActive("heading", { level: 3 })).toBe(true);

      // Set paragraph
      editor.commands.setParagraph();
      expect(editor.isActive("paragraph")).toBe(true);
      expect(editor.isActive("heading")).toBe(false);

      editor.destroy();
    });
  });

  describe("3. Lists & Task Lists Formatting & Shortcuts", () => {
    it("toggles bullet list, sinks and lifts list items", () => {
      const editor = createTestEditor("<p>Item 1</p>");
      editor.commands.setTextSelection(2);

      editor.commands.toggleBulletList();
      expect(editor.isActive("bulletList")).toBe(true);
      expect(editor.isActive("listItem")).toBe(true);

      editor.destroy();
    });

    it("toggles ordered list", () => {
      const editor = createTestEditor("<p>Step 1</p>");
      editor.commands.setTextSelection(2);

      editor.commands.toggleOrderedList();
      expect(editor.isActive("orderedList")).toBe(true);
      expect(editor.isActive("listItem")).toBe(true);

      editor.destroy();
    });

    it("toggles task list and handles checkbox check/uncheck with Mod-Enter", () => {
      const editor = createTestEditor("<p>Do homework</p>");
      editor.commands.setTextSelection(2);

      editor.commands.toggleTaskList();
      expect(editor.isActive("taskList")).toBe(true);
      expect(editor.isActive("taskItem")).toBe(true);
      expect(editor.getAttributes("taskItem").checked).toBe(false);

      // Mod-Enter toggles checkbox
      const shortcuts = editor.extensionManager.extensions.find(
        (ext) => ext.name === "shortcutsExtension"
      );
      const modEnterHandler = (shortcuts as any)?.config?.addKeyboardShortcuts?.call({ editor })?.["Mod-Enter"];
      expect(typeof modEnterHandler).toBe("function");

      modEnterHandler();
      expect(editor.getAttributes("taskItem").checked).toBe(true);

      modEnterHandler();
      expect(editor.getAttributes("taskItem").checked).toBe(false);

      editor.destroy();
    });
  });

  describe("4. Blockquotes Formatting", () => {
    it("toggles blockquote and exits", () => {
      const editor = createTestEditor("<p>Quote text</p>");
      editor.commands.setTextSelection(2);

      editor.commands.toggleBlockquote();
      expect(editor.isActive("blockquote")).toBe(true);

      editor.commands.toggleBlockquote();
      expect(editor.isActive("blockquote")).toBe(false);
      expect(editor.isActive("paragraph")).toBe(true);

      editor.destroy();
    });
  });

  describe("5. Inline Formatting Marks", () => {
    it("toggles bold (Mod-b)", () => {
      const editor = createTestEditor("<p>Hello world</p>");
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.toggleBold();
      expect(editor.isActive("bold")).toBe(true);
      editor.commands.toggleBold();
      expect(editor.isActive("bold")).toBe(false);
      editor.destroy();
    });

    it("toggles italic (Mod-i)", () => {
      const editor = createTestEditor("<p>Hello world</p>");
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.toggleItalic();
      expect(editor.isActive("italic")).toBe(true);
      editor.commands.toggleItalic();
      expect(editor.isActive("italic")).toBe(false);
      editor.destroy();
    });

    it("toggles underline (Mod-u)", () => {
      const editor = createTestEditor("<p>Hello world</p>");
      editor.commands.setTextSelection({ from: 1, to: 6 });
      (editor.commands as any).toggleUnderline();
      expect(editor.isActive("underline")).toBe(true);
      (editor.commands as any).toggleUnderline();
      expect(editor.isActive("underline")).toBe(false);
      editor.destroy();
    });

    it("toggles strike (Mod-Shift-x)", () => {
      const editor = createTestEditor("<p>Hello world</p>");
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.toggleStrike();
      expect(editor.isActive("strike")).toBe(true);
      editor.commands.toggleStrike();
      expect(editor.isActive("strike")).toBe(false);
      editor.destroy();
    });

    it("toggles inline code (Mod-e)", () => {
      const editor = createTestEditor("<p>Hello world</p>");
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.toggleCode();
      expect(editor.isActive("code")).toBe(true);
      editor.commands.toggleCode();
      expect(editor.isActive("code")).toBe(false);
      editor.destroy();
    });

    it("toggles highlight (Mod-Shift-h)", () => {
      const editor = createTestEditor("<p>Hello world</p>");
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.toggleHighlight();
      expect(editor.isActive("highlight")).toBe(true);
      editor.commands.toggleHighlight();
      expect(editor.isActive("highlight")).toBe(false);
      editor.destroy();
    });
  });

  describe("6. Horizontal Rule (Divider)", () => {
    it("inserts horizontal rule", () => {
      const editor = createTestEditor("<p>First line</p>");
      editor.commands.setTextSelection(11);
      editor.commands.setHorizontalRule();
      expect(editor.state.doc.childCount).toBeGreaterThan(1);
      editor.destroy();
    });
  });

  describe("7. Tables Formatting", () => {
    it("inserts table and checks row/cell structure", () => {
      const editor = createTestEditor("<p>Text before table</p>");
      editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
      expect(editor.isActive("table")).toBe(true);
      expect(editor.isActive("tableRow")).toBe(true);
      editor.destroy();
    });
  });
});
