import { marked } from "marked";
import type { Slice } from "@tiptap/pm/model";

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
 * Converts Markdown text into TipTap-compatible HTML with full task list,
 * link, and heading support.
 */
export function markdownToTipTapHtml(md: string): string {
  if (!md) return "";

  // Parse using marked with GFM (GitHub Flavored Markdown)
  let html = marked.parse(md, {
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
export function sliceToMarkdown(slice: Slice, editorInstance?: any): string {
  if (!slice || !slice.content || slice.content.size === 0) {
    return "";
  }

  // If editor has @tiptap/markdown registered, try its serializer first
  try {
    const manager = editorInstance?.storage?.markdown?.manager;
    if (manager && typeof manager.serialize === "function") {
      const jsonContent = slice.content.toJSON();
      if (jsonContent) {
        const docJson = {
          type: "doc",
          content: Array.isArray(jsonContent) ? jsonContent : [jsonContent],
        };
        const md = manager.serialize(docJson);
        if (typeof md === "string" && md.trim()) {
          return md.trim();
        }
      }
    }
  } catch (err) {
    console.warn("TipTap markdown manager serialize fallback:", err);
  }

  // Custom high-fidelity ProseMirror Node-to-Markdown serializer
  const serializeNode = (node: any, indent = ""): string => {
    if (!node) return "";

    if (node.isText) {
      let text = node.text || "";
      if (node.marks && node.marks.length > 0) {
        for (const mark of node.marks) {
          const type = mark.type?.name;
          if (type === "code") {
            text = `\`${text}\``;
          } else if (type === "bold") {
            text = `**${text}**`;
          } else if (type === "italic") {
            text = `*${text}*`;
          } else if (type === "strike") {
            text = `~~${text}~~`;
          } else if (type === "link") {
            const href = mark.attrs?.href || "";
            text = `[${text}](${href})`;
          } else if (type === "underline") {
            text = `<u>${text}</u>`;
          } else if (type === "highlight") {
            text = `==${text}==`;
          }
        }
      }
      return text;
    }

    const type = node.type?.name;
    const childNodes: any[] = [];
    if (node.content && node.content.childCount > 0) {
      for (let i = 0; i < node.content.childCount; i++) {
        childNodes.push(node.content.child(i));
      }
    }
    const childrenText = childNodes.map((c) => serializeNode(c, indent)).join("");

    switch (type) {
      case "paragraph":
        return `${childrenText}\n\n`;

      case "heading": {
        const level = node.attrs?.level || 1;
        return `${"#".repeat(level)} ${childrenText}\n\n`;
      }

      case "bulletList": {
        let out = "";
        for (const item of childNodes) {
          const lines: string[] = [];
          if (item.content) {
            for (let i = 0; i < item.content.childCount; i++) {
              const child = item.content.child(i);
              if (child.type?.name === "paragraph") {
                const text = serializeNode(child, "").trim();
                lines.push(i === 0 ? `${indent}- ${text}` : `${indent}  ${text}`);
              } else if (["bulletList", "orderedList", "taskList"].includes(child.type?.name)) {
                lines.push(serializeNode(child, indent + "  ").trimEnd());
              } else {
                lines.push(`${indent}  ${serializeNode(child, indent + "  ").trim()}`);
              }
            }
          }
          out += lines.join("\n") + "\n";
        }
        return `${out}\n`;
      }

      case "orderedList": {
        let out = "";
        let idx = 1;
        for (const item of childNodes) {
          const prefix = `${idx}. `;
          const indentPrefix = " ".repeat(prefix.length);
          const lines: string[] = [];
          if (item.content) {
            for (let i = 0; i < item.content.childCount; i++) {
              const child = item.content.child(i);
              if (child.type?.name === "paragraph") {
                const text = serializeNode(child, "").trim();
                lines.push(i === 0 ? `${indent}${prefix}${text}` : `${indent}${indentPrefix}${text}`);
              } else if (["bulletList", "orderedList", "taskList"].includes(child.type?.name)) {
                lines.push(serializeNode(child, indent + indentPrefix).trimEnd());
              } else {
                lines.push(`${indent}${indentPrefix}${serializeNode(child, indent + indentPrefix).trim()}`);
              }
            }
          }
          out += lines.join("\n") + "\n";
          idx++;
        }
        return `${out}\n`;
      }

      case "taskList": {
        let out = "";
        for (const item of childNodes) {
          const checked = item.attrs?.checked;
          const prefix = `- [${checked ? "x" : " "}] `;
          const lines: string[] = [];
          if (item.content) {
            for (let i = 0; i < item.content.childCount; i++) {
              const child = item.content.child(i);
              if (child.type?.name === "paragraph") {
                const text = serializeNode(child, "").trim();
                lines.push(i === 0 ? `${indent}${prefix}${text}` : `${indent}  ${text}`);
              } else if (["bulletList", "orderedList", "taskList"].includes(child.type?.name)) {
                lines.push(serializeNode(child, indent + "  ").trimEnd());
              } else {
                lines.push(`${indent}  ${serializeNode(child, indent + "  ").trim()}`);
              }
            }
          }
          out += lines.join("\n") + "\n";
        }
        return `${out}\n`;
      }

      case "taskItem": {
        const checked = node.attrs?.checked;
        return `${indent}- [${checked ? "x" : " "}] ${childrenText.trim()}\n`;
      }

      case "codeBlock": {
        const lang = node.attrs?.language || "";
        const code = node.textContent || "";
        return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
      }

      case "blockquote": {
        const lines = childrenText.trim().split("\n");
        return lines.map((l) => `> ${l}`).join("\n") + "\n\n";
      }

      case "horizontalRule":
        return `---\n\n`;

      case "table": {
        let tableOut = "";
        const rows = childNodes;
        if (rows.length === 0) return "";

        const firstRow = rows[0];
        const firstRowCells = firstRow.content
          ? Array.from({ length: firstRow.content.childCount }, (_, i) =>
              serializeNode(firstRow.content.child(i)).trim()
            )
          : [];
        tableOut += `| ${firstRowCells.join(" | ")} |\n`;
        tableOut += `| ${firstRowCells.map(() => "---").join(" | ")} |\n`;

        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const cells = row.content
            ? Array.from({ length: row.content.childCount }, (_, i) =>
                serializeNode(row.content.child(i)).trim()
              )
            : [];
          tableOut += `| ${cells.join(" | ")} |\n`;
        }
        return `${tableOut}\n`;
      }

      case "tableRow":
      case "tableHeader":
      case "tableCell":
        return childrenText;

      case "iframe": {
        const src = node.attrs?.src || "";
        const w = node.attrs?.width || "100%";
        const h = node.attrs?.height || 315;
        return `<iframe src="${src}" width="${w}" height="${h}" allowfullscreen></iframe>\n\n`;
      }

      case "youtube": {
        const src = node.attrs?.src || "";
        return `${src}\n\n`;
      }

      default:
        return childrenText;
    }
  };

  const results: string[] = [];
  for (let i = 0; i < slice.content.childCount; i++) {
    results.push(serializeNode(slice.content.child(i)));
  }

  return results.join("").trim();
}
