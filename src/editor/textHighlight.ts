import type { Attributes } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";

export const HIGHLIGHT_COLORS = [
  "yellow", "green", "blue", "pink", "purple", "orange", "red", "gray",
] as const;

export const HIGHLIGHT_STYLES = [
  ["classic", "Classic"],
  ["pastel", "Pastel"],
  ["underline", "Underline"],
  ["stripes", "Stripes"],
  ["crosshatch", "Crosshatch"],
  ["bands", "Bands"],
] as const;

export const TextHighlight = Highlight.extend({
  addAttributes() {
    const parent: Attributes = this.parent?.() ?? {};
    return {
      ...parent,
      color: {
        ...parent?.color,
        renderHTML: ({ color }) => {
          if (!color) return {};
          if (HIGHLIGHT_COLORS.some(option => option === color)) return { "data-color": color };
          // Preserve valid CSS colors from imported or older HTML.
          return parent?.color?.renderHTML?.({ color }) ?? {};
        },
      },
      style: {
        default: null,
        parseHTML: element => element.getAttribute("data-highlight-style"),
        renderHTML: ({ style }) => style === "dots" || HIGHLIGHT_STYLES.some(([id]) => id === style)
          ? { "data-highlight-style": style }
          : {},
      },
    };
  },
}).configure({ multicolor: true });
