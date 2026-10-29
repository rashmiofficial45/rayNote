import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  blockSelectionPluginKey,
  getAllBlocks,
  getBlockDom,
  setLastDragEndTime,
  type BlockInfo,
} from "./BlockSelection";
import { calculateAutoScrollSpeed } from "./useAutoScroll";

export const HIT_TOLERANCE_PX = 0;

export interface ContentRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CachedBlockRect {
  index: number;
  pos: number;
  nodeSize: number;
  docTop: number;
  docBottom: number;
  docLeft: number;
  docRight: number;
  contentRects?: ContentRect[];
}

/**
 * Computes the real content rectangles for a block DOM element in container coordinates.
 * - Text blocks (p, h1-h6, blockquote, li): builds a DOM Range over the text content
 *   and uses range.getClientRects() so empty margins around the text are excluded.
 * - Non-text blocks (code block, table, horizontal rule, iframe): uses the element's bounding rect.
 */
export function getBlockContentRects(
  dom: HTMLElement,
  containerRect: DOMRect,
  scrollTop: number
): ContentRect[] {
  // Non-text blocks: code blocks, tables, hr, iframe
  const isNonText =
    dom.tagName === "PRE" ||
    dom.classList.contains("code-block-wrapper") ||
    dom.classList.contains("notefast-code-block") ||
    dom.classList.contains("notefast-table") ||
    dom.tagName === "TABLE" ||
    dom.tagName === "HR" ||
    dom.tagName === "IFRAME" ||
    Boolean(dom.querySelector("pre, table, hr, iframe"));

  const targetEl = isNonText
    ? dom.tagName === "PRE"
      ? dom
      : dom.querySelector("pre, table") || dom
    : dom;

  // Block-level elements take the full block bounds so touching anywhere selects the block
  const r = targetEl.getBoundingClientRect();
  return [
    {
      left: r.left - containerRect.left,
      right: r.right - containerRect.left,
      top: r.top - containerRect.top + scrollTop,
      bottom: r.bottom - containerRect.top + scrollTop,
    },
  ];
}

/**
 * Checks if two 2D rectangles intersect with the given tolerance.
 */
export function rectsIntersect(
  minX1: number,
  maxX1: number,
  minY1: number,
  maxY1: number,
  minX2: number,
  maxX2: number,
  minY2: number,
  maxY2: number,
  tolerance: number = HIT_TOLERANCE_PX
): boolean {
  return (
    Math.max(minX1, minX2) <= Math.min(maxX1, maxX2) + tolerance &&
    Math.max(minY1, minY2) <= Math.min(maxY1, maxY2) + tolerance
  );
}

/**
 * Binary search to find which block contains docY in O(log n) time.
 * Falls back to closest block if docY is between blocks.
 */
export function findBlockIndexByDocY(
  cachedBlocks: CachedBlockRect[],
  docY: number,
  snapToNearest: boolean = false
): number {
  if (cachedBlocks.length === 0) return -1;

  for (let i = 0; i < cachedBlocks.length; i++) {
    const b = cachedBlocks[i];
    if (docY >= b.docTop && docY <= b.docBottom) {
      return i;
    }
  }

  if (!snapToNearest) return -1;

  if (docY <= cachedBlocks[0].docTop) return 0;
  if (docY >= cachedBlocks[cachedBlocks.length - 1].docBottom) return cachedBlocks.length - 1;

  let low = 0;
  let high = cachedBlocks.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const b = cachedBlocks[mid];
    if (docY >= b.docTop && docY <= b.docBottom) return mid;
    if (docY < b.docTop) high = mid - 1;
    else low = mid + 1;
  }
  return Math.max(0, Math.min(cachedBlocks.length - 1, low));
}

/**
 * Finds the range of blocks that intersect the selection rectangle.
 * Intersects with the REAL content rects of each block (not full-width block container)
 * so that rubber-band rectangles in empty margins select nothing.
 */
