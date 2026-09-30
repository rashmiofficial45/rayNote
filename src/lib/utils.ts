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
          return `${prefix}${text}\n`;
        }
        case "paragraph": {
          const text = (node.content || []).map(serializeInline).join("");
          return `${text}\n`;
        }
        case "bulletList": {
          return (
            (node.content || [])
              .map((item: any) => {
                const itemText = (item.content || [])
                  .map((p: any) => serializeNode(p, indent + "  ").trim())
                  .join(" ");
                return `${indent}- ${itemText}`;
              })
              .join("\n") + "\n"
          );
        }
        case "orderedList": {
          const start = node.attrs?.start || 1;
          return (
            (node.content || [])
              .map((item: any, idx: number) => {
                const itemText = (item.content || [])
                  .map((p: any) => serializeNode(p, indent + "   ").trim())
                  .join(" ");
                return `${indent}${start + idx}. ${itemText}`;
              })
              .join("\n") + "\n"
          );
        }
        case "taskList": {
          return (
            (node.content || [])
              .map((item: any) => {
                const checked = item.attrs?.checked ? "[x]" : "[ ]";
                const itemText = (item.content || [])
                  .map((p: any) => serializeNode(p, indent + "  ").trim())
                  .join(" ");
                return `${indent}- ${checked} ${itemText}`;
              })
              .join("\n") + "\n"
          );
        }
        case "blockquote": {
          const text = (node.content || [])
            .map((p: any) => serializeNode(p).trim())
            .join("\n");
          return (
            text
              .split("\n")
              .map((l: string) => `> ${l}`)
              .join("\n") + "\n"
          );
        }
        case "codeBlock": {
          const lang = node.attrs?.language || "";
          const text = (node.content || []).map((n: any) => n.text || "").join("");
          return `\`\`\`${lang}\n${text}\n\`\`\`\n`;
        }
        case "horizontalRule": {
          return "---\n";
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

    return lines.join("\n").trim() + "\n";
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
