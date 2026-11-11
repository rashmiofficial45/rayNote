// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../extensions";
import { EditorContextMenu } from "../EditorContextMenu";
import { ContextMenuState } from "../contextMenuUtils";
import * as clipboardModule from "../../lib/clipboard";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("EditorContextMenu Component & User Interactions", () => {
  let host: HTMLDivElement;
  let root: Root;
  let editor: Editor;

  beforeEach(() => {
    vi.restoreAllMocks();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    editor = new Editor({
      extensions: getExtensions(),
      content: "<p>The quick brown fox jumps over the lazy dog.</p>",
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    // Clean up any context menus rendered via portal into document.body
    document.querySelectorAll(".editor-context-menu").forEach((el) => el.remove());
    editor.destroy();
  });

  it("renders Menu A (Text Selected) with Cut, Copy, Paste, Bold, Italic, Lists (without Link)", async () => {
    editor.commands.setTextSelection({ from: 5, to: 16 });

    const menuState: ContextMenuState = {
      type: "text-selected",
      x: 150,
      y: 200,
      savedSelection: { from: 5, to: 16 },
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    expect(menuEl).not.toBeNull();

    const labels = Array.from(menuEl!.querySelectorAll(".editor-context-menu-label")).map(
      (el) => el.textContent
    );

    expect(labels).toContain("Cut");
    expect(labels).toContain("Copy");
    expect(labels).toContain("Paste");
    expect(labels).toContain("Bold");
    expect(labels).toContain("Italic");
    expect(labels).toContain("Bullet List");
    expect(labels).toContain("Numbered List");

    // Critical Requirement: Insert/Edit Link must be completely removed from Menu A
    expect(labels).not.toContain("Insert/Edit Link");
    expect(labels).not.toContain("Insert Link");
    expect(labels).not.toContain("Edit Link");

    // Verify shortcuts are present (and ⌘K is absent)
    const shortcuts = Array.from(menuEl!.querySelectorAll(".editor-context-menu-shortcut")).map(
      (el) => el.textContent
    );
    expect(shortcuts).toContain("⌘X");
    expect(shortcuts).toContain("⌘C");
    expect(shortcuts).toContain("⌘V");
    expect(shortcuts).toContain("⌘B");
    expect(shortcuts).toContain("⌘I");
    expect(shortcuts).not.toContain("⌘K");
  });

  it("renders Menu B (No Selection) as a compact menu with Insert submenu", async () => {
    editor.commands.setTextSelection(5);

    const menuState: ContextMenuState = {
      type: "no-selection",
      x: 100,
      y: 100,
      savedSelection: { from: 5, to: 5 },
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    expect(menuEl).not.toBeNull();

    const labels = Array.from(menuEl!.querySelectorAll(".editor-context-menu-label")).map(
      (el) => el.textContent
    );

    expect(labels).toContain("Paste");
    expect(labels).not.toContain("Select All");
    expect(labels).toContain("Undo");
    expect(labels).toContain("Redo");
    expect(labels).toContain("Insert");

    // Must NOT contain text formatting items in no-selection state
    expect(labels).not.toContain("Bold");
    expect(labels).not.toContain("Italic");
  });

  it("disables Undo/Redo buttons when operations are unavailable", async () => {
    const menuState: ContextMenuState = {
      type: "no-selection",
      x: 100,
      y: 100,
      savedSelection: { from: 1, to: 1 },
      canUndo: false,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    const undoBtn = Array.from(menuEl!.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Undo")
    );
    const redoBtn = Array.from(menuEl!.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Redo")
    );

    expect(undoBtn?.disabled).toBe(true);
    expect(redoBtn?.disabled).toBe(true);
  });

  it("dismisses on Escape key", async () => {
    const onClose = vi.fn();
    const menuState: ContextMenuState = {
      type: "no-selection",
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

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={onClose} />
      );
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("dismisses on pointerdown outside menu", async () => {
    const onClose = vi.fn();
    const menuState: ContextMenuState = {
      type: "no-selection",
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

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={onClose} />
      );
    });

    await act(async () => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 500, clientY: 500 })
      );
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("supports keyboard arrow navigation and activating an item with Enter", async () => {
    editor.commands.setTextSelection({ from: 5, to: 16 });
    const copySpy = vi.spyOn(clipboardModule, "copyToClipboard").mockResolvedValue(true);
    const onClose = vi.fn();

    const menuState: ContextMenuState = {
      type: "text-selected",
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

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={onClose} />
      );
    });

    // ArrowDown once -> Cut (index 0)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    // ArrowDown again -> Copy (index 1)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    // Press Enter to activate Copy
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onClose).toHaveBeenCalled();
    expect(copySpy).toHaveBeenCalled();
  });

  it("expands Insert submenu on hover or right arrow", async () => {
    const menuState: ContextMenuState = {
      type: "no-selection",
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

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    const insertBtn = Array.from(menuEl!.querySelectorAll('[role="menuitem"]')).find((el) =>
      el.textContent?.includes("Insert")
    );
    expect(insertBtn).not.toBeUndefined();

    // Hover Insert
    await act(async () => {
      insertBtn?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const submenuEl = document.querySelector(".editor-context-submenu");
    expect(submenuEl).not.toBeNull();

    const subLabels = Array.from(submenuEl!.querySelectorAll(".editor-context-menu-label")).map(
      (el) => el.textContent
    );
    expect(subLabels).toContain("Heading 1");
    expect(subLabels).toContain("Heading 2");
    expect(subLabels).toContain("Bullet List");
    expect(subLabels).toContain("Numbered List");
    expect(subLabels).toContain("Checklist");
    expect(subLabels).toContain("Code Block");
    expect(subLabels).toContain("Divider");
  });

  it("clicking bold in the menu formats text and preserves selection", async () => {
    editor.commands.setTextSelection({ from: 5, to: 16 });

    const menuState: ContextMenuState = {
      type: "text-selected",
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

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    const boldBtn = Array.from(menuEl!.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Bold")
    );
    expect(boldBtn).not.toBeUndefined();

    await act(async () => {
      boldBtn?.click();
    });

    expect(editor.isActive("bold")).toBe(true);
    expect(editor.state.selection.from).toBe(5);
    expect(editor.state.selection.to).toBe(16);
  });

  it("verifies ⌘A (selectAll) continues to select all editor content while absent from no-selection menu", () => {
    editor.commands.selectAll();
    expect(editor.state.selection.from).toBe(0);
    expect(editor.state.selection.to).toBe(editor.state.doc.content.size);
    expect(editor.state.selection.empty).toBe(false);
  });

  it("handles viewport boundary collision and opens submenu to the left near screen right edge", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);
    // Window width is 800, right click is at 750 (near right edge)
    const menuState: ContextMenuState = {
      type: "no-selection",
      x: 750,
      y: 200,
      savedSelection: { from: 1, to: 1 },
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    expect(menuEl).not.toBeNull();

    // Hover Insert to open submenu
    const insertBtn = Array.from(menuEl!.querySelectorAll('[role="menuitem"]')).find((el) =>
      el.textContent?.includes("Insert")
    );
    expect(insertBtn).not.toBeUndefined();

    // Mock parent item and submenu bounding rects for happy-dom collision detection
    vi.spyOn(insertBtn as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 600,
      right: 780,
      top: 250,
      bottom: 278,
      width: 180,
      height: 28,
      x: 600,
      y: 250,
      toJSON: () => {},
    });

    await act(async () => {
      insertBtn?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const submenuEl = document.querySelector(".editor-context-submenu");
    expect(submenuEl).not.toBeNull();
    // With parent right at 780 and window width 800 (spaceOnRight = 10 < 180), submenu must align left
    expect(submenuEl?.classList.contains("align-left")).toBe(true);
  });

  it("renders distinct icons for Bold, Italic, Bullet List, Numbered List, and Task List", async () => {
    editor.commands.setTextSelection({ from: 5, to: 16 });

    const menuState: ContextMenuState = {
      type: "text-selected",
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

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    expect(menuEl).not.toBeNull();

    const items = Array.from(menuEl!.querySelectorAll(".editor-context-menu-item"));
    const labelsWithIcons = items.map((item) => ({
      label: item.querySelector(".editor-context-menu-label")?.textContent,
      hasIcon: item.querySelector(".editor-context-icon, .editor-context-menu-icon") !== null,
    }));

    // Every single item in text-selected menu must have its dedicated icon
    const expected = ["Cut", "Copy", "Paste", "Bold", "Italic", "Bullet List", "Numbered List", "Task List"];
    expected.forEach((expectedLabel) => {
      const entry = labelsWithIcons.find((l) => l.label === expectedLabel);
      expect(entry).not.toBeUndefined();
      expect(entry?.hasIcon).toBe(true);
    });
  });

  it("preserves visible icon column and displays active checkmark separately when formatting is active", async () => {
    editor.commands.setTextSelection({ from: 5, to: 16 });

    const menuState: ContextMenuState = {
      type: "text-selected",
      x: 100,
      y: 100,
      savedSelection: { from: 5, to: 16 },
      canUndo: true,
      canRedo: false,
      isBold: true, // Bold is actively on!
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    const boldItem = Array.from(menuEl!.querySelectorAll(".editor-context-menu-item")).find(
      (item) => item.querySelector(".editor-context-menu-label")?.textContent === "Bold"
    );
    expect(boldItem).not.toBeUndefined();

    // 1. Icon must remain visible on the left side
    const iconEl = boldItem!.querySelector(".editor-context-menu-icon");
    expect(iconEl).not.toBeNull();

    // 2. Active check indicator must be visible on the right side
    const activeCheckEl = boldItem!.querySelector(".editor-context-menu-active-check");
    expect(activeCheckEl).not.toBeNull();
  });

  it("clicking Task List in selected-text menu toggles task list on selected blocks", async () => {
    editor.commands.setTextSelection({ from: 5, to: 16 });

    const menuState: ContextMenuState = {
      type: "text-selected",
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

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    const taskListBtn = Array.from(menuEl!.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Task List")
    );
    expect(taskListBtn).not.toBeUndefined();

    await act(async () => {
      taskListBtn?.click();
    });

    expect(editor.isActive("taskList")).toBe(true);
  });

  it("renders submenu via portal to document.body with z-index 10002 without overlapping parent horizontally", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    const menuState: ContextMenuState = {
      type: "no-selection",
      x: 200,
      y: 200,
      savedSelection: { from: 1, to: 1 },
      canUndo: true,
      canRedo: false,
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };

    await act(async () => {
      root.render(
        <EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />
      );
    });

    const menuEl = document.querySelector(".editor-context-menu");
    const insertBtn = Array.from(menuEl!.querySelectorAll('[role="menuitem"]')).find((el) =>
      el.textContent?.includes("Insert")
    );
    expect(insertBtn).not.toBeUndefined();

    vi.spyOn(insertBtn as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 206,
      right: 386,
      top: 250,
      bottom: 278,
      width: 180,
      height: 28,
      x: 206,
      y: 250,
      toJSON: () => {},
    });

    await act(async () => {
      insertBtn?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const submenuEl = document.querySelector(".editor-context-submenu") as HTMLElement | null;
    expect(submenuEl).not.toBeNull();
    // Submenu portal is direct child of body, not inside .editor-context-menu
    expect(submenuEl?.parentElement).toBe(document.body);
    expect(submenuEl?.style.position).toBe("fixed");
    expect(submenuEl?.style.zIndex).toBe("10002");
    // With parent right at 386 and plenty of space on right (1000 - 386 = 614px), opens to right: 386 + 4 = 390px
    expect(submenuEl?.style.left).toBe("390px");
  });
});
