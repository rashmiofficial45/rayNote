import { Extension } from "@tiptap/react";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { joinBackward } from "@tiptap/pm/commands";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import "@tiptap/extension-underline";
import {
  blockSelectionPluginKey,
  deleteSelectedBlocks,
  getAllBlocks,
  findBlockAtPos,
} from "../extensions/BlockSelection";
import { smartToggleBlockFormat, smartToggleMark } from "./formatMemory";
import { toggleDictation } from "../lib/dictation";

export const ShortcutsExtension = Extension.create({
  name: "shortcutsExtension",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      // Headings
      "Mod-Alt-1": () => smartToggleBlockFormat(this.editor, "heading1"),
      "Mod-Shift-1": () => smartToggleBlockFormat(this.editor, "heading1"),
      "Mod-Alt-2": () => smartToggleBlockFormat(this.editor, "heading2"),
      "Mod-Shift-2": () => smartToggleBlockFormat(this.editor, "heading2"),
      "Mod-Alt-3": () => smartToggleBlockFormat(this.editor, "heading3"),
      "Mod-Shift-3": () => smartToggleBlockFormat(this.editor, "heading3"),
      "Mod-Alt-0": () => this.editor.commands.setParagraph(),
      "Mod-Shift-0": () => this.editor.commands.setParagraph(),

      // Lists & Tasks
      "Mod-Shift-8": () => smartToggleBlockFormat(this.editor, "bulletList"),
      "Mod-Alt-8": () => smartToggleBlockFormat(this.editor, "bulletList"),
      "Mod-Shift-7": () => smartToggleBlockFormat(this.editor, "orderedList"),
      "Mod-Alt-7": () => smartToggleBlockFormat(this.editor, "orderedList"),
      "Mod-Shift-9": () => smartToggleBlockFormat(this.editor, "taskList"),
      "Mod-Alt-9": () => smartToggleBlockFormat(this.editor, "taskList"),
      "Mod-Shift-t": () => smartToggleBlockFormat(this.editor, "taskList"),
      "Mod-Shift-T": () => smartToggleBlockFormat(this.editor, "taskList"),

      // Formatting
      "Mod-b": () => smartToggleMark(this.editor, "bold"),
      "Mod-B": () => smartToggleMark(this.editor, "bold"),
      "Mod-i": () => smartToggleMark(this.editor, "italic"),
      "Mod-I": () => smartToggleMark(this.editor, "italic"),
      "Mod-u": () => smartToggleMark(this.editor, "underline"),
      "Mod-U": () => smartToggleMark(this.editor, "underline"),
      "Mod-Shift-x": () => smartToggleMark(this.editor, "strike"),
      "Mod-Shift-X": () => smartToggleMark(this.editor, "strike"),
      "Mod-Shift-s": () => smartToggleMark(this.editor, "strike"),
      "Mod-Shift-S": () => smartToggleMark(this.editor, "strike"),
      "Mod-e": () => this.editor.commands.toggleCode(),
      "Mod-E": () => this.editor.commands.toggleCode(),
      "Mod-Shift-h": () => smartToggleMark(this.editor, "highlight"),
      "Mod-Shift-H": () => smartToggleMark(this.editor, "highlight"),
      "Mod-Shift-b": () => smartToggleBlockFormat(this.editor, "blockquote"),
      "Mod-Shift-B": () => smartToggleBlockFormat(this.editor, "blockquote"),
      "Mod-Shift-.": () => smartToggleBlockFormat(this.editor, "blockquote"),
      "Mod-Alt-.": () => smartToggleBlockFormat(this.editor, "blockquote"),
      "Mod-Alt-c": () => smartToggleBlockFormat(this.editor, "codeBlock"),
      "Mod-Shift-c": () => smartToggleBlockFormat(this.editor, "codeBlock"),
      "Mod-Shift-C": () => smartToggleBlockFormat(this.editor, "codeBlock"),
      "Mod-Alt--": () => this.editor.commands.setHorizontalRule(),
      "Mod-Shift--": () => this.editor.commands.setHorizontalRule(),
      "Mod-_": () => this.editor.commands.setHorizontalRule(),

      // Links: ⌘L or ⇧⌘K
      "Mod-l": () => {
        const previousUrl = this.editor.getAttributes("link").href;
        const url = window.prompt("Enter URL:", previousUrl || "");
        if (url === null) return true;
        if (url.trim() === "") {
          this.editor.chain().focus().unsetLink().run();
        } else {
          this.editor.chain().focus().setLink({ href: url.trim() }).run();
        }
        return true;
      },
      "Mod-Shift-k": () => {
        const previousUrl = this.editor.getAttributes("link").href;
        const url = window.prompt("Enter URL:", previousUrl || "");
        if (url === null) return true;
        if (url.trim() === "") {
          this.editor.chain().focus().unsetLink().run();
        } else {
          this.editor.chain().focus().setLink({ href: url.trim() }).run();
        }
        return true;
      },

      // Voice Dictation: ⌥D or ⌘⌥D
      "Alt-d": () => {
        toggleDictation(this.editor);
        return true;
      },
      "Mod-Alt-d": () => {
        toggleDictation(this.editor);
        return true;
      },

      // Mod-Enter: exit code block or toggle TaskItem checkbox
      "Mod-Enter": () => {
        if (this.editor.isActive("codeBlock")) {
          return this.editor.commands.exitCode();
        }
        if (this.editor.isActive("taskItem")) {
          const { state, dispatch } = this.editor.view;
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === "taskItem") {
              const pos = $from.before(d);
              dispatch(
                state.tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  checked: !node.attrs.checked,
                })
              );
              return true;
            }
          }
        }
        return false;
      },
      "Shift-Enter": () => {
        if (this.editor.isActive("codeBlock")) {
          return this.editor.commands.exitCode();
        }
        return false;
      },
      "Alt-Enter": () => {
        if (this.editor.isActive("taskItem")) {
          const { state, dispatch } = this.editor.view;
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === "taskItem") {
              const pos = $from.before(d);
              dispatch(
                state.tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  checked: !node.attrs.checked,
                })
              );
              return true;
            }
          }
        }
        return false;
      },

      // Tab and Shift-Tab handling
      Tab: () => {
        if (this.editor.isActive("taskItem")) {
          return this.editor.commands.sinkListItem("taskItem");
        }
        if (this.editor.isActive("listItem")) {
          return this.editor.commands.sinkListItem("listItem");
        }
        if (this.editor.isActive("codeBlock")) {
          const { state } = this.editor;
          const { selection } = state;
          const { from, to, empty } = selection;
          if (empty) {
            return this.editor.commands.insertContent("  ");
          }
          return this.editor.commands.command(({ tr }) => {
            const text = state.doc.textBetween(from, to, "\n", "\n");
            const lines = text.split("\n");
            const indented = lines.map((line) => "  " + line).join("\n");
            tr.replaceWith(from, to, state.schema.text(indented));
            return true;
          });
        }
        return false;
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("taskItem")) {
          return this.editor.commands.liftListItem("taskItem");
        }
        if (this.editor.isActive("listItem")) {
          return this.editor.commands.liftListItem("listItem");
        }
        if (this.editor.isActive("codeBlock")) {
          const { state } = this.editor;
          const { selection } = state;
          const { $from, from, to, empty } = selection;
          if (empty) {
            return this.editor.commands.command(({ tr }) => {
              const codeBlockStart = $from.start();
              const pos = $from.pos;
              const textBefore = state.doc.textBetween(codeBlockStart, pos, "\n", "\n");
              const lineStartIdx = textBefore.lastIndexOf("\n") + 1;
              const lineStartPos = codeBlockStart + lineStartIdx;
              const lineText = state.doc.textBetween(lineStartPos, pos, "\n", "\n");
              const leadingSpaces = lineText.match(/^ +/)?.[0] || "";
              const removeCount = Math.min(leadingSpaces.length, 2);
              if (removeCount > 0) {
                tr.delete(lineStartPos, lineStartPos + removeCount);
                return true;
              }
              return false;
            });
          }
          return this.editor.commands.command(({ tr }) => {
            const text = state.doc.textBetween(from, to, "\n", "\n");
            const lines = text.split("\n");
            const unindented = lines.map((line) => line.replace(/^ {1,2}/, "")).join("\n");
            tr.replaceWith(from, to, state.schema.text(unindented));
            return true;
          });
        }
        return false;
      },

      // Backspace: clear formatting at start of block or delete selected block(s) on ONE backspace
      Backspace: () => {
        const { state, dispatch } = this.editor.view;

        // ── 0. If in block selection mode, delete the selected block(s) completely on ONE backspace! ──
        const blockState = blockSelectionPluginKey.getState(state);
        if (blockState && blockState.selectedPositions.length > 0) {
          return deleteSelectedBlocks(this.editor.view);
        }

        const { selection } = state;
        if (!selection.empty) return false;

        const { $from } = selection;

        // Only handle when cursor is at the very beginning of the block content
        if ($from.parentOffset !== 0) return false;

        // 1. TaskItem: lift out or convert single item to paragraph
        if (this.editor.isActive("taskItem")) {
          if ($from.parent.textContent.length === 0) {
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (node.type.name === "taskList" && node.childCount === 1) {
                const listPos = $from.before(d);
                const tr = state.tr.replaceWith(
                  listPos,
                  listPos + node.nodeSize,
                  state.schema.nodes.paragraph.create()
                );
                tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
                dispatch(tr);
                return true;
              }
            }
          }
          if (this.editor.commands.liftListItem("taskItem")) return true;
          return this.editor.commands.toggleTaskList() || this.editor.commands.setParagraph();
        }

        // 2. ListItem: lift out or convert single item to paragraph
        if (this.editor.isActive("listItem")) {
          if ($from.parent.textContent.length === 0) {
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (
                (node.type.name === "bulletList" || node.type.name === "orderedList") &&
                node.childCount === 1
              ) {
                const listPos = $from.before(d);
                const tr = state.tr.replaceWith(
                  listPos,
                  listPos + node.nodeSize,
                  state.schema.nodes.paragraph.create()
                );
                tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
                dispatch(tr);
                return true;
              }
            }
          }
          if (this.editor.commands.liftListItem("listItem")) return true;
          return (
            this.editor.commands.toggleBulletList() ||
            this.editor.commands.toggleOrderedList() ||
            this.editor.commands.setParagraph()
          );
        }

        // 3. Heading: convert to normal paragraph
        if (this.editor.isActive("heading")) {
          return this.editor.commands.setParagraph();
        }

        // 4. Blockquote: toggle off to normal paragraph
        if (this.editor.isActive("blockquote")) {
          return this.editor.commands.toggleBlockquote();
        }

        // 5. CodeBlock: if empty, convert to normal paragraph
        if (this.editor.isActive("codeBlock")) {
          if ($from.parent.textContent.length === 0) {
            return this.editor.commands.setParagraph();
          }
        }

        // 6. Empty paragraph directly following a list container: delete the empty paragraph
        if ($from.parent.type.name === "paragraph" && $from.parent.textContent.length === 0) {
          const beforePos = $from.before();
          if (beforePos > 0) {
            const $before = state.doc.resolve(beforePos);
            const nodeBefore = $before.nodeBefore;
            if (
              nodeBefore &&
              (nodeBefore.type.name === "bulletList" ||
                nodeBefore.type.name === "orderedList" ||
                nodeBefore.type.name === "taskList")
            ) {
              let tr = state.tr.delete($from.before(), $from.after());
              const newTargetPos = beforePos - 1;
              try {
                tr = tr.setSelection(Selection.near(tr.doc.resolve(newTargetPos), -1));
              } catch {
                tr = tr.setSelection(TextSelection.create(tr.doc, Math.max(1, newTargetPos)));
              }
              dispatch(tr);
              return true;
            }
          }
        }

        return false;
      },

      "Mod-Backspace": () => {
        return handleDeleteLineOrBlock(this.editor);
      },

      "Ctrl-Backspace": () => {
        return handleDeleteLineOrBlock(this.editor);
      },

      "Shift-Backspace": () => {
        const { state } = this.editor.view;
        const blockState = blockSelectionPluginKey.getState(state);
        if (blockState && blockState.selectedPositions.length > 0) {
          return deleteSelectedBlocks(this.editor.view);
        }
        return false;
      },

      Delete: () => {
        const { state } = this.editor.view;
        const blockState = blockSelectionPluginKey.getState(state);
        if (blockState && blockState.selectedPositions.length > 0) {
          return deleteSelectedBlocks(this.editor.view);
        }
        return false;
      },

      "Mod-Delete": () => {
        return handleDeleteLineOrBlock(this.editor);
      },

      "Ctrl-Delete": () => {
        return handleDeleteLineOrBlock(this.editor);
      },

      "Shift-Delete": () => {
        const { state } = this.editor.view;
        const blockState = blockSelectionPluginKey.getState(state);
        if (blockState && blockState.selectedPositions.length > 0) {
          return deleteSelectedBlocks(this.editor.view);
        }
        return false;
      },

      // Enter on an empty formatted block exits the list/quote formatting
      Enter: () => {
        const { state, dispatch } = this.editor.view;
        const { selection } = state;
        if (!selection.empty) return false;

        const { $from } = selection;
        const parent = $from.parent;

        if (parent.textContent.length === 0) {
          if (this.editor.isActive("taskItem")) {
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (node.type.name === "taskList" && node.childCount === 1) {
                const listPos = $from.before(d);
                const tr = state.tr.replaceWith(
                  listPos,
                  listPos + node.nodeSize,
                  state.schema.nodes.paragraph.create()
                );
                tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
                dispatch(tr);
                return true;
              }
            }
            if (this.editor.commands.liftListItem("taskItem")) return true;
            return this.editor.commands.toggleTaskList() || this.editor.commands.setParagraph();
          }
          if (this.editor.isActive("listItem")) {
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (
                (node.type.name === "bulletList" || node.type.name === "orderedList") &&
                node.childCount === 1
              ) {
                const listPos = $from.before(d);
                const tr = state.tr.replaceWith(
                  listPos,
                  listPos + node.nodeSize,
                  state.schema.nodes.paragraph.create()
                );
                tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
                dispatch(tr);
                return true;
              }
            }
            if (this.editor.commands.liftListItem("listItem")) return true;
            return (
              this.editor.commands.toggleBulletList() ||
              this.editor.commands.toggleOrderedList() ||
              this.editor.commands.setParagraph()
            );
          }
          if (this.editor.isActive("blockquote")) {
            return this.editor.commands.toggleBlockquote();
          }
        }

        return false;
      },
    };
  },
});

