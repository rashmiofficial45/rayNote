// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor as TipTapEditor } from "@tiptap/core";
import { getExtensions } from "../extensions";
import { Editor } from "../Editor";
import {
  isSafeUrl,
  normalizeUrl,
  createInternalNoteUrl,
  isInternalNoteUrl,
  extractNoteIdFromUrl,
  safeOpenUrl,
} from "../../lib/linkUtils";
import { noteContentToMarkdown } from "../../lib/utils";
import { markdownToTipTapHtml } from "../markdownUtils";
import { resolveContextMenuState } from "../contextMenuUtils";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    onFocusChanged: vi.fn().mockResolvedValue(vi.fn()),
    isFocused: vi.fn().mockResolvedValue(true),
    listen: vi.fn().mockResolvedValue(vi.fn()),
  }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Comprehensive Link Handling Regression Suite (Phases 1-13)", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.restoreAllMocks();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    document.querySelectorAll(".raynote-link-popover").forEach((el) => el.remove());
    document.querySelectorAll(".editor-context-menu").forEach((el) => el.remove());
  });

  function createTestEditor(content = ""): TipTapEditor {
    return new TipTapEditor({
      content,
      extensions: getExtensions(),
    });
  }

  // 1. Automatic link creation
  it("1. automatically converts typed URLs into links when boundary is entered", () => {
    const editor = createTestEditor("<p></p>");
    editor.commands.setTextSelection(1);
    const url = "https://tiptap.dev";
    editor.view.dispatch(editor.view.state.tr.insertText(url, 1));
    editor.view.dispatch(editor.view.state.tr.insertText(" ", 1 + url.length));

    let foundLink = false;
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "link")) {
        foundLink = true;
      }
    });
    expect(foundLink).toBe(true);
    expect(editor.getHTML()).toContain('href="https://tiptap.dev"');
    editor.destroy();
  });

  // 2. Raw URL paste
  it("2. raw URL paste creates a hyperlink correctly", () => {
    const editor = createTestEditor("<p>Hello </p>");
    editor.commands.focus("end");
    // Insert URL content
    editor.commands.insertContent('<a href="https://example.com">https://example.com</a>');
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com"');
    editor.destroy();
  });

  // 3. Paste URL over selected text
  it("3. paste URL over selected text preserves label and applies link mark", () => {
    const editor = createTestEditor("<p>Read the official documentation.</p>");
    // Select "official documentation" (characters 10 to 32)
    editor.commands.setTextSelection({ from: 10, to: 32 });
    const selectedText = editor.state.doc.textBetween(10, 32);
    expect(selectedText).toBe("official documentation");

    // Apply link mark (simulating linkOnPaste behavior)
    editor.commands.setLink({ href: "https://tiptap.dev" });

    // Verify label is preserved and marked as link
    const updatedText = editor.state.doc.textBetween(10, 32);
    expect(updatedText).toBe("official documentation");
    const mark = editor.state.doc.resolve(15).marks().find((m) => m.type.name === "link");
    expect(mark).toBeDefined();
    expect(mark?.attrs.href).toBe("https://tiptap.dev");
    editor.destroy();
  });

  // 4. Cmd+K with selected text
  it("4. Cmd+K with selected text opens link popover with prefilled text and empty href", async () => {
    let editorInstance: any = null;
    await act(async () => {
      root.render(
        <Editor
          noteId="note-test-cmdk"
          initialContent="<p>Select this phrase for linking</p>"
          onUpdate={vi.fn()}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    expect(editorInstance).not.toBeNull();
    // Select "this phrase"
    act(() => {
      const fullText = editorInstance.getText();
      const targetPhrase = "this phrase";
      const startIdx = fullText.indexOf(targetPhrase);
      // In TipTap doc, position 1 is start of first block
      editorInstance.commands.setTextSelection({ from: startIdx + 1, to: startIdx + 1 + targetPhrase.length });
    });

    // Dispatch Cmd+K
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("raynote:open-link-popover", { detail: { mode: "edit" } })
      );
    });

    const popover = document.querySelector(".raynote-link-popover");
    expect(popover).not.toBeNull();
    const textInput = popover?.querySelector('input[placeholder="Link text..."]') as HTMLInputElement;
    expect(textInput?.value).toBe("this phrase");
  });

  // 5. Cmd+K inside existing link
  it("5. Cmd+K inside existing link opens popover in edit mode with current text and href", async () => {
    let editorInstance: any = null;
    await act(async () => {
      root.render(
        <Editor
          noteId="note-test-edit-link"
          initialContent='<p>Visit <a href="https://example.com">My Website</a> today</p>'
          onUpdate={vi.fn()}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    expect(editorInstance).not.toBeNull();
    // Caret inside "My Website" (pos 10)
    act(() => {
      editorInstance.commands.setTextSelection(10);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("raynote:open-link-popover", { detail: { mode: "edit" } })
      );
    });

    const popover = document.querySelector(".raynote-link-popover");
    expect(popover).not.toBeNull();
    const urlInput = popover?.querySelector('input[placeholder="https://example.com"]') as HTMLInputElement;
    const textInput = popover?.querySelector('input[placeholder="Link text..."]') as HTMLInputElement;
    expect(textInput?.value).toBe("My Website");
    expect(urlInput?.value).toBe("https://example.com");
  });

  // 6. Cmd+K without selection
  it("6. Cmd+K without selection opens compact insert-link interface at caret", async () => {
    let editorInstance: any = null;
    await act(async () => {
      root.render(
        <Editor
          noteId="note-test-insert"
          initialContent="<p>Plain start </p>"
          onUpdate={vi.fn()}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    act(() => {
      editorInstance.commands.focus("end");
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("raynote:open-link-popover", { detail: { mode: "edit" } })
      );
    });

    const popover = document.querySelector(".raynote-link-popover");
    expect(popover).not.toBeNull();
    const textInput = popover?.querySelector('input[placeholder="Link text..."]') as HTMLInputElement;
    expect(textInput?.value).toBe("");
  });

  // 7. Editing link display text
  it("7. editing link display text updates label without corrupting destination", () => {
    const editor = createTestEditor('<p><a href="https://apple.com">Old Label</a></p>');
    editor.commands.setTextSelection({ from: 1, to: 10 });
    // Replace text while keeping mark
    editor.commands.insertContentAt({ from: 1, to: 10 }, [
      {
        type: "text",
        text: "New Apple Label",
        marks: [{ type: "link", attrs: { href: "https://apple.com" } }],
      },
    ]);

    expect(editor.getText()).toContain("New Apple Label");
    const mark = editor.state.doc.resolve(5).marks().find((m) => m.type.name === "link");
    expect(mark?.attrs.href).toBe("https://apple.com");
    editor.destroy();
  });

  // 8. Editing link destination
  it("8. editing link destination updates href without altering label", () => {
    const editor = createTestEditor('<p><a href="https://old.com">Stable Text</a></p>');
    editor.commands.setTextSelection({ from: 1, to: 12 });
    editor.commands.setLink({ href: "https://newdestination.org" });

    expect(editor.getText()).toContain("Stable Text");
    const mark = editor.state.doc.resolve(5).marks().find((m) => m.type.name === "link");
    expect(mark?.attrs.href).toBe("https://newdestination.org");
    editor.destroy();
  });

  // 9. Removing a link without removing the text
  it("9. removing a link unsets mark but preserves exact text content", () => {
    const editor = createTestEditor('<p>Keep <a href="https://example.com">this wording</a> intact</p>');
    editor.commands.setTextSelection({ from: 6, to: 18 });
    editor.commands.unsetLink();

    expect(editor.getText()).toBe("Keep this wording intact");
    const marks = editor.state.doc.resolve(10).marks();
    expect(marks.some((m) => m.type.name === "link")).toBe(false);
    editor.destroy();
  });

  // 10. Undo/redo after link insertion or removal
  it("10. undo/redo restores previous state cleanly", () => {
    const editor = createTestEditor("<p>Plain text to link</p>");
    editor.commands.setTextSelection({ from: 1, to: 11 });
    editor.commands.setLink({ href: "https://tiptap.dev" });
    expect(editor.getHTML()).toContain('href="https://tiptap.dev"');

    // Undo link
    editor.commands.undo();
    expect(editor.getHTML()).not.toContain('href="https://tiptap.dev"');
    expect(editor.getText()).toBe("Plain text to link");

    // Redo link
    editor.commands.redo();
    expect(editor.getHTML()).toContain('href="https://tiptap.dev"');
    editor.destroy();
  });

  // 11. Backspace at the beginning and end of a link
  it("11. backspace at boundaries does not corrupt surrounding marks", () => {
    const editor = createTestEditor('<p>A <a href="https://example.com">Link</a> B</p>');
    // Position cursor at end of link (before " B")
    editor.commands.setTextSelection(7);
    editor.commands.deleteRange({ from: 6, to: 7 }); // Delete 'k'
    expect(editor.getText()).toBe("A Lin B");
    editor.destroy();
  });

  // 12. Enter near linked text
  it("12. pressing Enter splits line without ghost marks or stuck links", () => {
    const editor = createTestEditor('<p><a href="https://example.com">Linked Header</a></p>');
    editor.commands.focus("end");
    editor.commands.splitBlock();
    editor.commands.insertContent("Normal second line");

    const json = editor.getJSON();
    expect(json.content?.length).toBe(2);
    // Second line should not inherit link mark
    const secondLineMarks = json.content?.[1].content?.[0].marks || [];
    expect(secondLineMarks.some((m: any) => m.type === "link")).toBe(false);
    editor.destroy();
  });

  // 13. Adjacent formatted and unformatted text
  it("13. links coexist with bold, italic, and underline marks without collision", () => {
    const editor = createTestEditor(
      '<p><strong>Bold</strong> and <a href="https://example.com"><em>Italic Link</em></a></p>'
    );
    const html = editor.getHTML();
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<em>Italic Link</em>");
    editor.destroy();
  });

  // 14. Nested lists and task items containing links
  it("14. nested lists and task items preserve links", () => {
    const editor = createTestEditor(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task with <a href="https://example.com">link</a></p></li></ul>'
    );
    const html = editor.getHTML();
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('href="https://example.com"');
    editor.destroy();
  });

  // 15. Links inside headings
  it("15. links inside headings retain heading level and link mark", () => {
    const editor = createTestEditor('<h1>Heading with <a href="https://example.com">Link</a></h1>');
    const html = editor.getHTML();
    expect(html).toContain("<h1>Heading with <a");
    expect(html).toContain('href="https://example.com"');
    editor.destroy();
  });

  // 16. Code blocks must not accidentally autolink
  it("16. code blocks do not parse or autolink URLs inside code content", () => {
    const editor = createTestEditor(
      '<pre><code class="language-bash">curl https://example.com/api</code></pre>'
    );
    const json = editor.getJSON();
    const codeBlock = json.content?.[0];
    expect(codeBlock?.type).toBe("codeBlock");
    const codeTextNode = codeBlock?.content?.[0];
    // Must NOT have any marks (including link mark)
    expect(codeTextNode?.marks).toBeUndefined();
    editor.destroy();
  });

  // 17. IME composition and international text
  it("17. preserves international domain characters and safe unicode text", () => {
    expect(isSafeUrl("https://xn--bcher-kva.example")).toBe(true);
    expect(isSafeUrl("https://example.com/日本語/path")).toBe(true);
  });

  // 18. External URL safety
  it("18. strictly rejects dangerous URL protocols (javascript, data, file, vbscript)", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,hello")).toBe(false);
    expect(isSafeUrl("file:///Users/admin/passwords.txt")).toBe(false);
    expect(isSafeUrl("vbscript:MsgBox(1)")).toBe(false);
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });

  // 19. Read-only interaction
  it("19. read-only mode allows opening links and prevents editing mutations", async () => {
    let editorInstance: any = null;
    await act(async () => {
      root.render(
        <Editor
          noteId="note-read-only-test"
          initialContent='<p><a href="https://example.com">Read Only Link</a></p>'
          onUpdate={vi.fn()}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    // Make editor read-only
    act(() => {
      editorInstance.setEditable(false);
    });

    // Cmd+K must not open edit popover in read-only mode
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("raynote:open-link-popover", { detail: { mode: "edit" } })
      );
    });

    const popover = document.querySelector(".raynote-link-popover");
    expect(popover).toBeNull();
  });

  // 20. Internal link navigation and missing-note handling
  it("20. internal link format raynote://note/<id> is recognized and routes to note navigation", async () => {
    const targetId = "uuid-999-target";
    const noteUrl = createInternalNoteUrl(targetId);
    expect(isInternalNoteUrl(noteUrl)).toBe(true);
    expect(extractNoteIdFromUrl(noteUrl)).toBe(targetId);

    const onNavigateNote = vi.fn();
    const handled = await safeOpenUrl(noteUrl, { onNavigateNote });
    expect(handled).toBe(true);
    expect(onNavigateNote).toHaveBeenCalledWith(targetId);
  });

  // 21. Context menu selection restoration
  it("21. context menu preserves selection when opening link items", () => {
    const editor = createTestEditor("<p>Context menu selection test</p>");
    editor.commands.setTextSelection({ from: 1, to: 8 });
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 4, inside: 4 });

    const state = resolveContextMenuState(editor, { x: 50, y: 50 });
    expect(state).not.toBeNull();
    expect(state?.type).toBe("text-selected");
    expect(state?.savedSelection).toEqual({ from: 1, to: 8 });
    editor.destroy();
  });

  // 22. Popover boundary placement
  it("22. an open link popover stays in view when the window shrinks", async () => {
    let editorInstance: any = null;
    await act(async () => {
      root.render(
        <Editor
          noteId="note-popover-boundary"
          initialContent='<p><a href="https://example.com">Boundary Test</a></p>'
          onUpdate={vi.fn()}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    // Simulate clicking link near window edge
    expect(editorInstance).not.toBeNull();
    const linkEl = host.querySelector("a")!;
    vi.spyOn(linkEl, "getBoundingClientRect").mockReturnValue(new DOMRect(300, 40, 40, 20));

    await act(async () => {
      linkEl?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 790, clientY: 50 }));
    });

    const popover = document.querySelector(".raynote-link-popover") as HTMLElement;
    expect(popover).not.toBeNull();
    const width = 220;
    Object.defineProperty(popover, "offsetWidth", { value: width });
    const viewportWidth = vi.spyOn(window, "innerWidth", "get").mockReturnValue(320);
    try {
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(parseInt(popover.style.left, 10) + width).toBeLessThanOrEqual(320 - 12);
    } finally {
      viewportWidth.mockRestore();
    }
  });

  it("shows the destination URL in the preview for custom link text", async () => {
    const destination = "https://example.com/path?source=note#section";
    await act(async () => {
      root.render(
        <Editor
          noteId="note-link-preview-destination"
          initialContent={`<p><a href="${destination}">Custom label</a></p>`}
          onUpdate={vi.fn()}
        />
      );
    });

    const link = host.querySelector("a");
    expect(link?.textContent).toBe("Custom label");
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    const preview = document.querySelector('[aria-label="Link preview"]');
    expect(preview?.textContent).toBe(destination);
  });

  // 23. Repeated popup opening and cleanup
  it("23. repeated popover open and close cycles do not leak DOM elements", async () => {
    await act(async () => {
      root.render(
        <Editor
          noteId="note-leak-test"
          initialContent="<p>Test leak</p>"
          onUpdate={vi.fn()}
        />
      );
    });

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("raynote:open-link-popover", { detail: { mode: "edit" } })
        );
      });
      expect(document.querySelectorAll(".raynote-link-popover").length).toBe(1);

      // Dismiss with Escape
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(document.querySelectorAll(".raynote-link-popover").length).toBe(0);
    }
  });

  // 24. Save/load and Markdown round-trip
  it("24. markdown serialization round-trips hyperlinks with preserved URLs and titles", () => {
    const rawMarkdown = "[rayNote App](https://raynote.com)\n\n[Internal](raynote://note/xyz-123)";
    const html = markdownToTipTapHtml(rawMarkdown);
    expect(html).toContain('href="https://raynote.com"');
    expect(html).toContain('href="raynote://note/xyz-123"');

    const editor = createTestEditor(html);
    const exportedMarkdown = noteContentToMarkdown(JSON.stringify(editor.getJSON()), "");
    expect(exportedMarkdown).toContain("[rayNote App](https://raynote.com)");
    expect(exportedMarkdown).toContain("[Internal](raynote://note/xyz-123)");
    editor.destroy();
  });

  // 25. Copy/paste from external applications
  it("25. pasting markdown link syntax from clipboard parses into valid link mark", () => {
    const md = "Here is [a link](https://github.com/facebook) pasted from outside";
    const html = markdownToTipTapHtml(md);
    const editor = createTestEditor(html);
    expect(editor.getHTML()).toContain('href="https://github.com/facebook"');
    expect(editor.getText()).toContain("Here is a link pasted from outside");
    editor.destroy();
  });
});
