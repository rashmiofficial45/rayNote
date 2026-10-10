import { Extension } from "@tiptap/react";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { blockSelectionPluginKey, deleteSelectedBlocks } from "../extensions/BlockSelection";

export const ShortcutsExtension = Extension.create({
  name: "shortcutsExtension",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      // Headings
      "Mod-Alt-1": () => this.editor.commands.toggleHeading({ level: 1 }),
      "Mod-Shift-1": () => this.editor.commands.toggleHeading({ level: 1 }),
      "Mod-Alt-2": () => this.editor.commands.toggleHeading({ level: 2 }),
      "Mod-Shift-2": () => this.editor.commands.toggleHeading({ level: 2 }),
      "Mod-Alt-3": () => this.editor.commands.toggleHeading({ level: 3 }),
      "Mod-Shift-3": () => this.editor.commands.toggleHeading({ level: 3 }),
      "Mod-Alt-0": () => this.editor.commands.setParagraph(),
      "Mod-Shift-0": () => this.editor.commands.setParagraph(),

      // Lists & Tasks
      "Mod-Shift-8": () => this.editor.commands.toggleBulletList(),
      "Mod-Alt-8": () => this.editor.commands.toggleBulletList(),
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList(),
      "Mod-Alt-7": () => this.editor.commands.toggleOrderedList(),
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList(),
      "Mod-Alt-9": () => this.editor.commands.toggleTaskList(),
      "Mod-Shift-t": () => this.editor.commands.toggleTaskList(),
      "Mod-Shift-T": () => this.editor.commands.toggleTaskList(),

      // Formatting
      "Mod-b": () => this.editor.commands.toggleBold(),
      "Mod-B": () => this.editor.commands.toggleBold(),
      "Mod-i": () => this.editor.commands.toggleItalic(),
      "Mod-I": () => this.editor.commands.toggleItalic(),
      "Mod-u": () => (this.editor.commands as any).toggleUnderline?.(),
      "Mod-U": () => (this.editor.commands as any).toggleUnderline?.(),
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
      "Mod-Shift-X": () => this.editor.commands.toggleStrike(),
      "Mod-Shift-s": () => this.editor.commands.toggleStrike(),
      "Mod-Shift-S": () => this.editor.commands.toggleStrike(),
      "Mod-e": () => this.editor.commands.toggleCode(),
      "Mod-E": () => this.editor.commands.toggleCode(),
      "Mod-Shift-h": () => this.editor.commands.toggleHighlight(),
      "Mod-Shift-H": () => this.editor.commands.toggleHighlight(),
      "Mod-Shift-b": () => this.editor.commands.toggleBlockquote(),
      "Mod-Shift-B": () => this.editor.commands.toggleBlockquote(),
      "Mod-Shift-.": () => this.editor.commands.toggleBlockquote(),
      "Mod-Alt-.": () => this.editor.commands.toggleBlockquote(),
      "Mod-Alt-c": () => this.editor.commands.toggleCodeBlock(),
      "Mod-Shift-c": () => this.editor.commands.toggleCodeBlock(),
      "Mod-Shift-C": () => this.editor.commands.toggleCodeBlock(),
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

      // Toggle TaskItem checkbox on current line with Mod-Enter or Alt-Enter
      "Mod-Enter": () => {
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
          return this.editor.commands.insertContent("  ");
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
        const { state } = this.editor.view;
        const blockState = blockSelectionPluginKey.getState(state);
        if (blockState && blockState.selectedPositions.length > 0) {
          return deleteSelectedBlocks(this.editor.view);
        }
        return (this.editor.commands as any).Backspace?.() ?? false;
      },

      "Shift-Backspace": () => {
        const { state } = this.editor.view;
        const blockState = blockSelectionPluginKey.getState(state);
        if (blockState && blockState.selectedPositions.length > 0) {
          return deleteSelectedBlocks(this.editor.view);
        }
        return (this.editor.commands as any).Backspace?.() ?? false;
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
        const { state } = this.editor.view;
        const blockState = blockSelectionPluginKey.getState(state);
        if (blockState && blockState.selectedPositions.length > 0) {
          return deleteSelectedBlocks(this.editor.view);
        }
        return false;
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
