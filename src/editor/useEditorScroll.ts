import { Editor } from "@tiptap/core";

export function useEditorScroll(
  _editor: Editor | null,
  _scrollContainerRef: React.RefObject<HTMLElement | null>
) {
  // Edge auto-scrolling and drag interactions are cleanly handled by useBlockSelection
  // without conflicting event loops or layout thrashing.
}
