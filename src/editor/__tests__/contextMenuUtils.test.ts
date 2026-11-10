// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../extensions";
import { resolveContextMenuState, executeContextMenuAction } from "../contextMenuUtils";
import * as clipboardModule from "../../lib/clipboard";
import * as openerModule from "@tauri-apps/plugin-opener";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

describe("Editor Context Menu Detection and Execution Utilities", () => {
  let editor: Editor;

  beforeEach(() => {
    vi.restoreAllMocks();
    editor = new Editor({
      extensions: getExtensions(),
      content: "<p>The quick brown fox jumps over the lazy dog.</p>",
    });
  });

  it("detects text-selected context when right-clicking inside an active text selection", () => {
    // Select "quick brown" (from index 5 to 16)
    editor.commands.setTextSelection({ from: 5, to: 16 });
    expect(editor.state.selection.empty).toBe(false);

    // Mock view.posAtCoords to return a position inside the selection (e.g. 10)
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 10, inside: 10 });

    const menuState = resolveContextMenuState(editor, { x: 100, y: 150 });
    expect(menuState).not.toBeNull();
    expect(menuState?.type).toBe("text-selected");
    expect(menuState?.savedSelection).toEqual({ from: 5, to: 16 });
    // Verify selection was NOT collapsed
    expect(editor.state.selection.from).toBe(5);
    expect(editor.state.selection.to).toBe(16);
  });

  it("moves caret and detects no-selection when right-clicking outside an existing text selection", () => {
    // Initially select 5 to 16
    editor.commands.setTextSelection({ from: 5, to: 16 });

    // Mock posAtCoords to return a position outside (e.g. 25)
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 25, inside: 25 });

    const menuState = resolveContextMenuState(editor, { x: 300, y: 150 });
    expect(menuState).not.toBeNull();
    expect(menuState?.type).toBe("no-selection");
    // Selection was updated to the clicked position
    expect(editor.state.selection.from).toBe(25);
  });

  it("detects link context when right-clicking a link mark", () => {
    editor.commands.setContent('<p>Check <a href="https://raynote.app">rayNote</a> today</p>');
    // Position inside "rayNote" (e.g. pos 8)
    editor.commands.setTextSelection(8);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 8, inside: 8 });

    const menuState = resolveContextMenuState(editor, { x: 120, y: 120 });
    expect(menuState).not.toBeNull();
    expect(menuState?.type).toBe("link");
    expect(menuState?.linkHref).toBe("https://raynote.app");
  });

  it("detects code-block context with text and range", () => {
    editor.commands.setContent('<pre><code>console.log("hello");</code></pre>');
    editor.commands.setTextSelection(5);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 5, inside: 5 });

    const menuState = resolveContextMenuState(editor, { x: 100, y: 100 });
    expect(menuState).not.toBeNull();
    expect(menuState?.type).toBe("code-block");
    expect(menuState?.codeBlockText).toContain('console.log("hello");');
  });

  it("detects checklist (taskItem) context", () => {
    editor.commands.setContent(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Complete secondary menu</p></li></ul>'
    );
    editor.commands.setTextSelection(5);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 5, inside: 5 });

    const menuState = resolveContextMenuState(editor, { x: 100, y: 100 });
    expect(menuState).not.toBeNull();
    expect(menuState?.type).toBe("checklist");
    expect(menuState?.taskItemChecked).toBe(false);
  });

  it("executes formatting actions (bold, italic) on selected text without deselecting", async () => {
    editor.commands.setTextSelection({ from: 5, to: 16 });
    const menuState = {
      type: "text-selected" as const,
      x: 100,
      y: 100,
      savedSelection: { from: 5, to: 16 },
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await executeContextMenuAction(editor, "bold", menuState);
    expect(editor.isActive("bold")).toBe(true);

    await executeContextMenuAction(editor, "italic", menuState);
    expect(editor.isActive("italic")).toBe(true);
  });

  it("executes insert block actions (heading, bulletList, codeBlock, divider)", async () => {
    editor.commands.setTextSelection(1);
    const menuState = {
      type: "no-selection" as const,
      x: 100,
      y: 100,
      savedSelection: { from: 1, to: 1 },
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await executeContextMenuAction(editor, "insertHeading1", menuState);
    expect(editor.isActive("heading", { level: 1 })).toBe(true);

    await executeContextMenuAction(editor, "insertBulletList", menuState);
    expect(editor.isActive("bulletList")).toBe(true);

    await executeContextMenuAction(editor, "insertCodeBlock", menuState);
    expect(editor.isActive("codeBlock")).toBe(true);
  });

  it("executes copy and cut using clipboard utilities", async () => {
    const copySpy = vi.spyOn(clipboardModule, "copyToClipboard").mockResolvedValue(true);
    editor.commands.setTextSelection({ from: 1, to: 10 });
    const menuState = {
      type: "text-selected" as const,
      x: 100,
      y: 100,
      savedSelection: { from: 1, to: 10 },
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await executeContextMenuAction(editor, "copy", menuState);
    expect(copySpy).toHaveBeenCalled();

    await executeContextMenuAction(editor, "cut", menuState);
    expect(copySpy).toHaveBeenCalledTimes(2);
  });

  it("executes openLink and copyLink", async () => {
    const copySpy = vi.spyOn(clipboardModule, "copyToClipboard").mockResolvedValue(true);
    const openerSpy = vi.spyOn(openerModule, "openUrl").mockResolvedValue(undefined);

    const menuState = {
      type: "link" as const,
      x: 100,
      y: 100,
      savedSelection: { from: 5, to: 5 },
      linkHref: "https://example.com",
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await executeContextMenuAction(editor, "openLink", menuState);
    expect(openerSpy).toHaveBeenCalledWith("https://example.com");

    await executeContextMenuAction(editor, "copyLink", menuState);
    expect(copySpy).toHaveBeenCalledWith("https://example.com");
  });

  it("executes taskList action to toggle taskList on selected text", async () => {
    editor.commands.setTextSelection({ from: 5, to: 16 });
    const menuState = {
      type: "text-selected" as const,
      x: 100,
      y: 100,
      savedSelection: { from: 5, to: 16 },
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await executeContextMenuAction(editor, "taskList", menuState);
    expect(editor.isActive("taskList")).toBe(true);
  });
});

