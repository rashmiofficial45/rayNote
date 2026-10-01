import { Extension } from "@tiptap/react";
import Suggestion, { SuggestionOptions } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { Instance as TippyInstance } from "tippy.js";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code2,
  Minus,
  Type,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  Table as TableIcon,
  Video,
} from "lucide-react";

export interface CommandItem {
  title: string;
  badge?: string;
  aliases: string[];
  icon: React.ReactNode;
  command: (props: { editor: any; range: any }) => void;
}

const getSuggestionItems = (): CommandItem[] => [
  {
    title: "Heading 1",
    badge: "h1",
    aliases: ["h1", "heading1", "header1", "title"],
    icon: <Heading1 size={13} />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 1 })
        .run();
    },
  },
  {
    title: "Heading 2",
    badge: "h2",
    aliases: ["h2", "heading2", "header2", "sub"],
    icon: <Heading2 size={13} />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 2 })
        .run();
    },
  },
  {
    title: "Heading 3",
    badge: "h3",
    aliases: ["h3", "heading3", "header3"],
    icon: <Heading3 size={13} />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 3 })
        .run();
    },
  },
  {
    title: "Task List",
    badge: "todo",
    aliases: ["todo", "task", "tasks", "checklist", "check", "box"],
    icon: <CheckSquare size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Bullet List",
    badge: "bullet",
    aliases: ["bullet", "list", "ul", "bullets"],
    icon: <List size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    badge: "num",
    aliases: ["numbered", "num", "ordered", "ol", "1."],
    icon: <ListOrdered size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Divider",
    badge: "hr",
    aliases: ["hr", "divider", "line", "rule", "ruler", "separator", "cross", "crossline"],
    icon: <Minus size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: "Code Block",
    badge: "code",
    aliases: ["code", "codeblock", "pre"],
    icon: <Code2 size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: "Quote",
    badge: "quote",
    aliases: ["quote", "blockquote", "bq"],
    icon: <Quote size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Text",
    badge: "p",
    aliases: ["text", "paragraph", "p", "plain"],
    icon: <Type size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: "Bold",
    badge: "bold",
    aliases: ["bold", "b"],
    icon: <Bold size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBold().run();
    },
  },
  {
    title: "Italic",
    badge: "italic",
    aliases: ["italic", "i", "em"],
    icon: <Italic size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleItalic().run();
    },
  },
  {
    title: "Underline",
    badge: "underline",
    aliases: ["underline", "u"],
    icon: <UnderlineIcon size={13} />,
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).toggleUnderline().run();
    },
  },
  {
    title: "Strikethrough",
    badge: "strike",
    aliases: ["strike", "strikethrough", "del", "cross", "crossout"],
    icon: <Strikethrough size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleStrike().run();
    },
  },
  {
    title: "Highlight",
    badge: "mark",
    aliases: ["highlight", "mark", "hl"],
    icon: <Highlighter size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleHighlight().run();
    },
  },
  {
    title: "Table",
    badge: "table",
    aliases: ["table", "grid", "rows", "columns", "tabular"],
    icon: <TableIcon size={13} />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
  {
    title: "Embed Video / Iframe",
    badge: "embed",
    aliases: ["embed", "youtube", "video", "iframe", "media"],
    icon: <Video size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const input = window.prompt("Enter YouTube URL or <iframe> embed code:");
      if (!input || !input.trim()) return;
      const trimmed = input.trim();
      const iframeSrcMatch = trimmed.match(/src=["']([^"']+)["']/i);
      if (trimmed.startsWith("<iframe") && iframeSrcMatch) {
        (editor.chain().focus() as any).setIframe({ src: iframeSrcMatch[1] }).run();
      } else if (trimmed.includes("youtube.com") || trimmed.includes("youtu.be")) {
        (editor.chain().focus() as any).setYoutubeVideo({ src: trimmed }).run();
      } else {
        (editor.chain().focus() as any).setIframe({ src: trimmed }).run();
      }
    },
  },
];

