import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const clickSelectionPluginKey = new PluginKey("clickSelection");

export interface VisualLineRange {
  from: number;
  to: number;
}

/**
 * Finds the visual (wrapped) line range containing pos in the given view.
 * For code blocks, splits on logical line boundaries ('\n').
 * For wrapped text blocks (paragraphs, headings, list items, blockquotes),
 * walks backwards and forwards until coordsAtPos vertical coordinates change.
 */
export function findVisualLineRange(view: EditorView, pos: number): VisualLineRange {
  const doc = view.state.doc;
  const $pos = doc.resolve(Math.min(pos, doc.content.size));

  // 1. Check if inside a code block -> split on logical line ('\n')
  for (let d = $pos.depth; d > 0; d--) {
    const parent = $pos.node(d);
    if (parent.type.name === "codeBlock") {
      const blockStart = $pos.start(d);
      const text = parent.textContent;
      const offset = Math.max(0, Math.min(pos - blockStart, text.length));

      const prevNewline = text.lastIndexOf("\n", Math.max(0, offset - 1));
      const lineStart = prevNewline === -1 ? blockStart : blockStart + prevNewline + 1;

      const nextNewline = text.indexOf("\n", offset);
      const lineEnd = nextNewline === -1 ? blockStart + text.length : blockStart + nextNewline;

      return { from: lineStart, to: lineEnd };
    }
  }

  // 2. Regular textblock (paragraph, heading, listItem text, blockquote)
  let depth = $pos.depth;
  while (depth > 0 && !$pos.node(depth).isTextblock) {
    depth--;
  }

  const blockStart = $pos.start(depth);
  const blockEnd = $pos.end(depth);
  if (blockStart >= blockEnd) {
    return { from: blockStart, to: blockEnd };
  }

  // Probe vertical coordinate at pos
  const clickCoords = view.coordsAtPos(pos);
  const targetTop = clickCoords.top;
  const targetBottom = clickCoords.bottom;
  const targetMidY = (targetTop + targetBottom) / 2;
  const lineTolerance = 4; // px tolerance for vertical line alignment

  // Walk backwards to find start of visual line
  let lineStart = pos;
  while (lineStart > blockStart) {
    // Check coords facing forward from lineStart - 1
    const prevCoords = view.coordsAtPos(lineStart - 1, 1);
    const isSameLine =
      Math.abs(prevCoords.top - targetTop) <= lineTolerance ||
      (prevCoords.top <= targetMidY && prevCoords.bottom >= targetMidY);

    if (!isSameLine) {
      break;
    }
    lineStart--;
  }

  // Walk forwards to find end of visual line
  let lineEnd = pos;
  while (lineEnd < blockEnd) {
    // Check coords facing backward from lineEnd + 1
    const nextCoords = view.coordsAtPos(lineEnd + 1, -1);
    const isSameLine =
      Math.abs(nextCoords.top - targetTop) <= lineTolerance ||
      (nextCoords.top <= targetMidY && nextCoords.bottom >= targetMidY);

    if (!isSameLine) {
      break;
    }
    lineEnd++;
  }

  return { from: lineStart, to: lineEnd };
}

/**
 * Finds the entire enclosing textblock range ($pos.start() to $pos.end()).
 */
export function findParagraphRange(view: EditorView, pos: number): { from: number; to: number } {
  const doc = view.state.doc;
  const $pos = doc.resolve(Math.min(pos, doc.content.size));

  let depth = $pos.depth;
  while (depth > 0 && !$pos.node(depth).isTextblock) {
    depth--;
  }

  return {
    from: $pos.start(depth),
    to: $pos.end(depth),
  };
}

export interface ClickTrackerState {
  lastClickTime: number;
  lastClickX: number;
  lastClickY: number;
  count: number;
}

export const clickTracker: ClickTrackerState = {
  lastClickTime: 0,
  lastClickX: 0,
  lastClickY: 0,
  count: 0,
};

export function registerClick(
  x: number,
  y: number,
  time: number = Date.now(),
  tracker: ClickTrackerState = clickTracker
): number {
  const dt = time - tracker.lastClickTime;
  const dist = Math.hypot(x - tracker.lastClickX, y - tracker.lastClickY);

  if (dt <= 400 && dist <= 4) {
    tracker.count++;
  } else {
    tracker.count = 1;
  }

  tracker.lastClickTime = time;
  tracker.lastClickX = x;
  tracker.lastClickY = y;

  return tracker.count;
}

export const ClickSelectionExtension = Extension.create({
  name: "clickSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: clickSelectionPluginKey,
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              if (event.button !== 0) return false;

              const count = registerClick(event.clientX, event.clientY);

              // ── Count 3: Triple Click -> Visual Line Selection ──────────
              if (count === 3) {
                event.preventDefault();
                event.stopPropagation();

                const posAt = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (posAt) {
                  const range = findVisualLineRange(view, posAt.pos);
                  if (range.to >= range.from) {
                    const tr = view.state.tr.setSelection(
                      TextSelection.create(view.state.doc, range.from, range.to)
                    );
                    view.dispatch(tr);
                    view.focus();
                    return true;
                  }
                }
                return false;
              }

              // ── Count 4+: Quadruple Click -> Entire Paragraph Selection ──
              if (count >= 4) {
                event.preventDefault();
                event.stopPropagation();

                const posAt = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (posAt) {
                  const range = findParagraphRange(view, posAt.pos);
                  if (range.to >= range.from) {
                    const tr = view.state.tr.setSelection(
                      TextSelection.create(view.state.doc, range.from, range.to)
                    );
                    view.dispatch(tr);
                    view.focus();
                    return true;
                  }
                }
                return false;
              }

              return false;
            },
          },

          handleTripleClick(view, pos, event) {
            // Also implement handleTripleClick so ProseMirror's internal triple-click
            // never falls back to selecting the whole paragraph.
            event.preventDefault();
            const range = findVisualLineRange(view, pos);
            if (range.to >= range.from) {
              const tr = view.state.tr.setSelection(
                TextSelection.create(view.state.doc, range.from, range.to)
              );
              view.dispatch(tr);
              view.focus();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
