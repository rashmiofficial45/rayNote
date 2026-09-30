import { Extension } from "@tiptap/react";

export const ShortcutsExtension = Extension.create({
  name: "shortcutsExtension",

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
    };
  },
});
