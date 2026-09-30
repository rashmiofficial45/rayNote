import StarterKit from "@tiptap/starter-kit";
import Document from "@tiptap/extension-document";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { common, createLowlight } from "lowlight";
import { SearchExtension } from "./searchExtension";
import { ShortcutsExtension } from "./shortcutsExtension";

import { HorizontalRuleExtension } from "./horizontalRuleExtension";

const lowlight = createLowlight(common);

const CustomDocument = Document.extend({
  content: "block+",
});

export function getExtensions(slashCommandExtension?: any) {
  const extensions = [
    CustomDocument,
    StarterKit.configure({
      document: false,
      codeBlock: false, // we use CodeBlockLowlight instead
      horizontalRule: false, // replaced by smart HorizontalRuleExtension below
      link: false, // configured separately below
      underline: false, // configured separately below
      undoRedo: {
        depth: 50,
      },
      heading: {
        levels: [1, 2, 3],
      },
    }),
    HorizontalRuleExtension,
    Underline,
    ShortcutsExtension,
    SearchExtension,
    Placeholder.configure({
      placeholder: ({ pos, hasAnchor }) => {
        // First node in the document → always show "Note Title"
        if (pos === 0) {
          return "Note Title";
        }
        // Only show "Type '/' for commands…" on the current active line where the cursor is
        if (hasAnchor) {
          return "Type '/' for commands…";
        }
        return "";
      },
      showOnlyCurrent: false,
      emptyEditorClass: "is-editor-empty",
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Highlight.configure({
      multicolor: false,
    }),
    Typography,
    CodeBlockLowlight.configure({
      lowlight,
    }),
    Link.configure({
      openOnClick: true,
      autolink: true,
      defaultProtocol: 'https',
    }),
  ];

  if (slashCommandExtension) {
    extensions.push(slashCommandExtension);
  }

  return extensions;
}
