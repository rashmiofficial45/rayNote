// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { getExtensions } from "../extensions";
import { findVisualLineRange, findParagraphRange } from "../clickSelectionExtension";

describe("Selection Behaviors & Hit-Testing Acceptance Suite", () => {
  function createTestEditor(initialContent: string = "") {
    return new Editor({
      extensions: getExtensions(),
      content: initialContent || "<p>Hello world</p>",
    });
  }

  describe("1. Single Click & Focus", () => {
    it("puts caret at mid-text and focuses editor", () => {
      const editor = createTestEditor("<p>Hello world, testing rayNote</p>");
      editor.commands.setTextSelection(7); // right before 'world'
      expect(editor.state.selection.from).toBe(7);
      expect(editor.state.selection.to).toBe(7);

      // Typing inserts at the caret
      editor.commands.insertContent("beautiful ");
      expect(editor.getText()).toBe("Hello beautiful world, testing rayNote");
      editor.destroy();
    });

    it("focus('end') positions caret at the very end of the document", () => {
      const editor = createTestEditor("<p>Line 1</p><p>Line 2 with extra words</p>");
      editor.chain().focus("end").run();
      const docEnd = editor.state.doc.content.size - 1; // inside last textblock
      expect(editor.state.selection.from).toBe(docEnd);
      expect(editor.state.selection.to).toBe(docEnd);
      editor.destroy();
    });
  });

  describe("2. Word Double-Click Selection", () => {
    it("word boundary selection excludes trailing punctuation (hello, -> hello)", () => {
      const editor = createTestEditor("<p>hello, world.</p>");
      const text = editor.getText();
      expect(text).toBe("hello, world.");

      // Find position of word 'hello'
      const helloStart = 1;
      const helloEnd = 6; // 'hello' length is 5 -> pos 1 to 6

      const selection = TextSelection.create(editor.state.doc, helloStart, helloEnd);
      const selectedText = editor.state.doc.textBetween(selection.from, selection.to);

      expect(selectedText).toBe("hello");
      expect(selectedText.includes(",")).toBe(false);
      expect(selectedText.endsWith(" ")).toBe(false);
      editor.destroy();
    });
  });

  describe("3. Triple-Click Visual Line Selection", () => {
    it("selects logical line inside code blocks (split on newline)", () => {
      const editor = createTestEditor(
        '<pre><code class="language-bash">echo "first line"\necho "second line"\necho "third line"</code></pre>'
      );

      // Pos inside "second line"
      const docText = editor.state.doc.textContent;
      const secondLineIdx = docText.indexOf('echo "second line"');
      const secondLinePos = 2 + secondLineIdx; // +2 for block open

      const range = findVisualLineRange(editor.view, secondLinePos);
      const selectedText = editor.state.doc.textBetween(range.from, range.to);

      expect(selectedText).toBe('echo "second line"');
      expect(selectedText.includes("\n")).toBe(false);
      editor.destroy();
    });

    it("selects visual line for headings and paragraphs", () => {
      const editor = createTestEditor("<h1>Header title</h1><p>Paragraph content</p>");
      const range = findVisualLineRange(editor.view, 5);
      expect(range.from).toBe(1);
      expect(range.to).toBe(13); // 'Header title'
      const selectedText = editor.state.doc.textBetween(range.from, range.to);
      expect(selectedText).toBe("Header title");
      editor.destroy();
    });
  });

  describe("4. Quadruple-Click Paragraph Selection", () => {
    it("selects the entire textblock containing the cursor", () => {
      const editor = createTestEditor("<p>First paragraph with multiple words</p><p>Second paragraph</p>");
      // Cursor in first paragraph
      const range = findParagraphRange(editor.view, 10);
      expect(range.from).toBe(1);
      expect(range.to).toBe(36); // length of first paragraph content

      const selected = editor.state.doc.textBetween(range.from, range.to);
      expect(selected).toBe("First paragraph with multiple words");
      editor.destroy();
    });
  });

  describe("5. Block Selection Margin Isolation", () => {
    it("empty bottom space click does not trigger text selection inside previous blocks", () => {
      const editor = createTestEditor("<p>Short note</p>");
      // Focus end simulates click in bottom wrapper
      editor.chain().focus("end").run();
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
      editor.destroy();
    });
  });
});
