import { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { blockSelectionPluginKey, deleteSelectedBlocks } from "../extensions/BlockSelection";
import { smartToggleBlockFormat, smartToggleMark } from "./formatMemory";
import { copyToClipboard, readFromClipboard } from "../lib/clipboard";
import { sliceToMarkdown } from "./markdownUtils";
import { openUrl } from "@tauri-apps/plugin-opener";

export type ContextMenuType =
  | "text-selected"
  | "no-selection"
  | "link"
  | "code-block"
  | "checklist"
  | "block-selection";

export interface ContextMenuState {
  type: ContextMenuType;
  x: number;
  y: number;
  savedSelection: { from: number; to: number };
  linkHref?: string;
  codeBlockText?: string;
  codeBlockRange?: { from: number; to: number };
  taskItemPos?: number;
  taskItemChecked?: boolean;
  selectedBlockPositions?: number[];
  canUndo: boolean;
  canRedo: boolean;
  isBold: boolean;
  isItalic: boolean;
  isBulletList: boolean;
  isOrderedList: boolean;
  isTaskList: boolean;
}

/**
 * Resolves the context menu state based on clicked screen coordinates and ProseMirror document state.
 * Respects authoritative ProseMirror selections, resolves coordinates to document positions,
 * and classifies context with strict precedence:
 * 1. Block selection
 * 2. Text selected (if clicked within the active selection)
 * 3. Link context (if clicked on a link mark)
 * 4. Code block context (if clicked inside a code block)
 * 5. Checklist context (if clicked inside a task item)
 * 6. Minimal default no-selection context
 */
export function resolveContextMenuState(
  editor: Editor,
  coords: { x: number; y: number }
): ContextMenuState | null {
  if (!editor || editor.isDestroyed) return null;

  const view = editor.view;
  const state = view.state;
  const doc = state.doc;
  const currentSelection = state.selection;

  // 1. Block Selection check
  const blockState = blockSelectionPluginKey.getState(state);
  if (blockState && blockState.selectedPositions.length > 0) {
    return {
      type: "block-selection",
      x: coords.x,
      y: coords.y,
      savedSelection: { from: currentSelection.from, to: currentSelection.to },
      selectedBlockPositions: blockState.selectedPositions,
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      isBold: false,
      isItalic: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
    };
  }

  // 2. Resolve clicked position from coordinates
  let targetPos: number | null = null;
  const posAt = view.posAtCoords({ left: coords.x, top: coords.y });
  if (posAt) {
    targetPos = posAt.pos;
  } else {
    // Fallback: If clicked outside text boundaries (e.g. bottom or top margin)
    const tiptapDom = view.dom as HTMLElement | null;
    const rect = tiptapDom?.getBoundingClientRect();
    if (rect) {
      if (coords.y < rect.top + 50) {
        targetPos = 0;
      } else if (coords.y > rect.bottom - 20) {
        targetPos = doc.content.size;
      }
    }
    if (targetPos === null) {
      targetPos = currentSelection.from;
    }
  }

  targetPos = Math.max(0, Math.min(targetPos, doc.content.size));

  // 3. Text Selection Handling
  const hasTextSelection = !currentSelection.empty;
  if (hasTextSelection) {
    if (targetPos >= currentSelection.from && targetPos <= currentSelection.to) {
      // Right click inside existing selection: preserve selection!
      return {
        type: "text-selected",
        x: coords.x,
        y: coords.y,
        savedSelection: { from: currentSelection.from, to: currentSelection.to },
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
        isBold: editor.isActive("bold"),
        isItalic: editor.isActive("italic"),
        isBulletList: editor.isActive("bulletList"),
        isOrderedList: editor.isActive("orderedList"),
        isTaskList: editor.isActive("taskList"),
      };
    } else {
      // Clicked outside existing selection: move cursor to clicked position
      const newSel = Selection.near(doc.resolve(targetPos));
      view.dispatch(state.tr.setSelection(newSel));
    }
  } else {
    // Nothing selected: move cursor to clicked position
    if (currentSelection.from !== targetPos) {
      const newSel = Selection.near(doc.resolve(targetPos));
      view.dispatch(state.tr.setSelection(newSel));
    }
  }

  // 4. Context check at active cursor position
  const activePos = view.state.selection.from;
  const $pos = doc.resolve(activePos);

  // Link context
  const linkMark = $pos.marks().find((m) => m.type.name === "link");
  if (linkMark) {
    return {
      type: "link",
      x: coords.x,
      y: coords.y,
      savedSelection: { from: activePos, to: activePos },
      linkHref: linkMark.attrs.href as string,
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      isBold: editor.isActive("bold"),
      isItalic: editor.isActive("italic"),
      isBulletList: editor.isActive("bulletList"),
      isOrderedList: editor.isActive("orderedList"),
      isTaskList: editor.isActive("taskList"),
    };
  }

  // Code Block context
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "codeBlock") {
      const blockStart = $pos.start(d);
      const blockEnd = $pos.end(d);
      return {
        type: "code-block",
        x: coords.x,
        y: coords.y,
        savedSelection: { from: activePos, to: activePos },
        codeBlockText: node.textContent,
        codeBlockRange: { from: blockStart, to: blockEnd },
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
        isBold: false,
        isItalic: false,
        isBulletList: false,
        isOrderedList: false,
        isTaskList: false,
      };
    }
  }

  // Checklist (taskItem) context
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "taskItem") {
      const itemPos = $pos.before(d);
      return {
        type: "checklist",
        x: coords.x,
        y: coords.y,
        savedSelection: { from: activePos, to: activePos },
        taskItemPos: itemPos,
        taskItemChecked: Boolean(node.attrs.checked),
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
        isBold: editor.isActive("bold"),
        isItalic: editor.isActive("italic"),
        isBulletList: false,
        isOrderedList: false,
        isTaskList: true,
      };
    }
  }

  // Default No Selection
  return {
    type: "no-selection",
    x: coords.x,
    y: coords.y,
    savedSelection: { from: activePos, to: activePos },
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    isBold: editor.isActive("bold"),
    isItalic: editor.isActive("italic"),
    isBulletList: editor.isActive("bulletList"),
    isOrderedList: editor.isActive("orderedList"),
    isTaskList: editor.isActive("taskList"),
  };
}

