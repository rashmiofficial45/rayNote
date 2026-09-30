import { Node, InputRule } from "@tiptap/react";
import { TextSelection, EditorState, Transaction } from "@tiptap/pm/state";

/**
 * Smart Horizontal Rule insertion:
 * If the user types '---' in a checklist (taskItem), list (listItem), blockquote,
 * or any other formatted block, it cleanly creates the <hr> ABOVE the specific format,
 * splitting or lifting the format so nothing breaks and editing remains super smooth.
 */
export function insertHorizontalRuleSmart(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  matchedRange?: { from: number; to: number }
): boolean {
  const { schema, tr, selection } = state;
  const { $from } = selection;
  const hrType = schema.nodes.horizontalRule;
  if (!hrType) return false;

  const hrNode = hrType.create();

  // Find if we are inside a taskItem, listItem, or blockquote
  let targetDepth = -1;
  let containerDepth = -1;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    const name = node.type.name;
    if (name === "taskItem" || name === "listItem") {
      targetDepth = d;
      containerDepth = d - 1;
      break;
    }
    if (name === "blockquote") {
      targetDepth = d;
      containerDepth = d - 1;
      break;
    }
  }

  // ── 1. Inside a Checklist (taskItem) or List (listItem) or Blockquote ──
  if (targetDepth > 0 && containerDepth >= 0) {
    const itemIndex = $from.index(containerDepth);
    const containerBeforePos = $from.before(containerDepth);
    const itemBeforePos = $from.before(targetDepth);

    // Delete the '---' text in the current text block
    if (matchedRange) {
      tr.delete(matchedRange.from, matchedRange.to);
    } else {
      const blockStart = $from.start($from.depth);
      const blockEnd = $from.end($from.depth);
      tr.delete(blockStart, blockEnd);
    }

    // Case A: First item in the checklist or list
    // Insert the <hr> directly ABOVE the entire list/container!
    if (itemIndex === 0) {
      tr.insert(containerBeforePos, hrNode);

      // Cursor remains in the clean first item below the <hr>
      const mappedTarget = tr.mapping.map($from.start(targetDepth));
      const $resolved = tr.doc.resolve(Math.min(mappedTarget, tr.doc.content.size));
      tr.setSelection(TextSelection.near($resolved));

      if (dispatch) dispatch(tr.scrollIntoView());
      return true;
    }

    // Case B: Middle or last item in the checklist or list
    // Split the list/container right before this item and place <hr> between them!
    const mappedItemBefore = tr.mapping.map(itemBeforePos);

    try {
      tr.split(mappedItemBefore, 1);
      tr.insert(mappedItemBefore, hrNode);

      // Place selection in the clean item right below the <hr>
      const secondContainerStart = mappedItemBefore + hrNode.nodeSize;
      const targetPos = Math.min(secondContainerStart + 2, tr.doc.content.size);
      const $secondPos = tr.doc.resolve(targetPos);
      tr.setSelection(TextSelection.near($secondPos));
    } catch {
      // Fallback: insert directly above container
      tr.insert(containerBeforePos, hrNode);
      const $resolved = tr.doc.resolve(tr.mapping.map($from.start(targetDepth)));
      tr.setSelection(TextSelection.near($resolved));
    }

    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  }

  // ── 2. Inside a Heading ──
  const blockDepth = $from.depth;
  const blockNode = $from.node(blockDepth);
  const blockBefore = $from.before(blockDepth);
  const blockAfter = $from.after(blockDepth);

  if (blockNode.type.name === "heading") {
    // Title Heading (H1 at document top): preserve schema requirement "heading block*"
    if (blockNode.attrs.level === 1 && blockBefore === 0) {
      if (matchedRange) {
        tr.delete(matchedRange.from, matchedRange.to);
      } else {
        tr.delete($from.start(blockDepth), $from.end(blockDepth));
      }
      tr.insert(blockAfter, hrNode);
      const defaultType = schema.nodes.paragraph || schema.topNodeType.contentMatch.defaultType;
      if (defaultType) {
        const newPara = defaultType.create();
        tr.insert(blockAfter + hrNode.nodeSize, newPara);
        const $target = tr.doc.resolve(blockAfter + hrNode.nodeSize + 1);
        tr.setSelection(TextSelection.near($target));
      }
      if (dispatch) dispatch(tr.scrollIntoView());
      return true;
    }

    // Other headings (H2, H3): insert HR directly ABOVE heading
    if (matchedRange) {
      tr.delete(matchedRange.from, matchedRange.to);
    } else {
      tr.delete($from.start(blockDepth), $from.end(blockDepth));
    }
    tr.insert(blockBefore, hrNode);
    const $mapped = tr.doc.resolve(tr.mapping.map($from.start(blockDepth)));
    tr.setSelection(TextSelection.near($mapped));
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  }

  // ── 3. Top-Level Paragraph ──
  // Replace current paragraph with <hr> and append a clean paragraph below
  tr.replaceRangeWith(blockBefore, blockAfter, hrNode);
  const defaultType = schema.nodes.paragraph || schema.topNodeType.contentMatch.defaultType;
  if (defaultType) {
    const newPara = defaultType.create();
    const insertPos = blockBefore + hrNode.nodeSize;
    tr.insert(insertPos, newPara);
    const $target = tr.doc.resolve(insertPos + 1);
    tr.setSelection(TextSelection.near($target));
  }

  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

export const HorizontalRuleExtension = Node.create({
  name: "horizontalRule",
  group: "block",

  parseHTML() {
    return [{ tag: "hr" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["hr", HTMLAttributes];
  },

  addCommands() {
    return {
      setHorizontalRule:
        () =>
        ({ state, dispatch }) => {
          return insertHorizontalRuleSmart(state, dispatch);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt--": () => this.editor.commands.setHorizontalRule(),
      "Mod-Shift--": () => this.editor.commands.setHorizontalRule(),
      "Mod-_": () => this.editor.commands.setHorizontalRule(),
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        const text = $from.parent.textContent.trim();
        // If current line content is exactly three dashes or similar dividers
        if (
          text === "---" ||
          text === "—-" ||
          text === "——" ||
          text === "—" ||
          text === "***" ||
          text === "___" ||
          text === "- - -" ||
          text === "* * *"
        ) {
          return insertHorizontalRuleSmart(state, editor.view.dispatch);
        }
        return false;
      },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^(?:---|—-|——|—|___|\*\*\*|- - -|\* \* \*)\s?$/,
        handler: ({ state, range }) => {
          insertHorizontalRuleSmart(state, this.editor.view.dispatch, range);
        },
      }),
    ];
  },
});
