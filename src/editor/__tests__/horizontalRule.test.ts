// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../extensions";
import { insertHorizontalRuleSmart } from "../horizontalRuleExtension";

describe("HorizontalRuleExtension Smart Insertion & Input Rules", () => {
  let editor: Editor;

  function createEditor(content: string = "<p>Initial text</p>") {
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

  describe("Smart Divider Insertion Across Block Types", () => {
    it("converts a regular paragraph into a divider with a new paragraph below", () => {
      editor.commands.setContent("<p>First paragraph</p><p>Second paragraph</p>");
      editor.commands.setTextSelection(4);

      const success = insertHorizontalRuleSmart(editor.state, editor.view.dispatch);
      expect(success).toBe(true);

      // Node structure should have horizontalRule
      const hasHr = editor.state.doc.content.toJSON().some((n: any) => n.type === "horizontalRule");
      expect(hasHr).toBe(true);
    });

    it("inserts horizontal rule below title Heading 1 at document top", () => {
      editor.commands.setContent("<h1>My Document Title</h1><p>Body text</p>");
      editor.commands.setTextSelection(5); // inside H1

      const success = insertHorizontalRuleSmart(editor.state, editor.view.dispatch);
      expect(success).toBe(true);

      // First child should still be Heading 1 (preserving schema requirement)
      expect(editor.state.doc.child(0).type.name).toBe("heading");
      expect(editor.state.doc.child(0).attrs.level).toBe(1);

      // Second child should be horizontalRule
      expect(editor.state.doc.child(1).type.name).toBe("horizontalRule");

      // Third child should be paragraph
      expect(editor.state.doc.child(2).type.name).toBe("paragraph");
    });

    it("inserts horizontal rule directly above subheadings (H2, H3)", () => {
      editor.commands.setContent("<h1>Title</h1><h2>Subheading</h2><p>Body</p>");
      editor.commands.setTextSelection(12); // inside H2

      const success = insertHorizontalRuleSmart(editor.state, editor.view.dispatch);
      expect(success).toBe(true);

      // HR should be inserted between Title and Subheading
      expect(editor.state.doc.child(1).type.name).toBe("horizontalRule");
      expect(editor.state.doc.child(2).type.name).toBe("heading");
      expect(editor.state.doc.child(2).attrs.level).toBe(2);
    });

    it("inserts horizontal rule above checklist when triggered on first item", () => {
      editor.commands.setContent(`
        <ul data-type="taskList">
          <li data-type="taskItem" data-checked="false"><p>Task 1</p></li>
          <li data-type="taskItem" data-checked="false"><p>Task 2</p></li>
        </ul>
      `);
      editor.commands.setTextSelection(4); // inside Task 1

      const success = insertHorizontalRuleSmart(editor.state, editor.view.dispatch);
      expect(success).toBe(true);

      // HR is placed directly above the checklist
      expect(editor.state.doc.child(0).type.name).toBe("horizontalRule");
      expect(editor.state.doc.child(1).type.name).toBe("taskList");
    });

    it("splits checklist and inserts horizontal rule between items when triggered on middle item", () => {
      editor.commands.setContent(`
        <ul data-type="taskList">
          <li data-type="taskItem" data-checked="false"><p>Task 1</p></li>
          <li data-type="taskItem" data-checked="false"><p>Task 2</p></li>
        </ul>
      `);
      // Select inside Task 2 (pos 15)
      editor.commands.setTextSelection(15);

      const success = insertHorizontalRuleSmart(editor.state, editor.view.dispatch);
      expect(success).toBe(true);

      // Check document has taskList, horizontalRule, taskList
      const types = [];
      for (let i = 0; i < editor.state.doc.childCount; i++) {
        types.push(editor.state.doc.child(i).type.name);
      }
      expect(types).toContain("horizontalRule");
      expect(types).toContain("taskList");
    });

    it("inserts horizontal rule inside blockquote without RangeError on top-level node depth", () => {
      editor.commands.setContent("<blockquote><p>Quote content</p></blockquote>");
      editor.commands.setTextSelection(3); // inside blockquote paragraph

      // This previously threw RangeError: There is no position before the top-level node
      expect(() => {
        insertHorizontalRuleSmart(editor.state, editor.view.dispatch);
      }).not.toThrow();

      const types = [];
      for (let i = 0; i < editor.state.doc.childCount; i++) {
        types.push(editor.state.doc.child(i).type.name);
      }
      expect(types).toContain("horizontalRule");
    });
  });

  describe("Shortcuts and Markdown Input Rules", () => {
    it("converts '---' and Enter into a horizontal rule", () => {
      editor.commands.setContent("<p>---</p>");
      editor.commands.setTextSelection(4);

      const shortcuts = editor.extensionManager.extensions.find(
        (ext) => ext.name === "horizontalRule"
      );
      const enterHandler = (shortcuts as any)?.config?.addKeyboardShortcuts?.call({ editor })?.Enter;
      expect(typeof enterHandler).toBe("function");

      const handled = enterHandler({ editor });
      expect(handled).toBe(true);

      const hasHr = editor.state.doc.content.toJSON().some((n: any) => n.type === "horizontalRule");
      expect(hasHr).toBe(true);
    });

    it("converts em-dash '—' and Enter into a horizontal rule", () => {
      editor.commands.setContent("<p>—</p>");
      editor.commands.setTextSelection(2);

      const shortcuts = editor.extensionManager.extensions.find(
        (ext) => ext.name === "horizontalRule"
      );
      const enterHandler = (shortcuts as any)?.config?.addKeyboardShortcuts?.call({ editor })?.Enter;
      const handled = enterHandler({ editor });
      expect(handled).toBe(true);

      const hasHr = editor.state.doc.content.toJSON().some((n: any) => n.type === "horizontalRule");
      expect(hasHr).toBe(true);
    });
  });
});