interface CommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const selectedEl = container.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) {
          command(item);
        }
      },
      [items, command]
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) =>
            prev <= 0 ? items.length - 1 : prev - 1
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) =>
            prev >= items.length - 1 ? 0 : prev + 1
          );
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          selectItem(selectedIndex);
          return true;
        }
        // If single match or exact hit, allow Space to trigger immediate selection
        if (event.key === " " && items.length === 1) {
          selectItem(0);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="slash-command-menu" ref={containerRef}>
          <div className="slash-command-empty">No matching commands</div>
        </div>
      );
    }

    return (
      <div className="slash-command-menu" ref={containerRef}>
        {items.map((item, index) => (
          <button
            key={item.title}
            className={`slash-command-item ${
              index === selectedIndex ? "is-selected" : ""
            }`}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div className="slash-command-item-icon">{item.icon}</div>
            <span className="slash-command-item-title">{item.title}</span>
            {item.badge && (
              <span className="slash-command-item-badge">/{item.badge}</span>
            )}
          </button>
        ))}
      </div>
    );
  }
);

CommandList.displayName = "CommandList";

const renderItems = () => {
  let component: ReactRenderer<CommandListRef> | null = null;
  let popup: TippyInstance[] | null = null;

  return {
    onStart: (props: any) => {
      component = new ReactRenderer(CommandList, {
        props,
        editor: props.editor,
      });

      if (!props.clientRect) return;

      popup = tippy("body", {
        getReferenceClientRect: props.clientRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: "manual",
        placement: "bottom-start",
        offset: [0, 6],
        popperOptions: {
          modifiers: [
            {
              name: "flip",
              options: {
                fallbackPlacements: ["top-start", "bottom-end", "top-end"],
                padding: 10,
              },
            },
            {
              name: "preventOverflow",
              options: {
                boundary: "viewport",
                padding: 10,
                altAxis: true,
              },
            },
          ],
        },
      });
    },
    onUpdate(props: any) {
      component?.updateProps(props);
      if (!props.clientRect) return;
      popup?.[0]?.setProps({
        getReferenceClientRect: props.clientRect,
      });
    },
    onKeyDown(props: any) {
      if (props.event.key === "Escape") {
        popup?.[0]?.hide();
        return true;
      }
      return component?.ref?.onKeyDown(props) ?? false;
    },
    onExit() {
      popup?.[0]?.destroy();
      component?.destroy();
    },
  };
};

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        command: ({
          editor,
          range,
          props,
        }: {
          editor: any;
          range: any;
          props: CommandItem;
        }) => {
          props.command({ editor, range });
        },
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase().trim();
          const allItems = getSuggestionItems();
          if (!q) {
            // Minimalistic initial list: main block elements
            return allItems;
          }

          return allItems
            .filter((item) => {
              const title = item.title.toLowerCase();
              const badge = item.badge?.toLowerCase() || "";
              const aliases = item.aliases || [];

              // Exact match on badge or alias (e.g. "h1", "h2", "h3", "todo")
              if (badge === q || aliases.includes(q)) return true;
              // Starts with query on badge or alias
              if (badge.startsWith(q) || aliases.some((a) => a.startsWith(q))) return true;
              // Substring match on title or badge
              if (title.includes(q) || badge.includes(q)) return true;
              return false;
            })
            .sort((a, b) => {
              const aBadge = a.badge?.toLowerCase() || "";
              const bBadge = b.badge?.toLowerCase() || "";
              const aExact = aBadge === q || a.aliases.includes(q);
              const bExact = bBadge === q || b.aliases.includes(q);
              if (aExact && !bExact) return -1;
              if (!aExact && bExact) return 1;

              const aStarts = aBadge.startsWith(q) || a.aliases.some((al) => al.startsWith(q));
              const bStarts = bBadge.startsWith(q) || b.aliases.some((al) => al.startsWith(q));
              if (aStarts && !bStarts) return -1;
              if (!aStarts && bStarts) return 1;

              return 0;
            });
        },
        render: renderItems,
        allowSpaces: false,
      } as Partial<SuggestionOptions>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
