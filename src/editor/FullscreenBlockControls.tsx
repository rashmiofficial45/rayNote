import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Plus } from "lucide-react";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { blockSelectionPluginKey, getBlockDom, type BlockInfo } from "../extensions/BlockSelection";
import { getBlockSiblings, insertAdjacentBlock, isNoteTitle, moveBlockToBoundary } from "./fullscreenBlockActions";

interface Props {
  editor: Editor;
  zoomLevel?: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onMenu: (point: { x: number; y: number }) => void;
}

interface HoveredBlock extends BlockInfo {
  rect: DOMRect;
  element?: HTMLElement;
}

function firstLineCenter(element: HTMLElement, rect: DOMRect): number {
  const line = element.matches("li") ? element.querySelector(":scope > div > p, :scope > p") ?? element : element;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    const start = text.textContent?.search(/\S/) ?? -1;
    if (start < 0) continue;
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const first = range.getBoundingClientRect();
    if (first.height > 0) return first.top + first.height / 2;
  }
  return rect.top + Math.min(rect.height, 28) / 2;
}

interface DropIndicator {
  edge: number;
  top: number;
  height: number;
  left: number;
  width: number;
}

interface DragState {
  block: HoveredBlock;
  doc: ProseMirrorNode;
  pointerId: number;
  startY: number;
  pointerY: number;
  pointerX: number;
  started: boolean;
  scrollTop: number;
  rows: HoveredBlock[];
  boundary: number | null;
}

function hoveredBlock(editor: Editor, target: Element, pointerY: number): HoveredBlock | null {
  const { view } = editor;
  let item: HTMLElement | null = target.closest("li");
  if (!item && target.matches("ol, ul")) {
    const items = Array.from(target.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches("li"));
    item = items.reduce<HTMLElement | null>((closest, candidate) => {
      const distance = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return Math.max(rect.top - pointerY, 0, pointerY - rect.bottom);
      };
      return !closest || distance(candidate) < distance(closest) ? candidate : closest;
    }, null);
  }
  let element: Element | null = item && view.dom.contains(item) ? item : target;
  if (element !== item || !item) {
    while (element && element.parentElement !== view.dom) element = element.parentElement;
  }
  if (!(element instanceof HTMLElement) || element === view.dom) return null;
  try {
    const { doc } = view.state;
    const position = doc.resolve(view.posAtDOM(element, 0));
    const depth = item && element === item
      ? Array.from({ length: position.depth }, (_, index) => position.depth - index)
        .find((level) => ["listItem", "taskItem"].includes(position.node(level).type.name))
      : 1;
    if (!depth || position.depth < depth) {
      // Leaf blocks such as dividers have no interior ProseMirror position.
      const pos = view.posAtDOM(element, 0);
      const node = doc.nodeAt(pos);
      return node && view.nodeDOM(pos) === element ? { pos, node, nodeSize: node.nodeSize, rect: element.getBoundingClientRect(), element } : null;
    }
    const node = position.node(depth);
    return { pos: position.before(depth), node, nodeSize: node.nodeSize, rect: element.getBoundingClientRect(), element };
  } catch {
    return null;
  }
}

