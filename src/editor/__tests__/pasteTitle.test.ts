// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../extensions";
import { extractAutoTitleAndBody } from "../pasteTitleExtension";
import { extractTitleFromDoc } from "../Editor";

describe("Auto-Title on Paste (First Line to H1) Test Suite", () => {
  function createTestEditor(initialTitle = "Untitled", initialContent = "<p></p>") {
    let currentTitle = initialTitle;
    const editor = new Editor({
      extensions: getExtensions(undefined, {
        getCurrentTitle: () => currentTitle,
        onSetTitle: (t) => {
          currentTitle = t;
        },
      }),
      content: initialContent,
    });

    const paste = (text: string) => {
      const event = {
        clipboardData: {
          getData: (type: string) => (type === "text/plain" ? text : ""),
          files: [],
        },
        preventDefault: () => {},
      } as any;

      // In ProseMirror, handlePaste plugins are called in order
      return Boolean(
        editor.view.someProp("handlePaste", (handler) =>
          handler(editor.view, event, null as any)
        )
      );
    };

    return {
      editor,
      getTitle: () => currentTitle,
      setTitle: (t: string) => {
        currentTitle = t;
      },
      paste,
    };
  }

  // 1. "# My Note\n\nBody": title is "My Note", first pasted line is MOVED to title bar and removed from body (no H1 in body)
  it("1. # My Note\\n\\nBody: title 'My Note', body starts with 'Body' with NO H1 and body does NOT contain title", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("# My Note\n\nBody");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("My Note");

    // First block in body is paragraph with "Body" (NO H1 heading)
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    expect(editor.state.doc.child(0).textContent).toBe("Body");
    // Body does NOT contain title text
    expect(editor.getText()).not.toContain("My Note");
    editor.destroy();
  });

  // 2. "Plain first line\nsecond line": first line is moved to title bar, body starts with second line
  it("2. Plain first line\\nsecond line: first line moved to title bar, body starts with 'second line' and does NOT contain title", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("Plain first line\nsecond line");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("Plain first line");

    // First block in body is paragraph "second line" (NO H1)
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    expect(editor.state.doc.child(0).textContent).toBe("second line");
    // Body does NOT contain title text
    expect(editor.getText()).not.toContain("Plain first line");
    editor.destroy();
  });

  // 3. Leading blank lines before the first line: skipped, first content line is title
  it("3. Leading blank lines before the first line: skipped, title extracted, body starts at subsequent content", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("\n\n   \n# Real First Line\n\nBody text");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("Real First Line");
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    expect(editor.state.doc.child(0).textContent).toBe("Body text");
    expect(editor.getText()).not.toContain("Real First Line");
    editor.destroy();
  });

  // 4. Blank lines between the first line and the rest: skipped, body starts at first real content
  it("4. Blank lines between the first line and the rest: skipped, body starts at first real content", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("My Header\n\n\n\n\nFirst real paragraph");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("My Header");
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    expect(editor.state.doc.child(0).textContent).toBe("First real paragraph");
    expect(editor.getText()).not.toContain("My Header");
    editor.destroy();
  });

  // 5. "**Bold** title": formatted title becomes clean title in title bar
  it("5. **Bold** title: formatted title becomes clean title bar title, body contains only subsequent lines", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("**Bold** title\n\nBody after bold");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("Bold title");
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    expect(editor.state.doc.child(0).textContent).toBe("Body after bold");
    expect(editor.getText()).not.toContain("Bold title");
    editor.destroy();
  });

  // 6. Single-line paste: first line is moved to title bar, body contains empty paragraph, body does NOT contain title
  it("6. Single-line paste: first line moved to title bar, body contains empty paragraph with no title text", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("Only one line");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("Only one line");
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    expect(editor.state.doc.child(0).textContent).toBe("");
    expect(editor.getText().trim()).toBe("");
    expect(editor.getText()).not.toContain("Only one line");
    editor.destroy();
  });

  // 7. Paste into a NON-empty note: normal paste, title unchanged
  it("7. Paste into a NON-empty note: normal paste, title unchanged", () => {
    const { editor, getTitle, paste } = createTestEditor("Untitled", "<p>Existing note text</p>");
    const handled = paste("# New Pasted Content\n\nMore text");

    // Must NOT be handled by auto-title extension
    expect(handled).toBe(false);
    expect(getTitle()).toBe("Untitled");
    editor.destroy();
  });

  // 8. Paste when the title is already custom: unchanged
  it("8. Paste when the title is already custom: unchanged", () => {
    const { editor, getTitle, paste } = createTestEditor("Custom User Title", "<p></p>");
    const handled = paste("# Another Title\n\nSome body text");

    expect(handled).toBe(false);
    expect(getTitle()).toBe("Custom User Title");
    editor.destroy();
  });

  // 9. Paste inside a code block: unchanged
  it("9. Paste inside a code block: unchanged", () => {
    const { editor, getTitle, paste } = createTestEditor("Untitled", "<pre><code class=\"language-bash\"></code></pre>");
    // Move selection inside the code block
    editor.commands.setTextSelection(1);
    expect(editor.isActive("codeBlock")).toBe(true);

    const handled = paste("# Code Comment\nconsole.log(123);");

    expect(handled).toBe(false);
    expect(getTitle()).toBe("Untitled");
    editor.destroy();
  });

  // 10. Undo: body empty again and title restored in one step
  it("10. Undo: body empty again and title restored in one step", () => {
    const { editor, getTitle, paste } = createTestEditor("Untitled");
    paste("# My Note\n\nBody content");

    expect(getTitle()).toBe("My Note");
    expect(editor.state.doc.child(0).textContent).toBe("Body content");
    expect(editor.getText()).not.toContain("My Note");

    // Perform Undo
    editor.commands.undo();

    expect(getTitle()).toBe("Untitled");
    expect(editor.getText().trim()).toBe("");

    // Perform Redo
    editor.commands.redo();

    expect(getTitle()).toBe("My Note");
    expect(editor.state.doc.child(0).textContent).toBe("Body content");
    expect(editor.getText()).not.toContain("My Note");
    editor.destroy();
  });

  // 11. Pasted list/table/code fence parse into real nodes with NO H1 in body
  it("11. Pasted list/table/code fence parse into real nodes with NO H1 in body", () => {
    const { editor, getTitle, paste } = createTestEditor("Untitled");
    const complexMd = `Plain Title Line

- Item Alpha
- Item Beta

| Header 1 | Header 2 |
| --- | --- |
| Val 1 | Val 2 |

\`\`\`javascript
const answer = 42;
\`\`\`
`;

    const handled = paste(complexMd);
    expect(handled).toBe(true);
    expect(getTitle()).toBe("Plain Title Line");

    // Body does NOT contain title text and has NO H1
    expect(editor.getText()).not.toContain("Plain Title Line");

    let hasBulletList = false;
    let hasTable = false;
    let hasCodeBlock = false;
    let hasH1 = false;

    for (let i = 0; i < editor.state.doc.childCount; i++) {
      const child = editor.state.doc.child(i);
      if (child.type.name === "heading" && child.attrs.level === 1) hasH1 = true;
      if (child.type.name === "bulletList") hasBulletList = true;
      if (child.type.name === "table") hasTable = true;
      if (child.type.name === "codeBlock") hasCodeBlock = true;
    }

    expect(hasH1).toBe(false);
    expect(hasBulletList).toBe(true);
    expect(hasTable).toBe(true);
    expect(hasCodeBlock).toBe(true);
    editor.destroy();
  });

  // 12. Explicit spec check: Body does NOT contain title text, and Cmd+Z restores both body AND title in one step
  it("12. Body does NOT contain the title text, and Cmd+Z restores body AND title in one step", () => {
    const { editor, getTitle, paste } = createTestEditor("Untitled");
    const handled = paste("# Secret Project Title\n\nFirst paragraph of secret project.\nSecond paragraph.");
    expect(handled).toBe(true);

    // Title is moved to title bar
    expect(getTitle()).toBe("Secret Project Title");

    // Body does NOT contain title text
    expect(editor.getText()).not.toContain("Secret Project Title");
    expect(editor.getText()).toContain("First paragraph of secret project.");
    expect(editor.getText()).toContain("Second paragraph.");

    // No H1 in body
    for (let i = 0; i < editor.state.doc.childCount; i++) {
      const child = editor.state.doc.child(i);
      expect(child.type.name === "heading" && child.attrs.level === 1).toBe(false);
    }

    // Typing more into the paragraph body does NOT overwrite title
    editor.commands.insertContent("Extra typed text. ");
    expect(getTitle()).toBe("Secret Project Title");
    expect(editor.getText()).not.toContain("Secret Project Title");

    // Perform Undo back before the typing
    editor.commands.undo();
    // Perform Undo back before the paste
    editor.commands.undo();

    // Body AND title are restored in one step
    expect(getTitle()).toBe("Untitled");
    expect(editor.getText().trim()).toBe("");
    editor.destroy();
  });

  // 13. Purity & Undo/Redo Lockstep: plugin view update handles title side-effects; Undo and Redo restore title and body in lockstep
  it("13. Purity & Undo/Redo Lockstep: Undo and Redo restore both title and body in lockstep in one step", () => {
    const { editor, getTitle, paste } = createTestEditor("Untitled");
    const pasteResult = paste("# Original Header\n\nLine 1 of body.\nLine 2 of body.");
    expect(pasteResult).toBe(true);

    // Initial paste state
    expect(getTitle()).toBe("Original Header");
    expect(editor.getText()).toContain("Line 1 of body.");
    expect(editor.getText()).not.toContain("Original Header");

    // 1 step Undo: Reverts both body AND title back to initial empty state
    const undoSuccess = editor.commands.undo();
    expect(undoSuccess).toBe(true);
    expect(getTitle()).toBe("Untitled");
    expect(editor.getText().trim()).toBe("");

    // 1 step Redo: Re-applies both body AND title in lockstep
    const redoSuccess = editor.commands.redo();
    expect(redoSuccess).toBe(true);
    expect(getTitle()).toBe("Original Header");
    expect(editor.getText()).toContain("Line 1 of body.");
    expect(editor.getText()).not.toContain("Original Header");

    // Another Undo to verify repeatability
    editor.commands.undo();
    expect(getTitle()).toBe("Untitled");
    expect(editor.getText().trim()).toBe("");

    editor.destroy();
  });

  // Additional extraction helper tests
  describe("extractAutoTitleAndBody unit checks", () => {
    it("handles inline formatting, links, and code correctly", () => {
      const res = extractAutoTitleAndBody(
        "## Check out [Google](https://google.com) with *italics* and `code`\n\nRemaining line"
      );
      expect(res).not.toBeNull();
      expect(res?.title).toBe("Check out Google with italics and code");
      expect(res?.bodyMarkdown).toBe("Remaining line");
    });

    it("caps long titles at 120 characters", () => {
      const longTitle = "A".repeat(150);
      const res = extractAutoTitleAndBody(`${longTitle}\n\nBody`);
      expect(res?.title.length).toBeLessThanOrEqual(120);
    });

    it("returns null on whitespace-only input", () => {
      expect(extractAutoTitleAndBody("   \n\n\t  ")).toBeNull();
    });
  });

  describe("Paste-Title Invariants (Items 5a, 5b, 5c, 5d)", () => {
    it("5a. extractTitleFromDoc returns undefined (never empty string) when doc has no H1", () => {
      const { editor } = createTestEditor("Existing Title", "<p>Simple paragraph</p>");
      const extracted = extractTitleFromDoc(editor.state.doc);
      expect(extracted).toBeUndefined();
      expect(extracted).not.toBe("");
      editor.destroy();
    });

    it("5b. Only the FIRST node of the document can be a title source; a later H1 never changes the title", () => {
      const { editor } = createTestEditor("Existing Title", "<p>First paragraph</p><h1>Second Node H1</h1>");
      const extracted = extractTitleFromDoc(editor.state.doc);
      // Because first child is paragraph, extracted title is undefined, so second node H1 is ignored
      expect(extracted).toBeUndefined();
      editor.destroy();
    });

    it("5d. Title survives: paste, type in body, switch notes, reload", () => {
      // 1. Paste into fresh editor
      const { editor, getTitle, paste } = createTestEditor("Untitled");
      paste("# Durable Project Title\n\nInitial body line");
      expect(getTitle()).toBe("Durable Project Title");

      // 2. Type in body
      editor.commands.insertContent(" and extra typing in body");
      expect(getTitle()).toBe("Durable Project Title");

      // 3. Simulate note switch (serialize & store in cache/db)
      const serializedJson = JSON.stringify(editor.getJSON());
      const savedTitle = getTitle();
      expect(savedTitle).toBe("Durable Project Title");
      editor.destroy();

      // 4. Reload from stored state
      const reloaded = createTestEditor(savedTitle, serializedJson);
      expect(reloaded.getTitle()).toBe("Durable Project Title");
      expect(reloaded.editor.getText()).toContain("Initial body line and extra typing in body");
      reloaded.editor.destroy();
    });
  });
});
