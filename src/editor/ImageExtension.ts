import { Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageComponent } from "./ImageComponent";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { selectParagraphAfterDivider } from "./horizontalRuleExtension";

export interface SetImageOptions {
  src: string;
  alt?: string;
  title?: string;
  width?: string;
  height?: string;
  alignment?: "left" | "center" | "right";
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      /**
       * Add an image to the document
       */
      setImage: (options: SetImageOptions) => ReturnType;
    };
  }
}

export interface ImageOptions {
  inline: boolean;
  allowBase64: boolean;
  HTMLAttributes: Record<string, any>;
}

export const ImageExtension = Node.create<ImageOptions>({
  name: "image",

  addOptions() {
    return {
      inline: false,
      allowBase64: true,
      HTMLAttributes: {},
    };
  },

  inline() {
    return this.options.inline;
  },

  group() {
    return this.options.inline ? "inline" : "block";
  },

  draggable: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute("src"),
        renderHTML: (attributes) => {
          if (!attributes.src) return {};
          return { src: attributes.src };
        },
      },
      alt: {
        default: "",
        parseHTML: (element) => element.getAttribute("alt") || "",
        renderHTML: (attributes) => {
          if (!attributes.alt) return {};
          return { alt: attributes.alt };
        },
      },
      title: {
        default: "",
        parseHTML: (element) => element.getAttribute("title") || "",
        renderHTML: (attributes) => {
          if (!attributes.title) return {};
          return { title: attributes.title };
        },
      },
      width: {
        default: "100%",
        parseHTML: (element) => {
          const styleWidth = element.style?.width;
          if (styleWidth) return styleWidth;
          const attrWidth = element.getAttribute("width") || element.getAttribute("data-width");
          if (attrWidth) {
            return attrWidth.includes("%") || attrWidth.includes("px") ? attrWidth : `${attrWidth}px`;
          }
          return "100%";
        },
        renderHTML: (attributes) => {
          const width = attributes.width || "100%";
          return {
            "data-width": width,
            style: `width: ${width}`,
          };
        },
      },
      alignment: {
        default: "center",
        parseHTML: (element) => {
          return (
            element.getAttribute("data-alignment") ||
            (element.style?.textAlign as any) ||
            "center"
          );
        },
        renderHTML: (attributes) => {
          const alignment = attributes.alignment || "center";
          return {
            "data-alignment": alignment,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[src]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /!\[(.*?)\]\((.*?)\)$/,
        type: this.type,
        getAttributes: (match) => {
          const [, alt, src] = match;
          return { src, alt };
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleTextInput(view, _from, _to, text) {
          const { selection } = view.state;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return false;
          const tr = view.state.tr;
          if (!selectParagraphAfterDivider(tr, selection.from)) return false;
          view.dispatch(tr.insertText(text).scrollIntoView());
          return true;
        },
        handleDOMEvents: {
          beforeinput(view, event) {
            const { selection } = view.state;
            if (!event.inputType.startsWith("insert") || !(selection instanceof NodeSelection) || selection.node.type.name !== "image") return false;
            const tr = view.state.tr;
            if (!selectParagraphAfterDivider(tr, selection.from)) return false;
            view.dispatch(tr.scrollIntoView());
            return false;
          },
        },
      },
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageComponent);
  },
});
