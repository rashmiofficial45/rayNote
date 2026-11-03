/**
 * Auto-title on Paste TipTap Extension (pasteTitleExtension.ts)
 *
 * Requirements:
 * - Triggers ONLY when:
 *   1. User pastes (Cmd+V) into the editor.
 *   2. Note is empty (no text content) before the paste.
 *   3. Note title is still the default (e.g. "", "Untitled", "Untitled Note").
 *   4. Caret is not inside a code block.
 * - Extracts first non-empty line as the note title:
 *   - Strips leading Markdown heading marks (`#`, `##`, ...)
 *   - Strips inline Markdown (**bold**, *italic*, `code`, [text](url) -> text)
 *   - Trims whitespace & caps at 120 characters
 * - Keeps the complete pasted text in the body, preserving its Markdown formatting.
 * - Undo (Cmd+Z) reverts the paste in ONE step (body goes back to empty AND title restored).
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Step, StepResult } from "@tiptap/pm/transform";
import { DOMParser } from "@tiptap/pm/model";
import { markdownToTipTapHtml } from "./markdownUtils";

export interface PasteTitleOptions {
  getCurrentTitle?: () => string;
  onSetTitle?: (title: string) => void;
}

/**
 * Custom ProseMirror Step that tracks note title changes in lockstep with
 * ProseMirror's transaction and history undo/redo stack.
 */
export class TitleStep extends Step {
  readonly stepType = "titleStep";

  constructor(
    public prevTitle: string,
    public newTitle: string
  ) {
    super();
  }

  apply(doc: any) {
    return StepResult.ok(doc);
  }

  invert(_doc: any) {
    return new TitleStep(this.newTitle, this.prevTitle);
  }

  map() {
    return this;
  }

  toJSON() {
    return {
      stepType: "titleStep",
      prevTitle: this.prevTitle,
      newTitle: this.newTitle,
    };
  }

  static fromJSON(_schema: any, json: any) {
    return new TitleStep(json.prevTitle, json.newTitle);
  }
}

try {
  Step.jsonID("titleStep", TitleStep);
} catch {
  // Ignore if already registered
}

/**
 * Checks if a title is the default title (empty, "Untitled", "Untitled Note").
 */
export function isDefaultTitle(title: string | undefined | null): boolean {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  return t === "" || t === "untitled" || t === "untitled note";
}

/**
 * Extracts and cleans the first non-empty line for the title bar,
 * while retaining the pasted text for the body.
 */
export function extractAutoTitleAndBody(rawText: string): {
  title: string;
  bodyMarkdown: string;
} | null {
  if (!rawText) return null;

  const lines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let firstLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstLineIdx = i;
      break;
    }
  }

  if (firstLineIdx === -1) return null;

  const rawFirstLine = lines[firstLineIdx];

  // 1. Strip leading Markdown heading marks (`#`, `##`, ...) and spaces
  let cleanTitle = rawFirstLine.trim().replace(/^#{1,6}\s+/, "");

  // 2. Strip simple inline Markdown
  // Links: [text](url) -> text
  cleanTitle = cleanTitle.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Bold: **text** or __text__
  cleanTitle = cleanTitle.replace(/(\*\*|__)(.*?)\1/g, "$2");
  // Italic: *text* or _text_
  cleanTitle = cleanTitle.replace(/(\*|_)(.*?)\1/g, "$2");
  // Strikethrough: ~~text~~
  cleanTitle = cleanTitle.replace(/~~(.*?)~~/g, "$1");
  // Inline code: `text`
  cleanTitle = cleanTitle.replace(/`([^`]+)`/g, "$1");

  // 3. Trim whitespace
  cleanTitle = cleanTitle.trim();

  // 4. Cap at about 120 characters
  if (cleanTitle.length > 120) {
    cleanTitle = cleanTitle.slice(0, 120).trim();
  }

  // 5. If result is empty, do nothing special
  if (!cleanTitle) return null;

  return {
    title: cleanTitle,
    bodyMarkdown: lines.slice(firstLineIdx).join("\n"),
  };
}

export const pasteTitlePluginKey = new PluginKey("pasteTitle");

export const PasteTitleExtension = Extension.create<PasteTitleOptions>({
  name: "pasteTitle",

  addOptions() {
    return {
      getCurrentTitle: () => "",
      onSetTitle: () => {},
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: pasteTitlePluginKey,

        props: {
          handlePaste: (view, event) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            // Trigger condition 1: note is empty before paste, or all content is selected
            let isDocEmpty = true;
            view.state.doc.forEach(node => {
              // Only blank text placeholders count as empty; embeds, tables,
              // rules and lists are content even when they contain no text.
              if (!['paragraph', 'heading'].includes(node.type.name) || node.content.size > 0) {
                isDocEmpty = false;
              }
            });
            const isSelectingAll =
              view.state.selection.from <= 1 &&
              view.state.selection.to >= view.state.doc.content.size - 1 &&
              !view.state.selection.empty;

            if (!isDocEmpty && !isSelectingAll) return false;

            // Trigger condition 2: note title is still the default (or replacing all content)
            const currentTitle = options.getCurrentTitle?.() ?? "";
            if (!isSelectingAll && !isDefaultTitle(currentTitle)) return false;

            // Trigger condition 3: caret is not inside a code block
            const { $from } = view.state.selection;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === "codeBlock") {
                return false;
              }
            }

            // Extract plain text from clipboard
            const plainText = clipboardData.getData("text/plain");
            if (!plainText) return false;

            const extracted = extractAutoTitleAndBody(plainText);
            if (!extracted) return false;

            const { title: newTitle, bodyMarkdown } = extracted;
            const prevTitle = currentTitle || "Untitled";

            // Prevent browser default paste
            event.preventDefault();

            const tr = view.state.tr;

            // Preserve the first line in the body as well as using it for the title.
            const nodesToInsert: any[] = [];

            if (bodyMarkdown.trim().length > 0) {
              const html = markdownToTipTapHtml(bodyMarkdown);
              const div = document.createElement("div");
              div.innerHTML = html;
              const parsedDoc = DOMParser.fromSchema(view.state.schema).parse(div);
              for (let i = 0; i < parsedDoc.childCount; i++) {
                nodesToInsert.push(parsedDoc.child(i));
              }
            }

            // Ensure document always has at least one valid block node
            if (nodesToInsert.length === 0) {
              nodesToInsert.push(view.state.schema.nodes.paragraph.create());
            }

            tr.replaceWith(0, view.state.doc.content.size, nodesToInsert);

            // Record title transition step in ProseMirror history
            tr.step(new TitleStep(prevTitle, newTitle));
            tr.setSelection(Selection.atEnd(tr.doc));
            view.dispatch(tr);

            return true;
          },
        },

        state: {
          init() {
            return { title: options.getCurrentTitle?.() || null, version: 0 };
          },
          apply(tr, value) {
            let title = value?.title ?? null;
            let version = value?.version ?? 0;
            for (const step of tr.steps) {
              if (step instanceof TitleStep || (step as any).stepType === "titleStep") {
                title = (step as any).newTitle;
                version++;
              }
            }
            return { title, version };
          },
        },

        view() {
          return {
            update(view, prevState) {
              if (view.state === prevState) return;
              const prev = pasteTitlePluginKey.getState(prevState);
              const curr = pasteTitlePluginKey.getState(view.state);
              if (curr && curr.version !== prev?.version && typeof curr.title === "string") {
                options.onSetTitle?.(curr.title);
              }
            },
            destroy() {},
          };
        },
      }),
    ];
  },
});