/**
 * Executes a context menu action safely using ProseMirror transactions.
 * Never manipulates the DOM directly and ensures selection restoration if focus changed.
 */
export async function executeContextMenuAction(
  editor: Editor,
  action: string,
  state: ContextMenuState
): Promise<void> {
  if (!editor || editor.isDestroyed) return;

  // Restore selection if text was selected
  if (state.savedSelection && state.savedSelection.from !== state.savedSelection.to) {
    editor.commands.setTextSelection({
      from: state.savedSelection.from,
      to: state.savedSelection.to,
    });
  }

  switch (action) {
    // ── Clipboard operations ─────────────────────────────────
    case "copy": {
      if (state.type === "block-selection") {
        const text = sliceToMarkdown(editor.state.selection.content(), editor);
        await copyToClipboard(text);
      } else {
        const slice = editor.state.selection.content();
        const text = sliceToMarkdown(slice, editor);
        await copyToClipboard(text);
      }
      break;
    }

    case "cut": {
      if (state.type === "block-selection") {
        const text = sliceToMarkdown(editor.state.selection.content(), editor);
        await copyToClipboard(text);
        deleteSelectedBlocks(editor.view);
      } else {
        const slice = editor.state.selection.content();
        const text = sliceToMarkdown(slice, editor);
        await copyToClipboard(text);
        editor.chain().focus().deleteSelection().run();
      }
      break;
    }

    case "paste": {
      const text = await readFromClipboard();
      if (text) {
        editor.chain().focus().insertContent(text).run();
      } else if (typeof document !== "undefined") {
        try {
          document.execCommand("paste");
        } catch {
          // ignore execCommand failure
        }
      }
      break;
    }

    // ── Selection & History ──────────────────────────────────
    case "selectAll": {
      editor.chain().focus().selectAll().run();
      break;
    }

    case "undo": {
      editor.chain().focus().undo().run();
      break;
    }

    case "redo": {
      editor.chain().focus().redo().run();
      break;
    }

    // ── Formatting ───────────────────────────────────────────
    case "bold": {
      smartToggleMark(editor, "bold");
      break;
    }

    case "italic": {
      smartToggleMark(editor, "italic");
      break;
    }

    case "bulletList": {
      smartToggleBlockFormat(editor, "bulletList");
      break;
    }

    case "orderedList": {
      smartToggleBlockFormat(editor, "orderedList");
      break;
    }

    case "taskList": {
      smartToggleBlockFormat(editor, "taskList");
      break;
    }

    case "link": {
      const prevUrl = state.linkHref || (editor.getAttributes("link").href as string) || "";
      const url = window.prompt("Enter URL:", prevUrl);
      if (url === null) return;
      if (url.trim() === "") {
        editor.chain().focus().unsetLink().run();
      } else {
        editor.chain().focus().setLink({ href: url.trim() }).run();
      }
      break;
    }

    case "openLink": {
      const href = state.linkHref || (editor.getAttributes("link").href as string);
      if (href) {
        openUrl(href).catch(() => window.open(href, "_blank"));
      }
      break;
    }

    case "copyLink": {
      const href = state.linkHref || (editor.getAttributes("link").href as string);
      if (href) {
        await copyToClipboard(href);
      }
      break;
    }

    case "removeLink": {
      editor.chain().focus().unsetLink().run();
      break;
    }

    // ── Block Insertions ─────────────────────────────────────
    case "insertHeading1": {
      editor.chain().focus().setNode("heading", { level: 1 }).run();
      break;
    }

    case "insertHeading2": {
      editor.chain().focus().setNode("heading", { level: 2 }).run();
      break;
    }

    case "insertBulletList": {
      editor.chain().focus().toggleBulletList().run();
      break;
    }

    case "insertOrderedList": {
      editor.chain().focus().toggleOrderedList().run();
      break;
    }

    case "insertChecklist": {
      editor.chain().focus().toggleTaskList().run();
      break;
    }

    case "insertCodeBlock": {
      editor.chain().focus().toggleCodeBlock().run();
      break;
    }

    case "insertDivider": {
      editor.chain().focus().setHorizontalRule().run();
      break;
    }

    // ── Code Block Special ───────────────────────────────────
    case "copyCode": {
      if (state.codeBlockText) {
        await copyToClipboard(state.codeBlockText);
      }
      break;
    }

    case "selectCode": {
      if (state.codeBlockRange) {
        editor
          .chain()
          .focus()
          .setTextSelection({
            from: state.codeBlockRange.from,
            to: state.codeBlockRange.to,
          })
          .run();
      }
      break;
    }

    // ── Checklist Special ────────────────────────────────────
    case "toggleTaskItem": {
      if (state.taskItemPos !== undefined) {
        const { state: pState, dispatch } = editor.view;
        const node = pState.doc.nodeAt(state.taskItemPos);
        if (node) {
          dispatch(
            pState.tr.setNodeMarkup(state.taskItemPos, undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            })
          );
        }
      }
      break;
    }

    case "insertTaskItem": {
      editor.chain().focus().splitListItem("taskItem").run();
      break;
    }

    // ── Block Selection Special ──────────────────────────────
    case "deleteBlocks": {
      deleteSelectedBlocks(editor.view);
      break;
    }

    case "clearBlockSelection": {
      editor.commands.clearBlockSelection?.();
      break;
    }

    default:
      console.warn("[context-menu] Unknown action:", action);
  }
}

