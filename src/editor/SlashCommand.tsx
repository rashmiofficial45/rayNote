import { nextMenuIndex, revealMenuItem } from "../lib/menuNavigation";
import { getStoredCommandsConfig } from "../lib/commandsConfig";
import { Extension } from "@tiptap/react";
import Suggestion, { SuggestionProps, SuggestionKeyDownProps, SuggestionOptions, findSuggestionMatch } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { Editor, Range } from "@tiptap/core";
import "@tiptap/extension-underline";
import tippy, { Instance as TippyInstance } from "tippy.js";
import {
  forwardRef,
  useLayoutEffect,
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
  Code,
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
  id?: string;
  title: string;
  badge?: string;
  aliases: string[];
  icon: React.ReactNode;
  command: (props: { editor: Editor; range: Range }) => void;
}

export const ALL_COMMAND_ITEMS: CommandItem[] = [
  {
    id: "heading1",
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
    id: "heading2",
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
    id: "heading3",
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
    id: "checklist",
    title: "Task List",
    badge: "todo",
    aliases: ["todo", "task", "tasks", "checklist", "check"],
    icon: <CheckSquare size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    id: "bullet_list",
    title: "Bullet List",
    badge: "bullet",
    aliases: ["bullet", "bullets", "ul", "list"],
    icon: <List size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    id: "ordered_list",
    title: "Numbered List",
    badge: "number",
    aliases: ["number", "numbered", "num", "ordered", "ol", "1."],
    icon: <ListOrdered size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    id: "divider",
    title: "Divider",
    badge: "divider",
    aliases: ["divider", "hr", "line", "rule", "separator"],
    icon: <Minus size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    id: "code_block",
    title: "Code Block",
    badge: "code",
    aliases: ["code", "codeblock", "pre"],
    icon: <Code2 size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    id: "code",
    title: "Inline Code",
    badge: "inline",
    aliases: ["inline", "code", "inlinecode", "ic"],
    icon: <Code size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCode().run();
    },
  },
  {
    id: "blockquote",
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
    id: "bold",
    title: "Bold",
    badge: "bold",
    aliases: ["bold", "b"],
    icon: <Bold size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBold().run();
    },
  },
  {
    id: "italic",
    title: "Italic",
    badge: "italic",
    aliases: ["italic", "i", "em"],
    icon: <Italic size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleItalic().run();
    },
  },
  {
    id: "underline",
    title: "Underline",
    badge: "underline",
    aliases: ["underline", "u"],
    icon: <UnderlineIcon size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleUnderline().run();
    },
  },
  {
    id: "strike",
    title: "Strikethrough",
    badge: "strike",
    aliases: ["strike", "strikethrough", "del"],
    icon: <Strikethrough size={13} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleStrike().run();
    },
  },
  {
    id: "highlight",
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

export interface CommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

export interface CommandListRef {
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

export const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [prevItems, setPrevItems] = useState(items);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
    const selectionFromPointer = useRef(false);
    const ignorePointerRef = useRef<boolean>(false);

    // Synchronously reset selectedIndex when items list changes to avoid stale selection lag
    if (items !== prevItems) {
      setPrevItems(items);
      setSelectedIndex(0);
    }

    useLayoutEffect(() => {
      if (selectionFromPointer.current) {
        selectionFromPointer.current = false;
        return;
      }
      const container = containerRef.current;
      if (!container) return;
      if (selectedIndex === 0) {
        container.scrollTop = 0;
        return;
      }
      if (selectedIndex === items.length - 1) {
        container.scrollTop = container.scrollHeight;
        return;
      }
      const selectedEl = container.children[selectedIndex] as HTMLElement;
      revealMenuItem(container, selectedEl);
    }, [selectedIndex, items]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) {
          command(item);
        }
      },
      [items, command]
    );

    const handlePointerAction = useCallback((e: React.MouseEvent, index: number) => {
      if (ignorePointerRef.current) {
        if (!lastMousePosRef.current) {
          lastMousePosRef.current = { x: e.clientX, y: e.clientY };
          return;
        }
        const dx = Math.abs(e.clientX - lastMousePosRef.current.x);
        const dy = Math.abs(e.clientY - lastMousePosRef.current.y);
        if (dx <= 2 && dy <= 2) {
          return;
        }
        ignorePointerRef.current = false;
      }

      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      if (index !== selectedIndex) {
        selectionFromPointer.current = true;
        setSelectedIndex(index);
      }
    }, [selectedIndex]);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
          if (items.length === 0) return false;

          if (event.key === "ArrowUp") {
            ignorePointerRef.current = true;
            setSelectedIndex((prev) => nextMenuIndex(prev, items.length, -1, event.repeat));
            return true;
          }
          if (event.key === "ArrowDown") {
            ignorePointerRef.current = true;
            setSelectedIndex((prev) => nextMenuIndex(prev, items.length, 1, event.repeat));
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
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;

          return (
            <button
              key={item.title}
              type="button"
              className={`slash-command-item ${isSelected ? "is-selected" : ""}`}
              onClick={() => selectItem(index)}
              onMouseMove={(e) => handlePointerAction(e, index)}
            >
              <div className="slash-command-item-left">
                <span className="slash-command-item-icon">{item.icon}</span>
                <span className="slash-command-item-title">{item.title}</span>
              </div>
              {item.badge && (
                <span className="slash-command-item-badge">/{item.badge}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }
);

CommandList.displayName = "CommandList";

export function computeSlashMenuPlacementAndHeight(
  clientRect: DOMRect | null | undefined,
  itemCount: number,
  windowHeight: number = typeof window !== "undefined" ? window.innerHeight : 600
): { placement: "bottom-start" | "top-start"; maxHeight: number } {
  const margin = 12;
  const offset = 6;
  const contentHeight = itemCount > 0 ? itemCount * 28 + 12 : 40;
  // Comfortable height cap: ~348px (shows ~12 items comfortably with scrollbar)
  const maxMenuCap = 348;
  const idealHeight = Math.min(contentHeight, maxMenuCap);

  if (!clientRect) {
    return { placement: "bottom-start", maxHeight: idealHeight };
  }

  const spaceBelow = Math.max(0, windowHeight - clientRect.bottom - offset - margin);
  const spaceAbove = Math.max(0, clientRect.top - offset - margin);

  let placement: "bottom-start" | "top-start" = "bottom-start";
  let availableSpace = spaceBelow;

  if (spaceBelow >= idealHeight) {
    // Fits comfortably below
    placement = "bottom-start";
    availableSpace = spaceBelow;
  } else if (spaceAbove >= idealHeight) {
    // Insufficient space below, but fits comfortably above -> flip to top
    placement = "top-start";
    availableSpace = spaceAbove;
  } else {
    // Neither side fits idealHeight: choose whichever side has more usable space
    if (spaceAbove > spaceBelow) {
      placement = "top-start";
      availableSpace = spaceAbove;
    } else {
      placement = "bottom-start";
      availableSpace = spaceBelow;
    }
  }

  // Constrain maxHeight:
  // Cannot exceed idealHeight (capped at 250px so it's half-sized with scrollbar,
  // or exact contentHeight for filtered queries like /he)
  // and cannot exceed availableSpace on chosen side.
  const maxHeight =
    idealHeight <= availableSpace
      ? idealHeight
      : Math.max(Math.min(40, idealHeight), availableSpace);

  return { placement, maxHeight };
}

const renderItems = () => {
  let component: ReactRenderer<CommandListRef> | null = null;
  let popup: TippyInstance[] | null = null;
  let latestProps: SuggestionProps<CommandItem> | null = null;

  const updateMenuSizingAndPosition = (props: SuggestionProps<CommandItem>) => {
    latestProps = props;
    if (!props.clientRect || !popup?.[0]) return;
    const rect = props.clientRect();
    const itemCount = props.items?.length ?? 0;
    const { placement, maxHeight } = computeSlashMenuPlacementAndHeight(rect, itemCount);

    const menuEl = component?.element?.querySelector(".slash-command-menu") as HTMLElement | null;
    if (menuEl) {
      menuEl.style.maxHeight = `${maxHeight}px`;
    }

    const getReferenceClientRect = () => props.clientRect?.() || new DOMRect();
    popup[0].setProps({
      placement,
      getReferenceClientRect,
    });
  };

  const handleWindowResizeOrScroll = () => {
    if (latestProps) {
      updateMenuSizingAndPosition(latestProps);
    }
  };

  return {
    onStart: (props: SuggestionProps<CommandItem>) => {
      latestProps = props;
      component = new ReactRenderer(CommandList, {
        props,
        editor: props.editor,
      });

      if (!props.clientRect) return;

      const rect = props.clientRect();
      const itemCount = props.items?.length ?? 0;
      const { placement, maxHeight } = computeSlashMenuPlacementAndHeight(rect, itemCount);

      const menuEl = component.element?.querySelector(".slash-command-menu") as HTMLElement | null;
      if (menuEl) {
        menuEl.style.maxHeight = `${maxHeight}px`;
      }

      const getReferenceClientRect = () => props.clientRect?.() || new DOMRect();

      popup = tippy("body", {
        getReferenceClientRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: "manual",
        placement,
        offset: [0, 6],
        animation: false,
        duration: [0, 0],
        popperOptions: {
          strategy: "fixed",
          modifiers: [
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

      window.addEventListener("resize", handleWindowResizeOrScroll);
      window.addEventListener("scroll", handleWindowResizeOrScroll, { capture: true, passive: true });
    },
    onUpdate(props: SuggestionProps<CommandItem>) {
      latestProps = props;
      component?.updateProps(props);
      updateMenuSizingAndPosition(props);
    },
    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === "Escape") {
        popup?.[0]?.hide();
        return true;
      }
      return component?.ref?.onKeyDown(props) ?? false;
    },
    onExit() {
      window.removeEventListener("resize", handleWindowResizeOrScroll);
      window.removeEventListener("scroll", handleWindowResizeOrScroll, { capture: true });
      popup?.[0]?.destroy();
      component?.destroy();
      latestProps = null;
    },
  };
};

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        findSuggestionMatch: (config: Parameters<typeof findSuggestionMatch>[0]) => {
          const trigger = getStoredCommandsConfig().find(c => c.id === "slash")?.hotkey;
          return findSuggestionMatch({ ...config, char: trigger?.length === 1 ? trigger : "/" });
        },
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: CommandItem;
        }) => {
          props.command({ editor, range });
        },
        allow: () => getStoredCommandsConfig().find(c => c.id === "slash")?.enabled !== false,
        items: ({ query }: { query: string }) => {
          const enabled = getStoredCommandsConfig().find(c => c.id === "tables")?.enabled !== false;
          const commands = ALL_COMMAND_ITEMS.filter(item => enabled || !["Table", "Video"].includes(item.title));
          const q = query.toLowerCase().trim();
          if (!q) {
            // Natural initial order: Heading 1 is first
            return commands;
          }

          return commands
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
