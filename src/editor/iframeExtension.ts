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
  try {
    const source = url.trim();
    const parsed = new URL(/^(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(source) ? `https://${source}` : source);
    if (!["https:", "http:"].includes(parsed.protocol)) return "";
    const host = parsed.hostname.toLowerCase();
    let videoId: string | null = null;
    if (host === "youtu.be" || host === "www.youtu.be") {
      videoId = parsed.pathname.split("/")[1];
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host)) {
      videoId = parsed.pathname === "/watch"
        ? parsed.searchParams.get("v")
        : parsed.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ?? null;
    }
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      parsed.searchParams.delete("v");
      const query = parsed.searchParams.toString();
      return `https://www.youtube-nocookie.com/embed/${videoId}${query ? `?${query}` : ""}`;
    }
    return parsed.href;
  } catch {
    return "";
  }
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
          const src = normalizeEmbedUrl(el.getAttribute("src"));
          if (!src) return false;
          return {
            src,
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
          src: normalizedSrc || undefined,
          sandbox: "allow-scripts allow-presentation",
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
          const src = normalizeEmbedUrl(options.src);
          if (!src) return false;
          return commands.insertContent({
            type: this.name,
            attrs: {
              ...options,
              src,
              referrerpolicy: "strict-origin-when-cross-origin",
            },
          });
        },
    };
  },
});