export function FullscreenBlockControls({ editor, zoomLevel = 1, scrollContainerRef, onMenu }: Props) {
  const [hover, setHover] = useState<HoveredBlock | null>(null);
  const [lineCenter, setLineCenter] = useState<number | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  const hoverEdgeRef = useRef<number | undefined>(undefined);
  hoverEdgeRef.current = hover?.rect.left;
  const previewRef = useRef<HTMLDivElement>(null);
  const previewSizeRef = useRef({ width: 0, height: 0 });
  const controlsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef(0);
  const suppressGripClick = useRef(false);

  const stopDrag = () => {
    cancelAnimationFrame(frameRef.current);
    dragRef.current = null;
    if (previewRef.current) {
      previewRef.current.hidden = true;
      previewRef.current.replaceChildren();
    }
    setIndicator(null);
  };

  useEffect(() => {
    const scroll = scrollContainerRef.current;
    if (!scroll) return;
    const onPointer = (event: PointerEvent) => {
      if (dragRef.current || !(event.target instanceof Element) || controlsRef.current?.contains(event.target)) return;
      const block = editor.view.dom.contains(event.target) ? hoveredBlock(editor, event.target, event.clientY) : null;
      if (!block) {
        const bounds = controlsRef.current?.getBoundingClientRect();
        if (bounds && event.clientY >= bounds.top - 4 && event.clientY <= bounds.bottom + 4 &&
            event.clientX >= bounds.left - 4 && event.clientX <= (hoverEdgeRef.current ?? bounds.right) + 5) return;
      }
      setHover((previous) => previous?.node === block?.node && previous?.rect.top === block?.rect.top ? previous : block);
    };
    const onLeave = (event: PointerEvent) => {
      if (!dragRef.current && !(event.relatedTarget instanceof Node && controlsRef.current?.contains(event.relatedTarget))) {
        setHover(null);
      }
    };
    const onScroll = () => {
      if (!dragRef.current) setHover(null);
    };
    const onUpdate = () => {
      if (dragRef.current) stopDrag();
      setHover(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stopDrag();
    };
    scroll.addEventListener("pointermove", onPointer);
    scroll.addEventListener("pointerleave", onLeave);
    scroll.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onUpdate);
    window.addEventListener("blur", onUpdate);
    window.addEventListener("keydown", onKey, true);
    editor.on("update", onUpdate);
    return () => {
      scroll.removeEventListener("pointermove", onPointer);
      scroll.removeEventListener("pointerleave", onLeave);
      scroll.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("blur", onUpdate);
      window.removeEventListener("keydown", onKey, true);
      editor.off("update", onUpdate);
      cancelAnimationFrame(frameRef.current);
      dragRef.current = null;
    };
  }, [editor, scrollContainerRef]);

  useLayoutEffect(() => {
    if (!hover?.element || !hover.element.isConnected) return;
    const rect = hover.element.getBoundingClientRect();
    setLineCenter(firstLineCenter(hover.element, rect));
    if (rect.left !== hover.rect.left || rect.top !== hover.rect.top) {
      setHover({ ...hover, rect });
    }
  }, [hover, zoomLevel]);

  const openMenu = () => {
    if (!hover || isNoteTitle(hover) || editor.state.doc.nodeAt(hover.pos) !== hover.node) return;
    const tr = editor.state.tr.setMeta(blockSelectionPluginKey, {
      anchor: hover.pos, head: hover.pos, selectedPositions: [hover.pos],
    });
    editor.view.dispatch(tr);
    onMenu({ x: Math.max(8, hover.rect.left), y: hover.rect.top + 24 });
  };

  useEffect(() => {
    const onShortcut = (event: Event) => {
      if (!hover || dragRef.current) return;
      event.preventDefault();
      openMenu();
    };
    window.addEventListener("raynote-open-block-menu", onShortcut);
    return () => window.removeEventListener("raynote-open-block-menu", onShortcut);
  });

  const mountDragPreview = (block: HoveredBlock) => {
    const source = block.element;
    const preview = previewRef.current;
    if (!source || !preview) return;

    const clone = source.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    clone.querySelectorAll("iframe, video, audio, object, embed").forEach((node) => node.remove());
    clone.style.setProperty("margin", "0", "important");

    const contents = document.createElement("div");
    contents.className = "tiptap fullscreen-block-preview-content";
    const fit = Math.min(1,
      Math.min(520, window.innerWidth * 0.64) / Math.max(1, block.rect.width),
      Math.min(460, window.innerHeight * 0.65) / Math.max(1, block.rect.height));
    contents.style.width = `${block.rect.width / zoomLevel}px`;
    contents.style.zoom = String(zoomLevel * fit);
    contents.append(clone);
    preview.replaceChildren(contents);
    preview.hidden = false;
    const { width, height } = preview.getBoundingClientRect();
    previewSizeRef.current = { width, height };
  };

  const positionDragPreview = (drag: DragState) => {
    const preview = previewRef.current;
    if (!preview || preview.hidden) return;
    const { width, height } = previewSizeRef.current;
    const inset = 8;
    const x = Math.max(inset, Math.min(drag.pointerX + 16, window.innerWidth - width - inset));
    const y = Math.max(inset, Math.min(drag.pointerY + 14, window.innerHeight - height - inset));
    preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const updateDrop = (continueDrag = true) => {
    const drag = dragRef.current;
    const scroll = scrollContainerRef.current;
    if (!drag?.started || !scroll) return;
    const bounds = scroll.getBoundingClientRect();
    const edge = 44;
    if (continueDrag) {
      positionDragPreview(drag);
      if (drag.pointerX >= bounds.left && drag.pointerX < bounds.right &&
          drag.pointerY >= bounds.top && drag.pointerY < bounds.bottom) {
        if (drag.pointerY < bounds.top + edge) scroll.scrollTop -= Math.min(22, (bounds.top + edge - drag.pointerY) / 3);
        else if (drag.pointerY > bounds.bottom - edge) scroll.scrollTop += Math.min(22, (drag.pointerY - bounds.bottom + edge) / 3);
      }
    }
    const offset = scroll.scrollTop - drag.scrollTop;
    const y = drag.pointerY + offset;
    // Select the block under the pointer. In the gap, use the closest visible edge.
    const nextIndex = drag.rows.findIndex(({ rect }) => y <= rect.bottom);
    let row = drag.rows[nextIndex < 0 ? drag.rows.length - 1 : nextIndex];
    const previous = nextIndex > 0 ? drag.rows[nextIndex - 1] : undefined;
    if (previous && y < row.rect.top && y - previous.rect.bottom <= row.rect.top - y) row = previous;

    const getDestination = (candidate: typeof row, after: boolean) => {
      const boundary = candidate.pos + (after ? candidate.nodeSize : 0);
      if (boundary === drag.block.pos || boundary === drag.block.pos + drag.block.nodeSize ||
          (boundary === 0 && isNoteTitle(candidate))) return null;
      return { row: candidate, boundary, edge: (after ? candidate.rect.bottom : candidate.rect.top) - offset };
    };
    let destination = getDestination(row, y >= (row.rect.top + row.rect.bottom) / 2);
    if (!destination || destination.edge < bounds.top || destination.edge > bounds.bottom) {
      // A clipped row or the source block can hide the preferred edge during autoscroll.
      // Pick the closest legal edge, preferring edges already in the viewport.
      destination = null;
      let bestDistance = Infinity;
      for (const candidate of drag.rows) {
        for (const after of [false, true]) {
          const next = getDestination(candidate, after);
          if (!next) continue;
          const clipped = next.edge < bounds.top || next.edge > bounds.bottom;
          const distance = Math.abs(next.edge - drag.pointerY) + (clipped ? bounds.height : 0);
          if (distance >= bestDistance) continue;
          destination = next;
          bestDistance = distance;
        }
      }
    }
    drag.boundary = destination?.boundary ?? null;
    if (!continueDrag) return;
    const target = destination;
    setIndicator((current) => {
      if (!target) return null;
      const { rect } = target.row;
      const dropEdge = Math.max(bounds.top + 2, Math.min(bounds.bottom - 2, target.edge));
      const top = Math.max(bounds.top, rect.top - offset);
      const bottom = Math.min(bounds.bottom, rect.bottom - offset);
      const height = Math.max(0, bottom - top);
      if (current?.edge === dropEdge && current.top === top && current.height === height &&
          current.left === rect.left && current.width === rect.width) return current;
      return { edge: dropEdge, top, height, left: rect.left, width: rect.width };
    });
    frameRef.current = requestAnimationFrame(() => updateDrop());
  };

  const startGrip = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!hover || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    suppressGripClick.current = false;
    if (isNoteTitle(hover)) return;
    const doc = editor.state.doc;
    if (doc.nodeAt(hover.pos) !== hover.node) return;
    const rows = getBlockSiblings(doc, hover.pos).flatMap((block) => {
      const dom = getBlockDom(editor.view, block.pos);
      return dom ? [{ ...block, rect: dom.getBoundingClientRect() }] : [];
    });
    if (rows.length < 2) return;
    dragRef.current = {
      block: hover, doc, pointerId: event.pointerId, startY: event.clientY, pointerY: event.clientY, pointerX: event.clientX,
      started: false, scrollTop: scrollContainerRef.current?.scrollTop ?? 0, rows, boundary: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  if (!hover || !editor.isEditable) return null;
  const bounds = scrollContainerRef.current?.getBoundingClientRect();
  const scale = Math.max(0.75, Math.min(zoomLevel, (hover.rect.left - 10) / 80));
  const height = 30 * scale;
  const isFramedBlock = hover.node.type.name === "codeBlock" || hover.node.type.name === "table";
  const anchorTop = isFramedBlock ? hover.rect.top : (lineCenter ?? hover.rect.top + height / 2) - height / 2;
  if (bounds && (anchorTop + height < bounds.top + 52 || anchorTop > bounds.bottom - height)) return null;
  const top = Math.max(bounds?.top ?? 0, Math.min(
    anchorTop,
    (bounds?.bottom ?? window.innerHeight) - height,
  ));

  return createPortal(
    <>
      <div ref={controlsRef} className="fullscreen-block-controls" role="group" aria-label="Block controls"
        onClick={(event) => event.stopPropagation()}
        style={{ top, left: Math.max(4, hover.rect.left - 70 * scale - 2), fontSize: height }}
        onPointerLeave={(event) => {
          if (!dragRef.current && !(event.relatedTarget instanceof Node && scrollContainerRef.current?.contains(event.relatedTarget))) setHover(null);
        }}>
        <button type="button" aria-label="Add block below" title={isNoteTitle(hover) ? "Add block below" : "Click to add below · Option-click to add above"}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => insertAdjacentBlock(editor, hover, event.altKey)}>
          <Plus strokeWidth={2.1} aria-hidden="true" />
        </button>
        {!isNoteTitle(hover) && <button type="button" className="fullscreen-block-grip" aria-label="Block actions" title="Drag to move · Click or press ⌘/ for block actions"
          onPointerDown={startGrip}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            drag.pointerY = event.clientY;
            drag.pointerX = event.clientX;
            if (!drag.started && Math.abs(event.clientY - drag.startY) >= 4) {
              suppressGripClick.current = true;
              drag.started = true;
              mountDragPreview(drag.block);
              updateDrop();
            }
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            if (drag?.started) {
              drag.pointerY = event.clientY;
              updateDrop(false);
            }
            stopDrag();
            if (drag?.started && drag.boundary !== null && drag.doc === editor.state.doc &&
                event.clientX >= 0 && event.clientX < window.innerWidth && event.clientY >= 0 && event.clientY < window.innerHeight) {
              const scroller = scrollContainerRef.current;
              const scrollTop = scroller?.scrollTop ?? 0;
              if (moveBlockToBoundary(editor, drag.block, drag.boundary)) {
                // Restoring after layout cancels any scroll anchoring or caret reveal from the move.
                scroller?.scrollTo({ top: scrollTop, behavior: "instant" });
              }
              setHover(null);
            }
          }}
          onPointerCancel={stopDrag}
          onLostPointerCapture={stopDrag}
          onClick={() => {
            if (!suppressGripClick.current) openMenu();
            suppressGripClick.current = false;
          }}>
          <GripVertical strokeWidth={2.1} aria-hidden="true" />
        </button>}
      </div>
      <div ref={previewRef} className="fullscreen-block-drag-preview" hidden inert aria-hidden="true" />
      {indicator && (
        <>
          <div className="fullscreen-block-drop-target" aria-hidden="true"
            style={{ top: indicator.top, left: indicator.left, width: indicator.width, height: indicator.height }} />
          <div className="fullscreen-block-drop-line" aria-hidden="true"
            style={{ top: indicator.edge, left: indicator.left, width: indicator.width }} />
        </>
      )}
    </>,
    document.body,
  );
}