export function getIntersectingBlockIndices(
  cachedBlocks: CachedBlockRect[],
  minDocY: number,
  maxDocY: number,
  minDocX?: number,
  maxDocX?: number,
  _isGutterDrag?: boolean
): { minIdx: number; maxIdx: number; selectedIndices: number[] } | null {
  if (cachedBlocks.length === 0) return null;

  const selectedIndices: number[] = [];
  const isPointHit = Math.abs(maxDocY - minDocY) < 1;

  for (let i = 0; i < cachedBlocks.length; i++) {
    const b = cachedBlocks[i];
    const bHeight = b.docBottom - b.docTop;

    let yHits = false;
    if (isPointHit) {
      yHits = minDocY >= b.docTop && minDocY <= b.docBottom;
    } else {
      const vThreshold = Math.min(8, Math.max(2, bHeight * 0.25));
      yHits = maxDocY >= b.docTop + vThreshold && minDocY <= b.docBottom;
    }

    if (!yHits) continue;

    // Horizontal check against REAL content rects
    if (minDocX !== undefined && maxDocX !== undefined) {
      let xHits = false;
      if (b.contentRects && b.contentRects.length > 0) {
        for (const cr of b.contentRects) {
          if (
            rectsIntersect(
              minDocX,
              maxDocX,
              minDocY,
              maxDocY,
              cr.left,
              cr.right,
              cr.top,
              cr.bottom,
              HIT_TOLERANCE_PX
            )
          ) {
            xHits = true;
            break;
          }
        }
      } else {
        // Fallback for tests or blocks without contentRects
        xHits = maxDocX >= b.docLeft + HIT_TOLERANCE_PX && minDocX <= b.docRight - HIT_TOLERANCE_PX;
      }

      if (!xHits) continue;
    }

    selectedIndices.push(i);
  }

  if (selectedIndices.length === 0) return null;

  return {
    minIdx: selectedIndices[0],
    maxIdx: selectedIndices[selectedIndices.length - 1],
    selectedIndices,
  };
}

export interface UseBlockDragProps {
  editor: Editor | null;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  rubberBandRef: React.RefObject<HTMLDivElement | null>;
}

