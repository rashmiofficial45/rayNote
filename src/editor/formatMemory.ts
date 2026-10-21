import { Extension } from "@tiptap/core";
import { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { blockSelectionPluginKey } from "../extensions/BlockSelection";

export type FormatKind =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "paragraph";

export type MarkKind = "bold" | "italic" | "underline" | "strike" | "highlight";

/**
 * Global attribute extension allowing nodes to store their previous formatting block type.
 * When a user formats an ordered list as Heading 1, the heading remembers it was an ordered list.
 * Toggling off Heading 1 returns to the ordered list instead of dropping to an unformatted paragraph.
 */
export const FormatMemoryExtension = Extension.create({
  name: "formatMemory",

  addGlobalAttributes() {
    return [
      {
        types: [
          "heading",
          "paragraph",
          "blockquote",
          "codeBlock",
          "listItem",
          "taskItem",
        ],
        attributes: {
          prevBlockFormat: {
            default: null,
            keepOnSplit: false,
            rendered: false,
            parseHTML: (element) => element.getAttribute("data-prev-block-format"),
            renderHTML: (attributes) => {
              if (!attributes.prevBlockFormat) return {};
              return { "data-prev-block-format": attributes.prevBlockFormat };
            },
          },
        },
      },
    ];
  },
});

// In-memory fallback map tracking previous format per block position / key
const fallbackFormatMemory = new Map<string, FormatKind>();

export function getBlockMemoryKey(editor: Editor): string {
  const { state } = editor;
  const { $from } = state.selection;
  return `block_${$from.start()}_${$from.depth}`;
}

export function getCurrentFormatKind(editor: Editor): FormatKind {
  if (editor.isActive("heading", { level: 1 })) return "heading1";
  if (editor.isActive("heading", { level: 2 })) return "heading2";
  if (editor.isActive("heading", { level: 3 })) return "heading3";
  if (editor.isActive("orderedList")) return "orderedList";
  if (editor.isActive("bulletList")) return "bulletList";
  if (editor.isActive("taskList")) return "taskList";
  if (editor.isActive("blockquote")) return "blockquote";
  if (editor.isActive("codeBlock")) return "codeBlock";
  return "paragraph";
}

export function isFormatActive(editor: Editor, format: FormatKind): boolean {
  switch (format) {
    case "heading1":
      return editor.isActive("heading", { level: 1 });
    case "heading2":
      return editor.isActive("heading", { level: 2 });
    case "heading3":
      return editor.isActive("heading", { level: 3 });
    case "orderedList":
      return editor.isActive("orderedList");
    case "bulletList":
      return editor.isActive("bulletList");
    case "taskList":
      return editor.isActive("taskList");
    case "blockquote":
      return editor.isActive("blockquote");
    case "codeBlock":
      return editor.isActive("codeBlock");
    case "paragraph":
      return editor.isActive("paragraph");
    default:
      return false;
  }
}

/**
 * Restores a specific block format on the current selection.
 */
function restoreFormat(editor: Editor, format: FormatKind) {
  switch (format) {
    case "orderedList":
      return editor.chain().focus().setParagraph().toggleOrderedList().run();
    case "bulletList":
      return editor.chain().focus().setParagraph().toggleBulletList().run();
    case "taskList":
      return editor.chain().focus().setParagraph().toggleTaskList().run();
    case "blockquote":
      return editor.chain().focus().setParagraph().toggleBlockquote().run();
    case "codeBlock":
      return editor.chain().focus().setParagraph().toggleCodeBlock().run();
    case "heading1":
      return editor.chain().focus().setParagraph().toggleHeading({ level: 1 }).run();
    case "heading2":
      return editor.chain().focus().setParagraph().toggleHeading({ level: 2 }).run();
    case "heading3":
      return editor.chain().focus().setParagraph().toggleHeading({ level: 3 }).run();
    case "paragraph":
    default:
      return editor.chain().focus().setParagraph().run();
  }
}

/**
 * Toggles a block format with memory:
 * If the target format is currently active, toggling it off restores the node's prior format
 * (e.g. ordered list, bullet list, task list, quote) rather than resetting to a bare paragraph.
 */
export function smartToggleBlockFormat(editor: Editor, target: FormatKind): boolean {
  const { state } = editor;

  // ── Block selection mode support ──
  const blockState = blockSelectionPluginKey.getState(state);
  const isBlockMode = Boolean(blockState && blockState.selectedPositions.length > 0);

  if (isBlockMode && blockState) {
    // Sync selection to first block position so tiptap block commands target it
    const firstPos = blockState.selectedPositions[0];
    const $pos = state.doc.resolve(Math.min(firstPos + 1, state.doc.content.size));
    editor.view.dispatch(state.tr.setSelection(TextSelection.near($pos)));
  }

  const currentlyActive = isFormatActive(editor, target);
  const memKey = getBlockMemoryKey(editor);

  if (currentlyActive) {
    // Toggling OFF: Check if we have previous format memory
    let prev: FormatKind | null = null;

    // Check node attributes first
    if (target.startsWith("heading")) {
      prev = (editor.getAttributes("heading").prevBlockFormat as FormatKind) || null;
    } else if (target === "blockquote") {
      prev = (editor.getAttributes("blockquote").prevBlockFormat as FormatKind) || null;
    } else if (target === "codeBlock") {
      prev = (editor.getAttributes("codeBlock").prevBlockFormat as FormatKind) || null;
    } else if (target === "bulletList") {
      prev = (editor.getAttributes("listItem").prevBlockFormat as FormatKind) || null;
    } else if (target === "taskList") {
      prev = (editor.getAttributes("taskItem").prevBlockFormat as FormatKind) || null;
    } else if (target === "orderedList") {
      prev = (editor.getAttributes("listItem").prevBlockFormat as FormatKind) || null;
    }

    if (!prev) {
      prev = fallbackFormatMemory.get(memKey) || null;
    }

    fallbackFormatMemory.delete(memKey);

    if (prev && prev !== target && prev !== "paragraph") {
      return restoreFormat(editor, prev);
    }

    // Default off behavior (convert to paragraph)
    return editor.chain().focus().setParagraph().run();
  }

  // Toggling ON: Remember existing block formatting before changing
  const currentFormat = getCurrentFormatKind(editor);
  if (currentFormat !== "paragraph" && currentFormat !== target) {
    fallbackFormatMemory.set(memKey, currentFormat);
  }

  // Apply new format and store attribute
  let success = false;
  switch (target) {
    case "heading1":
      success = editor.chain().focus().toggleHeading({ level: 1 }).run();
      if (currentFormat !== "paragraph") {
        editor.chain().updateAttributes("heading", { prevBlockFormat: currentFormat }).run();
      }
      break;
    case "heading2":
      success = editor.chain().focus().toggleHeading({ level: 2 }).run();
      if (currentFormat !== "paragraph") {
        editor.chain().updateAttributes("heading", { prevBlockFormat: currentFormat }).run();
      }
      break;
    case "heading3":
      success = editor.chain().focus().toggleHeading({ level: 3 }).run();
      if (currentFormat !== "paragraph") {
        editor.chain().updateAttributes("heading", { prevBlockFormat: currentFormat }).run();
      }
      break;
    case "orderedList":
      success = editor.chain().focus().toggleOrderedList().run();
      if (currentFormat !== "paragraph") {
        editor.chain().updateAttributes("listItem", { prevBlockFormat: currentFormat }).run();
      }
      break;
    case "bulletList":
      success = editor.chain().focus().toggleBulletList().run();
      if (currentFormat !== "paragraph") {
        editor.chain().updateAttributes("listItem", { prevBlockFormat: currentFormat }).run();
      }
      break;
    case "taskList":
      success = editor.chain().focus().toggleTaskList().run();
      if (currentFormat !== "paragraph") {
        editor.chain().updateAttributes("taskItem", { prevBlockFormat: currentFormat }).run();
      }
      break;
    case "blockquote":
      if (editor.isActive("listItem") || editor.isActive("taskItem")) {
        success = editor.chain().focus().setParagraph().toggleBlockquote().run();
      } else {
        success = editor.chain().focus().toggleBlockquote().run();
      }
      if (currentFormat !== "paragraph") {
        editor.chain().updateAttributes("blockquote", { prevBlockFormat: currentFormat }).run();
      }
      break;
    case "codeBlock":
      success = editor.chain().focus().toggleCodeBlock().run();
      if (currentFormat !== "paragraph") {
        editor.chain().updateAttributes("codeBlock", { prevBlockFormat: currentFormat }).run();
      }
      break;
    case "paragraph":
      success = editor.chain().focus().setParagraph().run();
      break;
  }

  return success;
}

/**
 * Toggles an inline mark (bold, italic, underline, strike, highlight) cleanly.
 * If block selection is active, applies or removes the mark across all text nodes
 * in the selected blocks without altering block or list container hierarchy.
 */
export function smartToggleMark(editor: Editor, markType: MarkKind): boolean {
  const { state, view } = editor;
  const blockState = blockSelectionPluginKey.getState(state);

  if (!blockState || blockState.selectedPositions.length === 0) {
    // Standard inline mark toggle
    switch (markType) {
      case "bold":
        return editor.chain().focus().toggleBold().run();
      case "italic":
        return editor.chain().focus().toggleItalic().run();
      case "underline":
        return (editor.chain().focus() as any).toggleUnderline().run();
      case "strike":
        return editor.chain().focus().toggleStrike().run();
      case "highlight":
        return editor.chain().focus().toggleHighlight().run();
    }
  }

  // ── Block selection mode ──
  const pmMarkType = state.schema.marks[markType];
  if (!pmMarkType) return false;

  let hasMarkAll = true;
  let hasAnyText = false;
  const textRanges: { from: number; to: number }[] = [];

  for (const blockPos of blockState.selectedPositions) {
    const node = state.doc.nodeAt(blockPos);
    if (!node) continue;
    node.nodesBetween(0, node.content.size, (child, posInNode) => {
      if (child.isText && child.text) {
        hasAnyText = true;
        const from = blockPos + 1 + posInNode;
        const to = from + child.nodeSize;
        textRanges.push({ from, to });
        const has = child.marks.some((m) => m.type.name === markType);
        if (!has) {
          hasMarkAll = false;
        }
      }
    });
  }

  if (!hasAnyText) return false;

  let tr = state.tr;
  for (const range of textRanges) {
    if (hasMarkAll) {
      tr = tr.removeMark(range.from, range.to, pmMarkType);
    } else {
      tr = tr.addMark(range.from, range.to, pmMarkType.create());
    }
  }

  view.dispatch(tr);
  return true;
}
