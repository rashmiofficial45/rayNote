import { marked } from "marked";
import { noteContentToMarkdown } from "../lib/utils";
import type { Slice } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";

/**
 * Checks if a string contains Markdown formatting syntax.
 */
export function isMarkdownContent(text: string): boolean {
  if (!text || !text.trim()) return false;
  
  // Quick check for common markdown patterns:
  // - Headings (# H1, ## H2, etc.)
  // - Task lists (- [ ] or - [x])
  // - Bullet lists (- item, * item, + item)
  // - Ordered lists (1. item)
  // - Blockquotes (> quote)
  // - Code blocks (```lang ... ```)
  // - Inline code (`code`)
  // - Markdown links ([text](url))
  // - Bold / italic / strikethrough (**bold**, *italic*, ~~strike~~, __bold__)
  // - Horizontal rules (--- or *** or ___)
  const patterns = [
    /(?:^|\n)#{1,6}\s+\S+/m,
    /(?:^|\n)\s*[-*+]\s+\[[ xX]\]\s+/m,
    /(?:^|\n)\s*[-*+]\s+\S+/m,
    /(?:^|\n)\s*\d+\.\s+\S+/m,
    /(?:^|\n)\s*>\s+\S+/m,
    /```[\s\S]*?```/,
    /`[^`\n]+`/,
    /\[[^\]\n]+\]\([^)\n]+\)/,
    /\*\*[^*]+?\*\*|__[^_]+?__|~~[^~]+?~~|\*[^*]+?\*/,
    /(?:^|\n)\s*(?:---|___|\*\*\*)\s*(?:\n|$)/m,
    /\|.+?\|.+?\|/,
    /<iframe[\s\S]*?<\/iframe>/i,
  ];

  return patterns.some((p) => p.test(text));
}

/**
 * Ensures the first content line of a Markdown document is formatted as a Heading 1 (# Title).
 * - Extracts and converts frontmatter `title: ...` into an H1 if present.
 * - Leaves existing `# Title` and setext `Title\n===` untouched.
 * - Promotes leading sub-headings (`## Title`, `### Title`, etc.) to H1.
 * - Promotes the first non-empty text line / paragraph to H1.
 * - Uses fallbackTitle if the markdown has no text lines.
 */
export function ensureFirstLineHeading(md: string, fallbackTitle?: string): string {
  if (!md || !md.trim()) {
    return fallbackTitle ? `# ${fallbackTitle}\n` : "";
  }

  let text = md.trim();

  // 1. Handle YAML frontmatter: --- ... ---
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = text.match(frontmatterRegex);
  let frontmatterTitle: string | null = null;
  if (match) {
    const yaml = match[1];
    const titleMatch = yaml.match(/(?:^|\n)\s*title\s*:\s*["']?([^"'\r\n]+)["']?/i);
    if (titleMatch) {
      frontmatterTitle = titleMatch[1].trim();
    }
    // Remove frontmatter from the body
    text = text.slice(match[0].length).trim();
  }

  if (frontmatterTitle) {
    if (/^#\s+/.test(text)) {
      return text;
    }
    return `# ${frontmatterTitle}\n\n${text}`;
  }

  // 2. If it already starts with H1: e.g. '# Title'
  if (/^#\s+\S+/.test(text)) {
    return text;
  }

  // Check Setext H1: 'Title\n==='
  const firstBlock = text.split(/\r?\n\r?\n/)[0] || "";
  if (/^.+\r?\n={3,}\s*$/m.test(firstBlock)) {
    return text;
  }

  // 3. If it starts with H2-H6: e.g. '## Title', promote to H1 '# Title'
  const subHeadingMatch = text.match(/^#{2,6}\s+(.+)$/m);
  if (subHeadingMatch && text.indexOf(subHeadingMatch[0]) === 0) {
    return text.replace(/^#{2,6}\s+/, "# ");
  }

  // 4. If it starts with a normal line of text (paragraph), promote that first line to H1
  const lines = text.split(/\r?\n/);
  let firstLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstLineIdx = i;
      break;
    }
  }

  if (firstLineIdx !== -1) {
    const firstLine = lines[firstLineIdx].trim();
    // Do not promote if it's a code block fence (```), horizontal rule (---), or table (|)
    const isSpecialBlock =
      firstLine.startsWith("```") ||
      firstLine.startsWith("~~~") ||
      /^(?:---|___|\*\*\*)$/.test(firstLine) ||
      firstLine.startsWith("|");

    if (!isSpecialBlock) {
      const cleanTitle = firstLine.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
      lines[firstLineIdx] = `# ${cleanTitle}`;
      return lines.join("\n");
    }
  }

  if (fallbackTitle) {
    return `# ${fallbackTitle}\n\n${text}`;
  }

  return text;
}

/**
 * Converts Markdown text into TipTap-compatible HTML with full task list,
 * link, and heading support.
 */
export function markdownToTipTapHtml(
  md: string,
  options?: { ensureFirstLineH1?: boolean; fallbackTitle?: string }
): string {
  if (!md && !options?.fallbackTitle) return "";

  let processedMd = md;
  if (options?.ensureFirstLineH1) {
    processedMd = ensureFirstLineHeading(md, options.fallbackTitle);
  }
  if (!processedMd) return "";

  // Parse using marked with GFM (GitHub Flavored Markdown)
  let html = marked.parse(processedMd, {
    gfm: true,
    breaks: true,
    async: false,
  }) as string;

  // Convert marked task lists into TipTap schema format:
  // marked outputs <li><input disabled="" type="checkbox"> or <input checked="" ...>
  // TipTap requires <ul data-type="taskList"><li data-type="taskItem" data-checked="true|false"><p>...</p></li></ul>
  
  // Transform task list items
  html = html.replace(
    /<li>\s*<input(?:\s+checked(?:="")?)?[^>]*type="checkbox"[^>]*>([\s\S]*?)<\/li>/gis,
    (match, innerContent) => {
      const isChecked = /checked/i.test(match);
      const clean = innerContent.trim();
      const formattedBody = clean.startsWith("<p>") ? clean : `<p>${clean}</p>`;
      return `<li data-type="taskItem" data-checked="${isChecked}"><label contenteditable="false"><input type="checkbox" ${isChecked ? 'checked="checked"' : ""} disabled="disabled"></label><div>${formattedBody}</div></li>`;
    }
  );

  // Wrap consecutive taskItems in <ul data-type="taskList">
  html = html.replace(
    /<ul[^>]*>(\s*<li data-type="taskItem"[^>]*>[\s\S]*?<\/li>\s*)<\/ul>/gi,
    '<ul data-type="taskList">$1</ul>'
  );

  return html;
}

/**
 * Converts a ProseMirror Slice (selection) into Markdown text for clipboard copying.
 * Preserves headings, bold, italic, strikethrough, underline, links, code blocks,
 * bullet lists, ordered lists, and task lists without breaking format.
 */
export function sliceToMarkdown(slice: Slice, _editorInstance?: Editor | null): string {
  if (!slice?.content?.size) return "";
  const toJSON = (node: any): any => {
    if (typeof node.toJSON === "function") return node.toJSON();
    const content = node.content?.childCount ? Array.from({ length: node.content.childCount }, (_, i) => toJSON(node.content.child(i))) : undefined;
    return { type: node.isText ? "text" : node.type?.name, attrs: node.attrs, text: node.text, marks: node.marks?.map((m: any) => ({ type: m.type?.name, attrs: m.attrs })), ...(content ? { content } : node.type?.name === "codeBlock" && node.textContent ? { content: [{ type: "text", text: node.textContent }] } : {}) };
  };
  const content = typeof slice.content.toJSON === "function" ? slice.content.toJSON() : Array.from({ length: slice.content.childCount }, (_, i) => toJSON(slice.content.child(i)));
  return noteContentToMarkdown(JSON.stringify({ type: "doc", content }), "").trim();
}