export function useBlockDrag({
  editor,
  scrollContainerRef,
  rubberBandRef,
}: UseBlockDragProps) {
  const dragRef = useRef({
    isDragging: false,
    pointerId: -1,
    capturedEl: null as HTMLElement | null,
    startRelX: 0,
    startDocY: 0,
    currentPointerX: 0,
    currentPointerY: 0,
    cachedBlocks: [] as CachedBlockRect[],
    selectedPositions: [] as number[],
    hasMoved: false,
    isBelowLastBlock: false,
    isEmptyBlock: false,
    isBeyondText: false,
    rafId: null as number | null,
  });

  useEffect(() => {
    if (!editor || !scrollContainerRef.current) return;

    const scrollContainer = scrollContainerRef.current;

    const refreshCachedBlocks = () => {
      const state = dragRef.current;
      if (!state.isDragging || !editor || editor.isDestroyed) return;
      const view = editor.view;
      const container = scrollContainerRef.current;
      if (!container || !view) return;

      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const blocks: BlockInfo[] = getAllBlocks(view.state.doc);
      const cachedBlocks: CachedBlockRect[] = [];

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const dom = getBlockDom(view, b.pos);
        if (dom) {
          const r = dom.getBoundingClientRect();
          const contentRects = getBlockContentRects(dom, containerRect, scrollTop);
          cachedBlocks.push({
            index: i,
            pos: b.pos,
            nodeSize: b.nodeSize,
            docTop: r.top - containerRect.top + scrollTop,
            docBottom: r.bottom - containerRect.top + scrollTop,
            docLeft: r.left - containerRect.left,
            docRight: r.right - containerRect.left,
            contentRects,
          });
        }
      }
      if (cachedBlocks.length > 0) {
        state.cachedBlocks = cachedBlocks;
      }

      // Re-run hit testing with the last pointer position so the selection / drop target updates during scroll
      if (state.hasMoved && state.cachedBlocks.length > 0) {
        const currentDocY = state.currentPointerY - containerRect.top + container.scrollTop;
        const minDocY = Math.min(state.startDocY, currentDocY);
        const maxDocY = Math.max(state.startDocY, currentDocY);

        const curRelX = state.currentPointerX - containerRect.left;
        const minDocX = Math.min(state.startRelX, curRelX);
        const maxDocX = Math.max(state.startRelX, curRelX);

        const hit = getIntersectingBlockIndices(
          state.cachedBlocks,
          minDocY,
          maxDocY,
          minDocX,
          maxDocX
        );

        const newPositions = hit ? hit.selectedIndices.map((idx) => state.cachedBlocks[idx].pos) : [];

        const isDifferent =
          newPositions.length !== state.selectedPositions.length ||
          newPositions.some((pos, i) => pos !== state.selectedPositions[i]);

        if (isDifferent) {
          state.selectedPositions = newPositions;
          updateSelectedPositionsInView(newPositions);
        }
      }
    };

    const handleScrollDuringDrag = () => {
      const state = dragRef.current;
      if (!state.isDragging || !editor || editor.isDestroyed || !state.hasMoved) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const currentDocY = state.currentPointerY - containerRect.top + container.scrollTop;
      const minDocY = Math.min(state.startDocY, currentDocY);
      const maxDocY = Math.max(state.startDocY, currentDocY);

      const curRelX = state.currentPointerX - containerRect.left;
      const minDocX = Math.min(state.startRelX, curRelX);
      const maxDocX = Math.max(state.startRelX, curRelX);

      const hit = getIntersectingBlockIndices(
        state.cachedBlocks,
        minDocY,
        maxDocY,
        minDocX,
        maxDocX
      );

      const newPositions = hit ? hit.selectedIndices.map((idx) => state.cachedBlocks[idx].pos) : [];

      const isDifferent =
        newPositions.length !== state.selectedPositions.length ||
        newPositions.some((pos, i) => pos !== state.selectedPositions[i]);

      if (isDifferent) {
        state.selectedPositions = newPositions;
        updateSelectedPositionsInView(newPositions);
      }
    };

    const cleanupDrag = () => {
      const state = dragRef.current;
      if (!state.isDragging) return;

      state.isDragging = false;

      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }

      if (state.capturedEl && state.pointerId !== -1) {
        try {
          state.capturedEl.releasePointerCapture(state.pointerId);
        } catch {
          // Ignore if pointer capture already lost
        }
        state.capturedEl = null;
        state.pointerId = -1;
      }

      // Hide rubber-band box
      const box = rubberBandRef.current;
      if (box) {
        box.style.display = "none";
      }

      // Remove drag body classes and WebKit text selection overrides
      document.body.classList.remove("is-block-dragging");
      scrollContainer.classList.remove("is-block-dragging");
      document.body.style.removeProperty("-webkit-user-select");
      document.body.style.removeProperty("user-select");

      scrollContainer.removeEventListener("scroll", handleScrollDuringDrag);
      window.removeEventListener("resize", refreshCachedBlocks);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown, true);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        updateSelectedPositionsInView([]);
        cleanupDrag();
      }
    };

    const updateSelectedPositionsInView = (positions: number[]) => {
      if (!editor || editor.isDestroyed) return;

      const anchorPos = positions.length > 0 ? positions[0] : null;
      const headPos = positions.length > 0 ? positions[positions.length - 1] : null;

      const view = editor.view;
      const tr = view.state.tr.setMeta(blockSelectionPluginKey, {
        anchor: anchorPos,
        head: headPos,
        selectedPositions: positions,
      });

      view.dispatch(tr);
    };

    const runDragLoop = () => {
      const state = dragRef.current;
      if (!state.isDragging) {
        state.rafId = null;
        return;
      }

      const container = scrollContainerRef.current;
      if (!container) {
        state.rafId = null;
        return;
      }

      const containerRect = container.getBoundingClientRect();

      // 1. Auto-scroll step with quadratic speed ramping
      const speed = calculateAutoScrollSpeed(state.currentPointerY, container, {
        zoneSize: 60,
        maxSpeed: 18,
      });

      if (speed !== 0) {
        container.scrollTop += speed;
      }

      // 2. Recompute doc coordinates after scroll
      const currentDocY = state.currentPointerY - containerRect.top + container.scrollTop;
      const minDocY = Math.min(state.startDocY, currentDocY);
      const maxDocY = Math.max(state.startDocY, currentDocY);

      const curRelX = state.currentPointerX - containerRect.left;
      const minDocX = Math.min(state.startRelX, curRelX);
      const maxDocX = Math.max(state.startRelX, curRelX);

      const width = Math.abs(curRelX - state.startRelX);
      const height = Math.abs(currentDocY - state.startDocY);

      if (width > 3 || height > 3) {
        state.hasMoved = true;
      }

      const hit = getIntersectingBlockIndices(
        state.cachedBlocks,
        minDocY,
        maxDocY,
        minDocX,
        maxDocX
      );

      const newPositions = hit ? hit.selectedIndices.map((i) => state.cachedBlocks[i].pos) : [];

      const isDifferent =
        newPositions.length !== state.selectedPositions.length ||
        newPositions.some((pos, i) => pos !== state.selectedPositions[i]);

      if (isDifferent) {
        state.selectedPositions = newPositions;
        updateSelectedPositionsInView(newPositions);
      }

      // 4. Update rubber-band marquee box in container coordinates
      const box = rubberBandRef.current;
      if (box) {
        if (state.hasMoved) {
          box.style.display = "block";
          box.style.left = `${minDocX}px`;
          box.style.top = `${minDocY}px`;
          box.style.width = `${width}px`;
          box.style.height = `${height}px`;
        } else {
          box.style.display = "none";
        }
      }

      // 5. Keep loop running continuously while dragging
      state.rafId = requestAnimationFrame(runDragLoop);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state.isDragging) return;

      if (e.buttons !== 1) {
        handlePointerUp();
        return;
      }

      state.currentPointerX = e.clientX;
      state.currentPointerY = e.clientY;
    };

    const handlePointerCancel = () => {
      cleanupDrag();
    };

    const handlePointerUp = () => {
      const state = dragRef.current;
      if (state.isDragging) {
        if (!state.hasMoved) {
          // Click in empty space without dragging
          if (state.isBelowLastBlock || state.isEmptyBlock) {
            // Click below the last line or on empty block at end of note -> put caret at the end of the note!
            editor.chain().focus("end").run();
          } else if (state.isBeyondText) {
            const clickPos = editor.view.posAtCoords({
              left: state.currentPointerX,
              top: state.currentPointerY,
            });
            if (clickPos) {
              editor.commands.setTextSelection(clickPos.pos);
            }
            editor.view.focus();
          } else {
            updateSelectedPositionsInView([]);
          }
        } else {
          // Drag finished
          if (state.selectedPositions.length > 0) {
            updateSelectedPositionsInView(state.selectedPositions);
            setLastDragEndTime(Date.now());
            editor?.view?.focus();
          } else {
            updateSelectedPositionsInView([]);
            setLastDragEndTime(Date.now());
          }
        }
      }
      cleanupDrag();
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // Only primary mouse button

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Ignore task checkbox clicks so checkboxes toggle normally
      if (
        target.tagName === "INPUT" ||
        target.closest('input[type="checkbox"]') ||
        target.closest("label")
      ) {
        return;
      }

      // Ignore clicks on resize handles, titlebar drag regions, toolbars, tick sliders
      if (
        target.closest("[data-resize-handle]") ||
        target.closest("[data-tauri-drag-region]") ||
        target.closest(".floating-code-block-toolbar") ||
        target.closest(".document-tick-slider")
      ) {
        return;
      }

      // Ignore Shift+Click and ⌘+Click (handled in editor plugin)
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        return;
      }

      const view = editor.view;
      const tiptapDom = view.dom;
      const editorRect = tiptapDom.getBoundingClientRect();
      const style = window.getComputedStyle(tiptapDom);
      const paddingLeft = parseFloat(style.paddingLeft) || 40;
      const paddingRight = parseFloat(style.paddingRight) || 40;

      // The text column: horizontal area where the editor renders text
      const textColumnLeft = editorRect.left + paddingLeft;
      const textColumnRight = editorRect.right - paddingRight;

      // Find top of first block and bottom of last block
      let firstBlockTop = editorRect.top;
      let lastBlockBottom = editorRect.top;
      const children = tiptapDom.children;
      if (children.length > 0) {
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          if (child && child.offsetHeight > 0) {
            firstBlockTop = child.getBoundingClientRect().top;
            break;
          }
        }
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i] as HTMLElement;
          if (child && child.offsetHeight > 0) {
            lastBlockBottom = child.getBoundingClientRect().bottom;
            break;
          }
        }
      }

      const isLeftMargin = e.clientX < textColumnLeft;
      const isRightMargin = e.clientX > textColumnRight;
      const isAboveFirstBlock = e.clientY < firstBlockTop;
      const isBelowLastBlock = e.clientY > lastBlockBottom;

      const blockEl = target.closest("p, li, h1, h2, h3, blockquote, pre");
      const isEmptyBlock = Boolean(
        target === tiptapDom ||
        target.classList.contains("is-empty") ||
        target.closest(".is-empty") ||
        (blockEl && (!blockEl.textContent || blockEl.textContent.trim() === ""))
      );

      let isBeyondText = false;
      if (!isEmptyBlock && blockEl) {
        try {
          const range = document.createRange();
          range.selectNodeContents(blockEl);
          const rects = range.getClientRects();
          let textRight = -1;
          for (let i = 0; i < rects.length; i++) {
            if (rects[i].right > textRight) {
              textRight = rects[i].right;
            }
          }
          if (textRight > 0 && e.clientX > textRight + 8) {
            isBeyondText = true;
          }
        } catch {
          // Ignore
        }
      }

      const isInEmptyArea =
        isLeftMargin ||
        isRightMargin ||
        isAboveFirstBlock ||
        isBelowLastBlock ||
        isEmptyBlock ||
        isBeyondText;

      // Pointer starts inside text column on actual text -> default ProseMirror selection.
      // Do NOT start block selection, do NOT call preventDefault!
      if (!isInEmptyArea) {
        return;
      }

      // Pointer starts in empty area -> rubber-band block selection!
      e.preventDefault();

      const container = scrollContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const startDocY = e.clientY - containerRect.top + scrollTop;
      const startRelX = e.clientX - containerRect.left;

      // Cache block rects and their real content rects at drag start
      const blocks: BlockInfo[] = getAllBlocks(view.state.doc);
      const cachedBlocks: CachedBlockRect[] = [];

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const dom = getBlockDom(view, b.pos);
        if (dom) {
          const r = dom.getBoundingClientRect();
          const contentRects = getBlockContentRects(dom, containerRect, scrollTop);
          cachedBlocks.push({
            index: i,
            pos: b.pos,
            nodeSize: b.nodeSize,
            docTop: r.top - containerRect.top + scrollTop,
            docBottom: r.bottom - containerRect.top + scrollTop,
            docLeft: r.left - containerRect.left,
            docRight: r.right - containerRect.left,
            contentRects,
          });
        }
      }

      if (cachedBlocks.length === 0) return;

      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Fallback
      }

      document.body.classList.add("is-block-dragging");
      scrollContainer.classList.add("is-block-dragging");
      document.body.style.setProperty("-webkit-user-select", "none", "important");
      document.body.style.setProperty("user-select", "none", "important");

      const state = dragRef.current;
      state.isDragging = true;
      state.pointerId = e.pointerId;
      state.capturedEl = target;
      state.startRelX = startRelX;
      state.startDocY = startDocY;
      state.currentPointerX = e.clientX;
      state.currentPointerY = e.clientY;
      state.cachedBlocks = cachedBlocks;
      state.selectedPositions = [];
      state.hasMoved = false;
      state.isBelowLastBlock = isBelowLastBlock;
      state.isEmptyBlock = isEmptyBlock;
      state.isBeyondText = isBeyondText;

      state.rafId = requestAnimationFrame(runDragLoop);

      scrollContainer.addEventListener("scroll", handleScrollDuringDrag, { passive: true });
      window.addEventListener("resize", refreshCachedBlocks, { passive: true });
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      window.addEventListener("keydown", handleKeyDown, true);
    };

    const handleWindowBlur = () => {
      cleanupDrag();
    };

    const handleVisibilityOrHide = () => {
      cleanupDrag();
    };

    scrollContainer.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityOrHide);
    window.addEventListener("panel-will-hide" as any, handleVisibilityOrHide);

    return () => {
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityOrHide);
      window.removeEventListener("panel-will-hide" as any, handleVisibilityOrHide);
      cleanupDrag();
    };
  }, [editor, scrollContainerRef, rubberBandRef]);
}
