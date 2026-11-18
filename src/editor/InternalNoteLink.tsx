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
import { getAllNotes } from "../lib/db";
import { computeSlashMenuPlacementAndHeight } from "./SlashCommand";
import { createInternalNoteUrl } from "../lib/linkUtils";
import { normalizeQuery, scoreDocumentCandidate } from "../lib/searchRanking";

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

export const InternalNoteList = forwardRef<InternalNoteListRef, InternalNoteListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectionFromPointer = useRef(false);
    const mousePosition = useRef<{ x: number; y: number } | null>(null);
    const itemIds = items.map((item) => item.id).join("\0");

    useLayoutEffect(() => {
      setSelectedIndex(0);
    }, [itemIds]);

    useLayoutEffect(() => {
      if (selectionFromPointer.current) {
        selectionFromPointer.current = false;
        return;
      }
      if (containerRef.current) {
        if (selectedIndex === 0) {
          containerRef.current.scrollTop = 0;
          return;
        }
        const itemEl = containerRef.current.children[selectedIndex] as HTMLElement | undefined;
        revealMenuItem(containerRef.current, itemEl);
      }
    }, [selectedIndex, itemIds]);

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

    return (
      <div className="internal-note-picker">
        <div className="internal-note-picker-heading">Link to note</div>
        {items.length ? (
          <div ref={containerRef} className="internal-note-picker-list" role="menu" aria-label="Link to note">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="internal-note-picker-row"
                data-active={index === selectedIndex}
                aria-label={item.title || "Untitled Note"}
                onClick={() => selectItem(index)}
                onMouseMove={(event) => {
                  const previous = mousePosition.current;
                  mousePosition.current = { x: event.clientX, y: event.clientY };
                  if (previous && (Math.abs(previous.x - event.clientX) > 3 || Math.abs(previous.y - event.clientY) > 3)) {
                    selectionFromPointer.current = true;
                    setSelectedIndex(index);
                  }
                }}
              >
                <FileText size={15} aria-hidden="true" />
                <span title={item.title || "Untitled Note"}>{item.title || "Untitled Note"}</span>
                {item.is_pinned && <Pin size={12} aria-hidden="true" />}
              </button>
            ))}
          </div>
        ) : (
          <div className="internal-note-picker-empty" role="status">No matching notes found</div>
        )}
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
        allowSpaces: true,
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
        items: async ({ query }: { query: string }) => {
          let notes = getCachedNotes();
          try {
            notes = await getAllNotes();
            cachedNotesMemory = notes;
          } catch {
            // Keep the last available snapshot when the database is unavailable.
          }
          if (!normalizeQuery(query || "")) return notes;
          return notes
            .map((note, index) => ({
              note,
              index,
              ...scoreDocumentCandidate(query, {
                id: note.id,
                title: note.title || "Untitled Note",
                preview: note.preview || "",
                search_text: note.preview || "",
                updated_at: "1970-01-01T00:00:00Z",
                is_pinned: Boolean(note.is_pinned),
              }),
            }))
            .filter((result) => result.match_type !== "unmatched")
            .sort((a, b) => b.score - a.score || a.index - b.index)
            .map((result) => result.note);
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: TippyInstance[] | null = null;
          let latestProps: SuggestionProps | null = null;

          const updatePosition = (event?: Event) => {
            if (event?.target instanceof Node && component?.element.contains(event.target)) return;
            if (!latestProps?.clientRect || !popup?.[0]) return;
            const rect = latestProps.clientRect();
            const { placement, maxHeight } = computeSlashMenuPlacementAndHeight(
              rect, latestProps.items.length
            );
            const menu = component?.element.querySelector(".internal-note-picker") as HTMLElement | null;
            if (menu) menu.style.maxHeight = `${maxHeight}px`;
            popup[0].setProps({ placement, getReferenceClientRect: latestProps.clientRect as () => DOMRect });
          };

          return {
            onStart: (props: SuggestionProps) => {
              latestProps = props;
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
                arrow: false,
                zIndex: 10006,
                animation: false,
                offset: [0, 6],
                popperOptions: {
                  strategy: "fixed",
                  modifiers: [{ name: "preventOverflow", options: { boundary: "viewport", padding: 8, altAxis: true } }],
                },
              });
              updatePosition();
              window.addEventListener("resize", updatePosition);
              window.addEventListener("scroll", updatePosition, true);
            },
            onUpdate: (props: SuggestionProps) => {
              latestProps = props;
              component?.updateProps(props);
              updatePosition();
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }
              return (component?.ref as any)?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              window.removeEventListener("resize", updatePosition);
              window.removeEventListener("scroll", updatePosition, true);
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
