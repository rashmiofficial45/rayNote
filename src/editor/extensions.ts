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
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
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
import { PasteTitleExtension, PasteTitleOptions, isDefaultTitle } from "./pasteTitleExtension";
import { FormatMemoryExtension } from "./formatMemory";


function enhancedBash(hljs: any) {
  const base = (bash as any)(hljs);
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

export const lowlight = createLowlight({ bash: enhancedBash });

// Register convenient language aliases so any shorthand highlights correctly
lowlight.registerAlias("bash", ["sh", "zsh", "shell", "terminal"]);

/**
 * Standard alias mapping for quick resolution to canonical highlight.js grammars.
 * Covers user aliases: js, ts, py, sh, zsh, yml, md, rs, tsx, jsx, etc.
 */
export const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  terminal: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  rs: "rust",
  rust: "rust",
  json: "json",
  html: "xml",
  xhtml: "xml",
  xml: "xml",
  css: "css",
  sql: "sql",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  c: "c",
  cs: "csharp",
  "c#": "csharp",
  csharp: "csharp",
  go: "go",
  java: "java",
  diff: "diff",
};

/**
 * Explicit dynamic import map for syntax-highlighting grammars.
 * Instead of statically bundling all 37 languages into the initial app chunk,
 * grammars are loaded asynchronously on-demand when a code block of that language appears.
 */
export const LOWLIGHT_LANGUAGE_LOADERS: Record<string, () => Promise<any>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  json: () => import("highlight.js/lib/languages/json"),
  xml: () => import("highlight.js/lib/languages/xml"),
  html: () => import("highlight.js/lib/languages/xml"),
  css: () => import("highlight.js/lib/languages/css"),
  sql: () => import("highlight.js/lib/languages/sql"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  c: () => import("highlight.js/lib/languages/c"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  go: () => import("highlight.js/lib/languages/go"),
  java: () => import("highlight.js/lib/languages/java"),
  diff: () => import("highlight.js/lib/languages/diff"),
};

export async function ensureLanguageLoaded(lang: string): Promise<boolean> {
  if (!lang || typeof lang !== "string") return false;
  const raw = lang.toLowerCase().trim();
  const canonical = LANGUAGE_ALIASES[raw] || raw;

  if (lowlight.registered(canonical)) {
    if (!lowlight.registered(raw)) {
      lowlight.registerAlias(canonical, [raw]);
    }
    return true;
  }

  const loader = LOWLIGHT_LANGUAGE_LOADERS[canonical];
  if (!loader) {
    // Unknown languages are silently ignored without throwing
    return false;
  }

  try {
    const mod = await loader();
    const grammar = mod.default || mod;
    lowlight.register(canonical, grammar);
    if (raw !== canonical) {
      lowlight.registerAlias(canonical, [raw]);
    }
    return true;
  } catch {
    // Unknown or dynamic load failure is silently ignored
    return false;
  }
}

/**
 * Scans a note payload (TipTap JSON string, JSON object, or Markdown) for all declared code block languages.
 */
export function scanCodeBlockLanguages(content: unknown): string[] {
  if (!content) return [];
  const languages = new Set<string>();

  if (typeof content === "string") {
    // 1. Scan for fenced markdown blocks: ```lang
    const fencedRegex = /```([a-zA-Z0-9_#+-]+)/g;
    let match: RegExpExecArray | null;
    while ((match = fencedRegex.exec(content)) !== null) {
      if (match[1]) languages.add(match[1].toLowerCase().trim());
    }

    // 2. Scan for JSON codeBlock language attributes: "language":"x" or "language": "x"
    const jsonLangRegex = /"language"\s*:\s*"([a-zA-Z0-9_#+-]+)"/g;
    while ((match = jsonLangRegex.exec(content)) !== null) {
      if (match[1]) languages.add(match[1].toLowerCase().trim());
    }
  } else if (typeof content === "object") {
    // JSON AST object traversal
    const traverse = (node: any) => {
      if (!node) return;
      if (node.type === "codeBlock" && node.attrs?.language) {
        languages.add(String(node.attrs.language).toLowerCase().trim());
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          traverse(child);
        }
      }
    };
    traverse(content);
  }

  return Array.from(languages);
}

/**
 * Preloads and registers all lowlight grammars present in a note content before setContent.
 */
export async function preloadLanguagesForContent(content: unknown): Promise<void> {
  const languages = scanCodeBlockLanguages(content);
  if (languages.length > 0) {
    await Promise.all(languages.map((l) => ensureLanguageLoaded(l)));
  }
}

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

const CustomDocument = Document.extend({
  content: "block+",
});

/**
 * Ensures the title bar line (first block) is Heading 1 by default
 * on blank notes or whenever the document content is cleared, UNLESS the note
 * already has a non-default title (e.g. from PasteTitleExtension or note metadata).
 */
export const TitleBarDefaultExtension = Extension.create<PasteTitleOptions>({
  name: "titleBarDefault",

  addOptions() {
    return {
      getCurrentTitle: () => "",
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          // If transaction contains a TitleStep or if note already has a title, do not convert to H1
          const hasTitleStep = transactions.some((tr) =>
            tr.steps.some((s) => (s as any).stepType === "titleStep")
          );
          if (hasTitleStep) return null;

          const currentTitle = options.getCurrentTitle?.();
          if (!isDefaultTitle(currentTitle)) return null;

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
    TitleBarDefaultExtension.configure(pasteTitleOptions),
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
