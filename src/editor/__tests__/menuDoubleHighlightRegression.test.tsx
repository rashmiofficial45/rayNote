// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef, act } from "react";
import { createRoot, Root } from "react-dom/client";
import { CommandList, CommandListRef, ALL_COMMAND_ITEMS } from "../SlashCommand";
import { EditorContextMenu } from "../EditorContextMenu";
import { ContextMenuState } from "../contextMenuUtils";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

describe("Menu Unification & Double-Highlight Prevention Regression Suite", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  describe("Slash-Command Menu", () => {
    it("ensures only ONE option has .is-selected after ArrowDown and ArrowUp", async () => {
      const onCommand = vi.fn();
      const ref = createRef<CommandListRef>();

      await act(async () => {
        root.render(<CommandList ref={ref} items={ALL_COMMAND_ITEMS} command={onCommand} />);
      });

      // Initially item 0 has .is-selected
      let selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Heading 1");

      // Navigate down to item 1
      await act(async () => {
        ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
      });

      selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Heading 2");

      // Navigate down to item 2
      await act(async () => {
        ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
      });

      selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Heading 3");

      // Navigate up to item 1
      await act(async () => {
        ref.current?.onKeyDown({ event: { key: "ArrowUp" } as KeyboardEvent });
      });

      selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Heading 2");
    });

    it("stationary pointer over another item does NOT hijack selection during keyboard navigation", async () => {
      const onCommand = vi.fn();
      const ref = createRef<CommandListRef>();

      await act(async () => {
        root.render(<CommandList ref={ref} items={ALL_COMMAND_ITEMS} command={onCommand} />);
      });

      const items = host.querySelectorAll(".slash-command-item");
      const item3 = items[3]; // Task List

      // Mouse rests at (150, 200) over item 3 (Task List)
      await act(async () => {
        item3.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150, clientY: 200 }));
      });

      let selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Task List");

      // Now user presses ArrowDown (keyboard navigation advances from Task List to Bullet List)
      await act(async () => {
        ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
      });

      // Item 4 (Bullet List) must now be the ONLY selected item
      selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Bullet List");

      // Mouse emits a stationary mousemove event over item 3 with identical coordinates (150, 200)
      await act(async () => {
        item3.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150, clientY: 200 }));
      });

      // Item 3 must NOT have hijacked selection; Bullet List remains the sole selected item
      selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Bullet List");

      // When the mouse pointer genuinely moves (dx > 2, dy > 2) to item 1 (Heading 2)
      const item1 = items[1];
      await act(async () => {
        item1.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 180, clientY: 260 }));
      });

      selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Heading 2");
    });

    it("displays slash badges like /todo, /h1 matching compact context menu shortcut styling", async () => {
      const onCommand = vi.fn();
      const ref = createRef<CommandListRef>();

      await act(async () => {
        root.render(<CommandList ref={ref} items={ALL_COMMAND_ITEMS} command={onCommand} />);
      });

      const rows = host.querySelectorAll(".slash-command-item");
      expect(rows.length).toBe(ALL_COMMAND_ITEMS.length);

      const taskRow = Array.from(rows).find((r) =>
        r.querySelector(".slash-command-item-title")?.textContent === "Task List"
      );
      expect(taskRow).not.toBeUndefined();
      const taskBadge = taskRow?.querySelector(".slash-command-item-badge");
      expect(taskBadge?.textContent).toBe("/todo");

      const h1Row = Array.from(rows).find((r) =>
        r.querySelector(".slash-command-item-title")?.textContent === "Heading 1"
      );
      expect(h1Row?.querySelector(".slash-command-item-badge")?.textContent).toBe("/h1");
    });
  });

  describe("Editor Context Menu", () => {
    let editor: Editor;

    beforeEach(() => {
      editor = new Editor({
        extensions: [StarterKit],
        content: "<p>Sample text for context menu testing</p>",
      });
    });

    afterEach(() => {
      editor.destroy();
    });

    it("keeps checklist completion and Select All without any insert options", async () => {
      const menuState: ContextMenuState = {
        type: "checklist",
        x: 100,
        y: 100,
        savedSelection: { from: 1, to: 1 },
        canUndo: true,
        canRedo: true,
        isBold: false,
        isItalic: false,
        isBulletList: false,
        isOrderedList: false,
        isTaskList: true,
      };

      await act(async () => {
        root.render(<EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />);
      });

      const menu = document.querySelector(".editor-context-menu")!;
      expect(menu.textContent).toContain("Mark Completed");
      expect(menu.textContent).not.toContain("Insert");
      expect(menu.querySelector('[data-menu-item-id="selectAll"] svg')).not.toBeNull();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });
      const highlighted = menu.querySelectorAll(".is-highlighted");
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0].textContent).toContain("Select All");
    });

    it("stationary pointer does NOT cause dual highlight in context menu", async () => {
      const menuState: ContextMenuState = {
        type: "no-selection",
        x: 100,
        y: 100,
        savedSelection: { from: 1, to: 1 },
        canUndo: true,
        canRedo: true,
        isBold: false,
        isItalic: false,
        isBulletList: false,
        isOrderedList: false,
        isTaskList: false,
      };

      await act(async () => {
        root.render(<EditorContextMenu editor={editor} menuState={menuState} onClose={() => {}} />);
      });

      const undoItem = document.querySelector('[data-menu-item-id="undo"]')!;
      expect(document.querySelector('[data-menu-item-id="selectAll"]')?.textContent).toContain("Select All");

      // Mouse rests over Undo at (120, 140)
      await act(async () => {
        undoItem.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 120, clientY: 140 }));
      });

      // User presses ArrowDown (keyboard navigation)
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });

      // Redo should be the sole highlighted item
      let highlighted = document.querySelectorAll(".editor-context-menu-item.is-highlighted");
      expect(highlighted.length).toBe(1);
      expect(highlighted[0].textContent).toContain("Redo");

      // A stationary mouse event over Undo must NOT hijack selection
      await act(async () => {
        undoItem.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 120, clientY: 140 }));
      });

      highlighted = document.querySelectorAll(".editor-context-menu-item.is-highlighted");
      expect(highlighted.length).toBe(1);
      expect(highlighted[0].textContent).toContain("Redo");
    });
  });
});
