import { Node, mergeAttributes } from "@tiptap/core";

export interface IframeOptions {
  allowFullscreen: boolean;
  HTMLAttributes: Record<string, any>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    iframe: {
      /**
       * Insert an iframe embed
       */
      setIframe: (options: {
        src: string;
        width?: string | number;
        height?: string | number;
        title?: string;
        referrerpolicy?: string;
      }) => ReturnType;
    };
  }
}

/**
 * Normalizes embed URLs (especially YouTube) to use privacy-enhanced,
 * webview-friendly domains (youtube-nocookie.com) that prevent Error 153.
 */
export function normalizeEmbedUrl(url: string | null): string {
  if (!url) return "";
  let src = url.trim();

  try {
    // If standard youtube watch URL or youtu.be shortlink
    const ytWatchMatch = src.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
    );
    if (ytWatchMatch && ytWatchMatch[1]) {
      const videoId = ytWatchMatch[1];
      const validHttp = src.startsWith("http://") || src.startsWith("https://") ? src : `https://${src}`;
      const urlObj = new URL(validHttp);
      const params = new URLSearchParams(urlObj.search);
      params.delete("v");
      const query = params.toString() ? `?${params.toString()}` : "";
      return `https://www.youtube-nocookie.com/embed/${videoId}${query}`;
    }

    // If already youtube.com/embed/, convert to youtube-nocookie.com/embed/
    if (src.includes("youtube.com/embed/")) {
      src = src.replace("youtube.com/embed/", "youtube-nocookie.com/embed/");
    }
  } catch {
    // Fallback if URL parsing fails
    if (src.includes("youtube.com/embed/")) {
      src = src.replace("youtube.com/embed/", "youtube-nocookie.com/embed/");
    }
  }

  return src;
}

export const IframeExtension = Node.create<IframeOptions>({
  name: "iframe",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      allowFullscreen: true,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => normalizeEmbedUrl(element.getAttribute("src")),
      },
      width: {
        default: "100%",
      },
      height: {
        default: 315,
      },
      frameborder: {
        default: 0,
      },
      referrerpolicy: {
        default: "strict-origin-when-cross-origin",
        parseHTML: (element) =>
          element.getAttribute("referrerpolicy") || "strict-origin-when-cross-origin",
      },
      allowfullscreen: {
        default: this.options.allowFullscreen,
        parseHTML: () => this.options.allowFullscreen,
      },
      allow: {
        default:
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        parseHTML: (element) =>
          element.getAttribute("allow") ||
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      },
      title: {
        default: "Embedded content",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "iframe[src]",
        getAttrs: (element) => {
          const el = element as HTMLIFrameElement;
          const rawSrc = el.getAttribute("src");
          return {
            src: normalizeEmbedUrl(rawSrc),
            width: el.getAttribute("width") || "100%",
            height: el.getAttribute("height") || 315,
            frameborder: el.getAttribute("frameborder") || 0,
            referrerpolicy:
              el.getAttribute("referrerpolicy") || "strict-origin-when-cross-origin",
            allowfullscreen:
              el.hasAttribute("allowfullscreen") || this.options.allowFullscreen,
            allow:
              el.getAttribute("allow") ||
              "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
            title: el.getAttribute("title") || "Embedded content",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const normalizedSrc = normalizeEmbedUrl(HTMLAttributes.src);

    return [
      "div",
      { class: "notefast-embed-container" },
      [
        "iframe",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          src: normalizedSrc,
          class: "notefast-embed-iframe",
          referrerpolicy: "strict-origin-when-cross-origin",
          allow:
            HTMLAttributes.allow ||
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
          allowfullscreen: this.options.allowFullscreen ? "true" : undefined,
          frameborder: "0",
        }),
      ],
    ];
  },

  addCommands() {
    return {
      setIframe:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              ...options,
              src: normalizeEmbedUrl(options.src),
              referrerpolicy: "strict-origin-when-cross-origin",
            },
          });
        },
    };
  },
});
