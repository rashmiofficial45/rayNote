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
import { Markdown } from "@tiptap/markdown";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Youtube } from "@tiptap/extension-youtube";
import { IframeExtension } from "./iframeExtension";

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
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
      HTMLAttributes: {
        class: 'editor-link',
        title: 'Click to open link in browser',
      },
    }),
    Markdown.configure({
      indentation: {
        style: 'space',
        size: 2,
      },
    }),
    Table.configure({
      resizable: true,
      HTMLAttributes: {
        class: 'notefast-table',
      },
    }),
    TableRow,
    TableHeader,
    TableCell,
    Youtube.configure({
      inline: false,
      allowFullscreen: true,
      nocookie: true,
      HTMLAttributes: {
        class: 'notefast-youtube-iframe',
        referrerpolicy: 'strict-origin-when-cross-origin',
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      },
    }),
    IframeExtension,
  ];

  if (slashCommandExtension) {
    extensions.push(slashCommandExtension);
  }

  return extensions;
}
