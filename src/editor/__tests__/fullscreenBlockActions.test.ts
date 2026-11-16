// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { expect, it, vi } from "vitest";
import { getExtensions } from "../extensions";
import { getBlockSiblings, insertAdjacentBlock, moveBlockToBoundary } from "../fullscreenBlockActions";

it("inserts paragraphs above and below without replacing the note title", () => {
  const editor = new Editor({ extensions: [StarterKit.configure({ trailingNode: false })], content: "<h1>Title</h1><p>Body</p>" });
  try {
    let [title, body] = getBlockSiblings(editor.state.doc, 0);
    insertAdjacentBlock(editor, body, true);
    expect(editor.getHTML()).toBe("<h1>Title</h1><p></p><p>Body</p>");
    [title] = getBlockSiblings(editor.state.doc, 0);
    insertAdjacentBlock(editor, title, true);
    expect(editor.getHTML()).toBe("<h1>Title</h1><p></p><p></p><p>Body</p>");
  } finally {
    editor.destroy();
  }
});

it("moves a whole node in one undoable edit and preserves the title", () => {
  const editor = new Editor({ extensions: [StarterKit.configure({ trailingNode: false })], content: "<h1>Title</h1><p><strong>One</strong></p><blockquote><p>Two</p></blockquote>" });
  try {
    const before = editor.getJSON();
    const [title, one, two] = getBlockSiblings(editor.state.doc, 0);
    expect(moveBlockToBoundary(editor, title, editor.state.doc.content.size)).toBe(false);
    expect(moveBlockToBoundary(editor, two, 0)).toBe(false);
    expect(moveBlockToBoundary(editor, one, editor.state.doc.content.size)).toBe(true);
    expect(editor.state.doc.child(2).eq(one.node)).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  } finally {
    editor.destroy();
  }
});

it("inserts and moves list items within their list", () => {
  const editor = new Editor({ extensions: [StarterKit.configure({ trailingNode: false })], content: "<h1>Title</h1><ul><li><p>One</p></li><li><p>Two</p></li></ul>" });
  try {
    const [, list] = getBlockSiblings(editor.state.doc, 0);
    const [one, two] = getBlockSiblings(editor.state.doc, list.pos + 1);
    expect(moveBlockToBoundary(editor, two, one.pos)).toBe(true);
    const [first] = getBlockSiblings(editor.state.doc, list.pos + 1);
    insertAdjacentBlock(editor, first, false);
    expect(editor.state.doc.child(1).childCount).toBe(3);
    expect(editor.state.doc.child(1).child(0).textContent).toBe("Two");
    expect(editor.state.doc.child(1).child(1).textContent).toBe("");
    expect(editor.state.doc.child(1).child(2).textContent).toBe("One");
  } finally {
    editor.destroy();
  }
});

it("keeps the viewport when undo and redo restore a distant selection", () => {
  const scroller = document.createElement("div");
  scroller.setAttribute("data-scroll-container", "");
  document.body.append(scroller);
  const restoreScroll = vi.spyOn(scroller, "scrollTo");
  const editor = new Editor({
    element: scroller,
    extensions: getExtensions(),
    contentType: "markdown",
    content: "# Title\n\n" + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}`).join("\n\n"),
  });
  try {
    const blocks = getBlockSiblings(editor.state.doc, 0);
    editor.commands.setTextSelection(blocks[blocks.length - 1].pos + 1);
    const before = editor.getJSON();
    expect(moveBlockToBoundary(editor, blocks[40], blocks[43].pos)).toBe(true);
    const after = editor.getJSON();
    scroller.scrollTop = 800;
    const caretCoords = vi.spyOn(editor.view, "coordsAtPos");

    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(after);
    expect(caretCoords).not.toHaveBeenCalled();
    expect(restoreScroll.mock.calls).toEqual([
      [{ top: 800, behavior: "instant" }],
      [{ top: 800, behavior: "instant" }],
    ]);
  } finally {
    editor.destroy();
    scroller.remove();
  }
});
