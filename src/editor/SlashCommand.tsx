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
} from "lucide-react";

export interface CommandItem {
  title: string;
  badge?: string;
  aliases: string[];
  icon: React.ReactNode;
  command: (props: { editor: any; range: any }) => void;
}

const ALL_COMMAND_ITEMS: CommandItem[] = [
  {
    title: "Heading 1",
    badge: "h1",
    aliases: ["h1", "heading1", "1"],
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
    aliases: ["h2", "heading2", "2"],
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
    aliases: ["h3", "heading3", "3"],
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
    aliases: ["todo", "task", "tasks", "checklist", "check"],
    icon: <CheckSquare size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Bullet List",
    badge: "bullet",
    aliases: ["bullet", "bullets", "ul", "list"],
    icon: <List size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    badge: "number",
    aliases: ["number", "numbered", "num", "ordered", "ol", "1."],
    icon: <ListOrdered size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Divider",
    badge: "divider",
    aliases: ["divider", "hr", "line", "rule", "separator"],
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
    badge: "text",
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
    aliases: ["strike", "strikethrough", "del"],
    icon: <Strikethrough size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleStrike().run();
    },
  },
  {
    title: "Highlight",
    badge: "highlight",
    aliases: ["highlight", "mark", "hl"],
    icon: <Highlighter size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleHighlight().run();
    },
  },
  {
    title: "Table",
    badge: "table",
    aliases: ["table", "grid"],
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
];

interface CommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

function scoreItem(item: CommandItem, q: string): number {
  const title = item.title.toLowerCase();
  const badge = item.badge?.toLowerCase() || "";
  const aliases = (item.aliases || []).map((a) => a.toLowerCase());

  // 1. Exact match on badge or alias (e.g. "todo", "h1", "h2", "hr", "b", "p", "number")
  if (badge === q || aliases.includes(q)) return 100;
  // 2. Exact match on title
  if (title === q) return 95;
  // 3. Title starts with query (e.g. "t" matches "Task List", "Table", "Text")
  if (title.startsWith(q)) return 90;
  // 4. Badge starts with query
  if (badge.startsWith(q)) return 85;

  // 5. For queries with 2+ characters: any alias starts with query (e.g. "num" for Numbered List, "to" for Task List)
  if (q.length >= 2 && aliases.some((a) => a.startsWith(q))) return 80;

  // 6. Substring match ONLY for queries >= 3 chars
  if (q.length >= 3) {
    if (title.includes(q)) return 50;
    if (aliases.some((a) => a.includes(q))) return 40;
  }
  return 0;
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [prevItems, setPrevItems] = useState(items);
    const containerRef = useRef<HTMLDivElement>(null);
    const mountTimeRef = useRef(Date.now());
    const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);

    // Synchronously reset selectedIndex when items list changes to avoid stale selection lag
    if (items !== prevItems) {
      setPrevItems(items);
      setSelectedIndex(0);
    }

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

    const handleMouseMove = useCallback((e: React.MouseEvent, index: number) => {
      // Ignore initial synthetic mouse events right after menu appears so a mouse
      // resting on screen does not automatically select the option below (e.g. Heading 2)
      if (Date.now() - mountTimeRef.current < 150) return;

      // Only change selection if mouse coordinates actually changed
      if (
        lastMousePosRef.current &&
        lastMousePosRef.current.x === e.clientX &&
        lastMousePosRef.current.y === e.clientY
      ) {
        return;
      }
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      setSelectedIndex(index);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
          if (event.key === "ArrowUp") {
            setSelectedIndex((prev) => Math.max(0, prev - 1));
            return true;
          }
          if (event.key === "ArrowDown") {
            setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
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
      }),
      [items, selectItem, selectedIndex]
    );

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
            onMouseMove={(e) => handleMouseMove(e, index)}
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
        animation: false,
        duration: [0, 0],
        popperOptions: {
          strategy: "fixed",
          modifiers: [
            {
              name: "flip",
              options: {
                fallbackPlacements: ["top-start", "bottom-end", "top-end"],
                padding: 8,
              },
            },
            {
              name: "preventOverflow",
              options: {
                boundary: "viewport",
                padding: 8,
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
          if (!q) {
            // Natural initial order: Heading 1 is first
            return ALL_COMMAND_ITEMS;
          }

          return ALL_COMMAND_ITEMS
            .map((item) => ({ item, score: scoreItem(item, q) }))
            .filter((res) => res.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((res) => res.item);
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
