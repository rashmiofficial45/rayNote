// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../extensions";
import { extractAutoTitleAndBody } from "../pasteTitleExtension";

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

  // 1. "# My Note\n\nBody": title is "My Note", first block is H1 with "My Note", followed by "Body"
  it("1. # My Note\\n\\nBody: title 'My Note', first line is H1 'My Note', followed by 'Body'", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("# My Note\n\nBody");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("My Note");

    // First block in body is Heading 1 with "My Note"
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(0).attrs.level).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("My Note");

    // Second block is paragraph with "Body"
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    expect(editor.state.doc.child(1).textContent).toBe("Body");
    editor.destroy();
  });

  // 2. "Plain first line\nsecond line": even if formatting was plain text, first line becomes H1
  it("2. Plain first line\\nsecond line: first line becomes H1 even though source was plain text", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("Plain first line\nsecond line");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("Plain first line");

    // First block is promoted to Heading 1
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(0).attrs.level).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("Plain first line");

    // Second block is paragraph "second line"
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    expect(editor.state.doc.child(1).textContent).toBe("second line");
    editor.destroy();
  });

  // 3. Leading blank lines before the first line: skipped
  it("3. Leading blank lines before the first line: skipped, first content line is H1", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("\n\n   \n# Real First Line\n\nBody text");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("Real First Line");
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(0).attrs.level).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("Real First Line");
    editor.destroy();
  });

  // 4. Blank lines between the first line and the rest: skipped, body starts at first real content
  it("4. Blank lines between the first line and the rest: skipped", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("My Header\n\n\n\n\nFirst real paragraph");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("My Header");
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(0).attrs.level).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("My Header");
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    expect(editor.state.doc.child(1).textContent).toBe("First real paragraph");
    editor.destroy();
  });

  // 5. "**Bold** title": first line becomes H1 with clean title
  it("5. **Bold** title: formatted title becomes clean H1", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("**Bold** title\n\nBody after bold");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("Bold title");
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(0).attrs.level).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("Bold title");
    editor.destroy();
  });

  // 6. Single-line paste: first line is H1, title set
  it("6. Single-line paste: creates H1 heading with line content and sets title", () => {
    const { editor, getTitle, paste } = createTestEditor();
    const handled = paste("Only one line");

    expect(handled).toBe(true);
    expect(getTitle()).toBe("Only one line");
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(0).attrs.level).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("Only one line");
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
    expect(editor.state.doc.child(0).textContent).toBe("My Note");

    // Perform Undo
    editor.commands.undo();

    expect(getTitle()).toBe("Untitled");
    expect(editor.getText().trim()).toBe("");

    // Perform Redo
    editor.commands.redo();

    expect(getTitle()).toBe("My Note");
    expect(editor.state.doc.child(0).textContent).toBe("My Note");
    expect(editor.state.doc.child(1).textContent).toBe("Body content");
    editor.destroy();
  });

  // 11. Pasted list/table/code fence parse into real nodes below the H1
  it("11. Pasted list/table/code fence parse into real nodes below the H1", () => {
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

    // Child 0 is H1
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(0).attrs.level).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("Plain Title Line");

    // Verify rich nodes exist below it
    let hasBulletList = false;
    let hasTable = false;
    let hasCodeBlock = false;

    for (let i = 1; i < editor.state.doc.childCount; i++) {
      const child = editor.state.doc.child(i);
      if (child.type.name === "bulletList") hasBulletList = true;
      if (child.type.name === "table") hasTable = true;
      if (child.type.name === "codeBlock") hasCodeBlock = true;
    }

    expect(hasBulletList).toBe(true);
    expect(hasTable).toBe(true);
    expect(hasCodeBlock).toBe(true);
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
});
