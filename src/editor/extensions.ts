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
import { BlockSelection } from "../extensions/BlockSelection";
import { ClickSelectionExtension } from "./clickSelectionExtension";
import { PasteTitleExtension, PasteTitleOptions } from "./pasteTitleExtension";
import { FormatMemoryExtension } from "./formatMemory";


function enhancedBash(hljs: any) {
  const base = common.bash(hljs);
  const ADDITIONAL_BUILT_INS = [
    "grep", "egrep", "fgrep", "ps", "node", "npm", "npx", "pnpm", "yarn", "bun", "deno",
    "git", "cargo", "rustc", "rustup", "docker", "curl", "wget", "awk", "sed", "find",
    "tar", "zip", "unzip", "ssh", "scp", "rsync", "sudo", "kill", "pkill", "killall",
    "top", "htop", "brew", "python", "python3", "pip", "pip3", "go", "make", "gcc", "clang"
  ];
  const keywords = base.keywords as any;
  if (keywords && Array.isArray(keywords.built_in)) {
    keywords.built_in.push(...ADDITIONAL_BUILT_INS);
  }
  base.contains = [
    {
      className: "operator",
      match: /\|{1,2}|&&|>>?|<<?/,
    },
    {
      className: "params",
      match: /--?[a-zA-Z0-9_\-]+/,
    },
    ...(base.contains || []),
  ];
  return base;
}

const lowlight = createLowlight({ ...common, bash: enhancedBash });

// Register convenient language aliases so any shorthand highlights correctly
lowlight.registerAlias("bash", ["sh", "zsh", "shell", "terminal"]);
lowlight.registerAlias("javascript", ["js", "jsx"]);
lowlight.registerAlias("typescript", ["ts", "tsx"]);
lowlight.registerAlias("python", ["py"]);
lowlight.registerAlias("rust", ["rs"]);
lowlight.registerAlias("xml", ["html", "xhtml"]);
lowlight.registerAlias("yaml", ["yml"]);
lowlight.registerAlias("csharp", ["cs", "c#"]);
lowlight.registerAlias("cpp", ["c++", "cc", "hpp"]);
lowlight.registerAlias("markdown", ["md"]);

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

const CustomDocument = Document.extend({
  content: "block+",
});

/**
 * Ensures the title bar line (first block) is always Heading 1 by default
 * on blank notes or whenever the document content is cleared.
 */
export const TitleBarDefaultExtension = Extension.create({
  name: "titleBarDefault",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const { doc, schema } = newState;
          if (doc.childCount === 1) {
            const firstChild = doc.child(0);
            if (firstChild.type.name === "paragraph" && firstChild.textContent.length === 0) {
              if (schema.nodes.heading) {
                return newState.tr.setNodeMarkup(0, schema.nodes.heading, { level: 1 });
              }
            }
          }
          return null;
        },
      }),
    ];
  },
});

export function getExtensions(
  slashCommandExtension?: any,
  pasteTitleOptions?: PasteTitleOptions
) {
  const extensions = [
    CustomDocument,
    TitleBarDefaultExtension,
    PasteTitleExtension.configure(pasteTitleOptions),
    StarterKit.configure({
      document: false,
      codeBlock: false, // we use CodeBlockLowlight instead
      horizontalRule: false, // replaced by smart HorizontalRuleExtension below
      link: false, // configured separately below
      underline: false, // configured separately below
      listKeymap: false, // custom robust keymap in ShortcutsExtension handles this
      trailingNode: false, // avoid ghost empty paragraphs
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
      defaultLanguage: "bash",
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      enableTabIndentation: true,
      tabSize: 2,
      HTMLAttributes: {
        class: "code-block-wrapper notefast-code-block",
      },
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
      allowTableNodeSelection: true,
      HTMLAttributes: {
        class: 'notefast-table',
      },
    }),
    TableRow,
    TableHeader,
    TableCell,
    BlockSelection,
    ClickSelectionExtension,
    FormatMemoryExtension,
  ];

  if (slashCommandExtension) {
    extensions.push(slashCommandExtension);
  }

  return extensions;
}
