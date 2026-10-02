import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function getPreviewText(content: string): string {
  if (!content) return "New note";
  try {
    const doc = JSON.parse(content);
    const texts: string[] = [];
    function extractText(node: any) {
      if (node.text) texts.push(node.text);
      if (node.content) node.content.forEach(extractText);
    }
    extractText(doc);
    const joined = texts.join(" ").trim();
    return joined.length > 80 ? joined.slice(0, 80) + "…" : joined || "New note";
  } catch {
    return "New note";
  }
}

export function getNoteTitle(title: string, content: string): string {
  if (title && title.trim()) return title;
  const preview = getPreviewText(content);
  return preview.length > 30 ? preview.slice(0, 30) + "…" : preview;
}

export function noteContentToMarkdown(content: string, fallbackTitle = "Untitled"): string {
  if (!content) return `# ${fallbackTitle}\n\n`;
  try {
    const doc = typeof content === "string" ? JSON.parse(content) : content;
    if (!doc || !doc.content || !Array.isArray(doc.content)) return content;

    const lines: string[] = [];

    function serializeNode(node: any, indent = ""): string {
      if (!node) return "";
      switch (node.type) {
        case "heading": {
          const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
          const prefix = "#".repeat(level) + " ";
          const text = (node.content || []).map(serializeInline).join("");
          return `${prefix}${text}\n\n`;
        }
        case "paragraph": {
          const text = (node.content || []).map(serializeInline).join("");
          return `${text}\n\n`;
        }
        case "bulletList": {
          return (
            (node.content || [])
              .map((item: any) => {
                const itemLines = (item.content || []).map((p: any) => {
                  if (p.type === "paragraph") {
                    return (p.content || []).map(serializeInline).join("");
                  }
                  return serializeNode(p, indent + "  ").trim();
                });
                return `${indent}- ${itemLines.join(" ")}`;
              })
              .join("\n") + "\n\n"
          );
        }
        case "orderedList": {
          const start = node.attrs?.start || 1;
          return (
            (node.content || [])
              .map((item: any, idx: number) => {
                const itemLines = (item.content || []).map((p: any) => {
                  if (p.type === "paragraph") {
                    return (p.content || []).map(serializeInline).join("");
                  }
                  return serializeNode(p, indent + "   ").trim();
                });
                return `${indent}${start + idx}. ${itemLines.join(" ")}`;
              })
              .join("\n") + "\n\n"
          );
        }
        case "taskList": {
          return (
            (node.content || [])
              .map((item: any) => {
                const checked = item.attrs?.checked ? "[x]" : "[ ]";
                const itemLines = (item.content || []).map((p: any) => {
                  if (p.type === "paragraph") {
                    return (p.content || []).map(serializeInline).join("");
                  }
                  return serializeNode(p, indent + "  ").trim();
                });
                return `${indent}- ${checked} ${itemLines.join(" ")}`;
              })
              .join("\n") + "\n\n"
          );
        }
        case "taskItem": {
          const checked = node.attrs?.checked ? "[x]" : "[ ]";
          const text = (node.content || []).map((p: any) => {
            if (p.type === "paragraph") {
              return (p.content || []).map(serializeInline).join("");
            }
            return serializeNode(p, indent).trim();
          }).join(" ");
          return `${indent}- ${checked} ${text}\n`;
        }
        case "blockquote": {
          const text = (node.content || [])
            .map((p: any) => serializeNode(p).trim())
            .join("\n");
          return (
            text
              .split("\n")
              .map((l: string) => `> ${l}`)
              .join("\n") + "\n\n"
          );
        }
        case "codeBlock": {
          const lang = node.attrs?.language || "";
          const text = (node.content || []).map((n: any) => n.text || "").join("");
          return `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
        }
        case "table": {
          const rows = node.content || [];
          if (rows.length === 0) return "";
          const tableLines: string[] = [];
          rows.forEach((row: any, rIdx: number) => {
            const cells = (row.content || []).map((cell: any) => {
              const cellText = (cell.content || [])
                .map((p: any) => {
                  if (p.type === "paragraph") {
                    return (p.content || []).map(serializeInline).join("");
                  }
                  return serializeNode(p).trim();
                })
                .join(" ");
              return cellText.replace(/\|/g, "\\|");
            });
            tableLines.push(`| ${cells.join(" | ")} |`);
            if (rIdx === 0) {
              tableLines.push(`| ${cells.map(() => "---").join(" | ")} |`);
            }
          });
          return tableLines.join("\n") + "\n\n";
        }
        case "image": {
          const alt = node.attrs?.alt || "";
          const src = node.attrs?.src || "";
          const title = node.attrs?.title ? ` "${node.attrs.title}"` : "";
          return `![${alt}](${src}${title})\n\n`;
        }
        case "youtube": {
          const src = node.attrs?.src || "";
          return `${src}\n\n`;
        }
        case "iframe": {
          const src = node.attrs?.src || "";
          const w = node.attrs?.width || "100%";
          const h = node.attrs?.height || 315;
          return `<iframe src="${src}" width="${w}" height="${h}" allowfullscreen></iframe>\n\n`;
        }
        case "horizontalRule": {
          return "---\n\n";
        }
        default: {
          if (node.content) {
            return node.content
              .map((child: any) => serializeNode(child, indent))
              .join("");
          }
          return node.text || "";
        }
      }
    }

    function serializeInline(node: any): string {
      if (!node) return "";
      if (node.type === "hardBreak") {
        return "  \n";
      }
      if (!node.text) return "";
      let text = node.text;
      if (!node.marks || node.marks.length === 0) return text;

      for (const mark of node.marks) {
        switch (mark.type) {
          case "bold":
            text = `**${text}**`;
            break;
          case "italic":
            text = `*${text}*`;
            break;
          case "underline":
            text = `<u>${text}</u>`;
            break;
          case "strike":
            text = `~~${text}~~`;
            break;
          case "code":
            text = `\`${text}\``;
            break;
          case "highlight":
            text = `==${text}==`;
            break;
          case "link":
            text = `[${text}](${mark.attrs?.href || ""})`;
            break;
        }
      }
      return text;
    }

    for (const child of doc.content) {
      lines.push(serializeNode(child));
    }

    return lines.join("").trim() + "\n";
  } catch {
    return content;
  }
}

export function noteContentToPlainText(content: string, fallbackTitle = "Untitled"): string {
  if (!content) return fallbackTitle;
  try {
    const doc = typeof content === "string" ? JSON.parse(content) : content;
    if (!doc || !doc.content) return content;
    const texts: string[] = [];
    function extract(node: any) {
      if (node.isText || node.type === "text") {
        texts.push(node.text || "");
      } else if (node.type === "horizontalRule") {
        texts.push("\n---\n");
      } else if (node.type === "taskItem") {
        texts.push(node.attrs?.checked ? "[x] " : "[ ] ");
        if (node.content) node.content.forEach(extract);
        texts.push("\n");
      } else {
        if (node.content) {
          node.content.forEach(extract);
          if (["heading", "paragraph", "blockquote", "codeBlock", "listItem"].includes(node.type)) {
            texts.push("\n");
          }
        }
      }
    }
    extract(doc);
    return texts.join("").trim();
  } catch {
    return content;
  }
}

export function downloadFile(filename: string, content: string, mimeType = "text/markdown") {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