/**
 * Deletes the current line/block including all formatting and content.
 * Used for Command + Backspace (and Command + Delete) on Mac.
 */
export function handleDeleteLineOrBlock(editor: { view: EditorView }): boolean {
  const view = editor.view;
  const { state, dispatch } = view;
  const { selection } = state;
  const pmView = typeof view?.endOfTextblock === "function" ? view : undefined;

  // 1. If in block selection mode, delete all selected blocks
  const blockState = blockSelectionPluginKey.getState(state);
  if (blockState && blockState.selectedPositions.length > 0) {
    return deleteSelectedBlocks(view);
  }

  const { $from } = selection;

  // 2. Table cell: clear table cell contents to an empty paragraph
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      const cellPos = $from.before(d);
      let tr = state.tr.replaceWith(
        cellPos + 1,
        cellPos + node.nodeSize - 1,
        state.schema.nodes.paragraph.create()
      );
      tr = tr.setSelection(TextSelection.create(tr.doc, cellPos + 1));
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // 3. CodeBlock:
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "codeBlock") {
      const codeText = node.textContent;
      const codeBlockPos = $from.before(d);

      // Single-line or empty codeBlock
      if (!codeText.includes("\n")) {
        if (selection.empty && $from.parentOffset === 0 && codeBlockPos > 0) {
          let tr = state.tr.delete(codeBlockPos, codeBlockPos + node.nodeSize);
          const prevPos = Math.max(1, codeBlockPos - 1);
          try {
            tr = tr.setSelection(Selection.near(tr.doc.resolve(prevPos), -1));
          } catch {
            tr = tr.setSelection(TextSelection.create(tr.doc, prevPos));
          }
          dispatch(tr);
          view.focus();
          return true;
        }

        const emptyBlock =
          codeBlockPos === 0 && state.schema.nodes.heading
            ? state.schema.nodes.heading.create({ level: 1 })
            : state.schema.nodes.paragraph.create();
        let tr = state.tr.replaceWith(codeBlockPos, codeBlockPos + node.nodeSize, emptyBlock);
        tr = tr.setSelection(TextSelection.create(tr.doc, codeBlockPos + 1));
        dispatch(tr);
        view.focus();
        return true;
      }

      // Multi-line codeBlock
      const offset = $from.parentOffset;
      const lineStart = codeText.lastIndexOf("\n", offset - 1) + 1;
      const nextNewline = codeText.indexOf("\n", offset);
      const isLastLine = nextNewline === -1;
      const lineEnd = isLastLine ? codeText.length : nextNewline;

      const nodeStart = codeBlockPos + 1;

      // If cursor is at the first position of this line in the code block:
      if (selection.empty && offset === lineStart) {
        if (lineStart > 0) {
          // Delete preceding newline to take to the previous line in the code block
          let tr = state.tr.delete(nodeStart + lineStart - 1, nodeStart + lineStart);
          tr = tr.setSelection(TextSelection.create(tr.doc, nodeStart + lineStart - 1));
          dispatch(tr);
          view.focus();
          return true;
        } else if (codeBlockPos > 0) {
          // Very first character of code block: take to previous line before code block
          const prevPos = Math.max(1, codeBlockPos - 1);
          let tr = state.tr;
          try {
            tr = tr.setSelection(Selection.near(tr.doc.resolve(prevPos), -1));
          } catch {
            tr = tr.setSelection(TextSelection.create(tr.doc, prevPos));
          }
          dispatch(tr);
          view.focus();
          return true;
        }
      }

      // Cursor not at the first position: clear the current line of code, keeping cursor on this row
      const deleteFrom = nodeStart + lineStart;
      const deleteTo = nodeStart + lineEnd;

      let tr = state.tr;
      if (deleteTo > deleteFrom) {
        tr = tr.delete(deleteFrom, deleteTo);
      }
      tr = tr.setSelection(TextSelection.create(tr.doc, deleteFrom));
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // 4. Title bar line (first block in document at pos 0):
  // Clear the title text and ensure it stays as Heading 1 by default
  const firstNode = state.doc.child(0);
  if ($from.depth === 1 && $from.pos < firstNode.nodeSize) {
    const headingNode = state.schema.nodes.heading
      ? state.schema.nodes.heading.create({ level: 1 })
      : state.schema.nodes.paragraph.create();
    let tr = state.tr.replaceWith(0, firstNode.nodeSize, headingNode);
    tr = tr.setSelection(TextSelection.create(tr.doc, 1));
    dispatch(tr);
    view.focus();
    return true;
  }

  // 5. Lists (taskList, bulletList, orderedList):
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "taskItem" || node.type.name === "listItem") {
      const listDepth = d - 1;
      const listNode = $from.node(listDepth);
      const listPos = $from.before(listDepth);
      const itemPos = $from.before(d);

      // If list item is empty: take to previous line just like normal backspace!
      if (node.textContent.length === 0) {
        if (listNode.childCount === 1) {
          // Only item in list: delete entire list container, take to previous line
          let tr = state.tr.delete(listPos, listPos + listNode.nodeSize);
          const prevPos = Math.max(1, listPos - 1);
          try {
            tr = tr.setSelection(Selection.near(tr.doc.resolve(prevPos), -1));
          } catch {
            tr = tr.setSelection(TextSelection.create(tr.doc, prevPos));
          }
          dispatch(tr);
          view.focus();
          return true;
        } else {
          // Delete this item, take to previous list item
          let tr = state.tr.delete(itemPos, itemPos + node.nodeSize);
          const prevPos = Math.max(1, itemPos - 1);
          try {
            tr = tr.setSelection(Selection.near(tr.doc.resolve(prevPos), -1));
          } catch {
            tr = tr.setSelection(TextSelection.create(tr.doc, prevPos));
          }
          dispatch(tr);
          view.focus();
          return true;
        }
      }

      // If item has text:
      // Delete the item formatting and content, converting to an empty paragraph on that same line row!
      const emptyPara = state.schema.nodes.paragraph.create();

      if (listNode.childCount === 1) {
        let tr = state.tr.replaceWith(listPos, listPos + listNode.nodeSize, emptyPara);
        tr = tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
        dispatch(tr);
        view.focus();
        return true;
      }

      const itemIndex = $from.index(listDepth);
      let tr = state.tr;

      if (itemIndex === 0) {
        const remainingItems: ProseMirrorNode[] = [];
        for (let i = 1; i < listNode.childCount; i++) {
          remainingItems.push(listNode.child(i));
        }
        const remainingList = listNode.type.create(listNode.attrs, remainingItems);
        tr = tr.replaceWith(listPos, listPos + listNode.nodeSize, [emptyPara, remainingList]);
        tr = tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
      } else if (itemIndex === listNode.childCount - 1) {
        const remainingItems: ProseMirrorNode[] = [];
        for (let i = 0; i < listNode.childCount - 1; i++) {
          remainingItems.push(listNode.child(i));
        }
        const remainingList = listNode.type.create(listNode.attrs, remainingItems);
        tr = tr.replaceWith(listPos, listPos + listNode.nodeSize, [remainingList, emptyPara]);
        const targetPos = listPos + remainingList.nodeSize + 1;
        tr = tr.setSelection(TextSelection.create(tr.doc, targetPos));
      } else {
        const beforeItems: ProseMirrorNode[] = [];
        for (let i = 0; i < itemIndex; i++) {
          beforeItems.push(listNode.child(i));
        }
        const afterItems: ProseMirrorNode[] = [];
        for (let i = itemIndex + 1; i < listNode.childCount; i++) {
          afterItems.push(listNode.child(i));
        }
        const beforeList = listNode.type.create(listNode.attrs, beforeItems);
        const afterList = listNode.type.create(listNode.attrs, afterItems);
        tr = tr.replaceWith(listPos, listPos + listNode.nodeSize, [beforeList, emptyPara, afterList]);
        const targetPos = listPos + beforeList.nodeSize + 1;
        tr = tr.setSelection(TextSelection.create(tr.doc, targetPos));
      }

      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // 6. Blockquote:
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "blockquote") {
      const quotePos = $from.before(d);
      if (selection.empty && $from.parentOffset === 0 && quotePos > 0) {
        if (node.textContent.length === 0) {
          let tr = state.tr.delete(quotePos, quotePos + node.nodeSize);
          const prevPos = Math.max(1, quotePos - 1);
          try {
            tr = tr.setSelection(Selection.near(tr.doc.resolve(prevPos), -1));
          } catch {
            tr = tr.setSelection(TextSelection.create(tr.doc, prevPos));
          }
          dispatch(tr);
          view.focus();
          return true;
        } else {
          if (joinBackward(state, dispatch, pmView)) {
            view.focus();
            return true;
          }
          const prevPos = Math.max(1, quotePos - 1);
          let tr = state.tr;
          try {
            tr = tr.setSelection(Selection.near(tr.doc.resolve(prevPos), -1));
          } catch {
            tr = tr.setSelection(TextSelection.create(tr.doc, prevPos));
          }
          dispatch(tr);
          view.focus();
          return true;
        }
      }

      const emptyPara = state.schema.nodes.paragraph.create();
      let tr = state.tr.replaceWith(quotePos, quotePos + node.nodeSize, emptyPara);
      tr = tr.setSelection(TextSelection.create(tr.doc, quotePos + 1));
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // 7. Formatted / unformatted blocks (heading, paragraph, etc.):
  let targetPositions: number[] = [];

  if (!selection.empty) {
    const allBlocks = getAllBlocks(state.doc);
    const intersecting = allBlocks.filter(
      (b) => b.pos + b.nodeSize > selection.from && b.pos < selection.to
    );
    if (intersecting.length > 0) {
      targetPositions = intersecting.map((b) => b.pos);
    }
  }

  if (targetPositions.length === 0) {
    const currentBlock = findBlockAtPos(state.doc, selection.from);
    if (currentBlock) {
      targetPositions = [currentBlock.pos];
    }
  }

  if (targetPositions.length === 0) {
    return false;
  }

  // Single block:
  if (targetPositions.length === 1) {
    const pos = targetPositions[0];
    const node = state.doc.nodeAt(pos);
    if (node) {
      // If cursor is at the first position ($from.parentOffset === 0) and pos > 0:
      // take to the previous line just like normal backspace!
      if (selection.empty && $from.parentOffset === 0 && pos > 0) {
        // A) If block is empty: delete it and move cursor to previous line
        if (node.textContent.length === 0) {
          let tr = state.tr.delete(pos, pos + node.nodeSize);
          const prevPos = Math.max(1, pos - 1);
          try {
            tr = tr.setSelection(Selection.near(tr.doc.resolve(prevPos), -1));
          } catch {
            tr = tr.setSelection(TextSelection.create(tr.doc, prevPos));
          }
          dispatch(tr);
          view.focus();
          return true;
        }

        // B) If block has content, try joinBackward
        if (joinBackward(state, dispatch, pmView)) {
          view.focus();
          return true;
        }

        // Fallback: move cursor to end of previous block
        const prevPos = Math.max(1, pos - 1);
        let tr = state.tr;
        try {
          tr = tr.setSelection(Selection.near(tr.doc.resolve(prevPos), -1));
        } catch {
          tr = tr.setSelection(TextSelection.create(tr.doc, prevPos));
        }
        dispatch(tr);
        view.focus();
        return true;
      }

      // Otherwise (cursor has content before it, or cursor is not at first position):
      // clear formatting and text, replacing with empty paragraph on the same line row
      const emptyBlock =
        pos === 0 && state.schema.nodes.heading
          ? state.schema.nodes.heading.create({ level: 1 })
          : state.schema.nodes.paragraph.create();
      let tr = state.tr.replaceWith(pos, pos + node.nodeSize, emptyBlock);
      tr = tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  return deleteSelectedBlocks(view, targetPositions);
}

