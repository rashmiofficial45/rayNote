import { nextMenuIndex, revealMenuItem } from "../lib/menuNavigation";
import { Extension } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { SuggestionProps, SuggestionKeyDownProps, SuggestionOptions } from "@tiptap/suggestion";

export const internalNoteLinkPluginKey = new PluginKey("internalNoteLink");
import { ReactRenderer } from "@tiptap/react";
import { Editor, Range } from "@tiptap/core";
import tippy, { Instance as TippyInstance } from "tippy.js";
import {
  forwardRef,
  useLayoutEffect,
  useImperativeHandle,
  useState,
  useCallback,
  useRef,
} from "react";
import { FileText, Pin } from "lucide-react";
import { safeLocalStorageGetItem } from "../lib/storage";
import { getRecentNotes } from "../lib/db";
import { createInternalNoteUrl } from "../lib/linkUtils";

export interface InternalNoteItem {
  id: string;
  title: string;
  preview: string;
  is_pinned?: boolean;
}

export interface InternalNoteListProps {
  items: InternalNoteItem[];
  command: (item: InternalNoteItem) => void;
}

export interface InternalNoteListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

/**
 * Returns available notes for suggestion, checking synchronous localStorage cache first,
 * falling back to recent notes.
 */
let cachedNotesMemory: InternalNoteItem[] = [];

export function getCachedNotes(): InternalNoteItem[] {
  if (cachedNotesMemory.length > 0) return cachedNotesMemory;
  try {
    const raw = safeLocalStorageGetItem("notefast_cached_notes");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedNotesMemory = parsed.map((n: any) => ({
          id: n.id,
          title: n.title || "Untitled Note",
          preview: n.preview || "",
          is_pinned: Boolean(n.is_pinned),
        }));
        return cachedNotesMemory;
      }
    }
  } catch {}
  return [];
}

// Background refresh of note cache for suggestions
if (typeof window !== "undefined") {
  getRecentNotes(100)
    .then((notes) => {
      if (Array.isArray(notes)) {
        cachedNotesMemory = notes.map((n) => ({
          id: n.id,
          title: n.title || "Untitled Note",
          preview: n.preview || "",
          is_pinned: Boolean(n.is_pinned),
        }));
      }
    })
    .catch(() => {});
}

export const InternalNoteList = forwardRef<InternalNoteListRef, InternalNoteListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useLayoutEffect(() => {
      if (containerRef.current) {
        const itemEl = containerRef.current.children[selectedIndex + 1] as HTMLElement | undefined;
        revealMenuItem(containerRef.current, itemEl);
      }
    }, [selectedIndex]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command(item);
      },
      [command, items]
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;

        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          setSelectedIndex((prev) => nextMenuIndex(prev, items.length, 1, false));
          return true;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setSelectedIndex((prev) => nextMenuIndex(prev, items.length, -1, false));
          return true;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div
          ref={containerRef}
          role="menu"
          className="p-2.5 rounded-xl bg-[var(--surface-glass-elevated)] backdrop-blur-xl border border-[var(--border-subtle)] shadow-[var(--shadow-glass)] text-[var(--text-muted)] text-[12px] min-w-[200px]"
        >
          No matching notes found
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        role="menu"
        aria-label="Link to note"
        className="flex flex-col gap-0.5 p-1 rounded-xl bg-[var(--surface-glass-elevated)] backdrop-blur-xl border border-[var(--border-subtle)] shadow-[var(--shadow-glass)] text-[var(--text-primary)] text-[12px] min-w-[240px] max-w-[320px] max-h-[220px] overflow-y-auto"
      >
        <div className="px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          Link to note
        </div>
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                isSelected
                  ? "bg-[var(--btn-liquid-bg-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg-hover)]"
              }`}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <FileText size={14} className="text-[var(--color-accent)] shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="truncate font-medium text-[12px] leading-tight">
                  {item.title || "Untitled Note"}
                </span>
                {item.preview && (
                  <span className="truncate text-[10px] text-[var(--text-muted)] leading-tight mt-0.5">
                    {item.preview}
                  </span>
                )}
              </div>
              {item.is_pinned && (
                <Pin size={11} className="text-[var(--color-accent)] shrink-0 ml-1" />
              )}
            </button>
          );
        })}
      </div>
    );
  }
);
InternalNoteList.displayName = "InternalNoteList";

export const InternalNoteLink = Extension.create({
  name: "internalNoteLink",

  addOptions() {
    return {
      suggestion: {
        char: "[[",
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: InternalNoteItem;
        }) => {
          const finalTitle = props.title?.trim() || "Untitled Note";
          const href = createInternalNoteUrl(props.id);

          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: "text",
                text: finalTitle,
                marks: [{ type: "link", attrs: { href } }],
              },
              {
                type: "text",
                text: " ",
              },
            ])
            .run();
        },
        items: ({ query }: { query: string }) => {
          const notes = getCachedNotes();
          const q = (query || "").toLowerCase().trim();
          if (!q) {
            return notes.slice(0, 8);
          }
          return notes
            .filter((n) =>
              n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q)
            )
            .slice(0, 8);
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(InternalNoteList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                zIndex: 10006,
                animation: false,
              });
            },
            onUpdate: (props: SuggestionProps) => {
              component?.updateProps(props);
              if (props.clientRect && popup?.[0]) {
                popup[0].setProps({
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                });
              }
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }
              return (component?.ref as any)?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup?.[0]?.destroy();
              component?.destroy();
            },
          };
        },
      } as Partial<SuggestionOptions>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        pluginKey: internalNoteLinkPluginKey,
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
