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

export interface CachedBlockRect {
  index: number;
  pos: number;
  nodeSize: number;
  docTop: number;
  docBottom: number;
}

/**
 * Binary search to find which block contains docY in O(log n) time.
 * Falls back to closest block if docY is between blocks.
 */
export function findBlockIndexByDocY(
  cachedBlocks: CachedBlockRect[],
  docY: number
): number {
  if (cachedBlocks.length === 0) return -1;
  let low = 0;
  let high = cachedBlocks.length - 1;

  if (docY <= cachedBlocks[0].docTop) return 0;
  if (docY >= cachedBlocks[high].docBottom) return high;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const b = cachedBlocks[mid];

    if (docY >= b.docTop && docY <= b.docBottom) {
      return mid;
    }

    if (docY < b.docTop) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return Math.max(0, Math.min(cachedBlocks.length - 1, low));
}

/**
 * Finds the range of blocks that intersect the vertical interval [minDocY, maxDocY].
 * Returns { minIdx, maxIdx } or null if no blocks intersect.
 */
export function getIntersectingBlockIndices(
  cachedBlocks: CachedBlockRect[],
  minDocY: number,
  maxDocY: number
): { minIdx: number; maxIdx: number } | null {
  if (cachedBlocks.length === 0) return null;

  let minIdx = -1;
  let maxIdx = -1;

  for (let i = 0; i < cachedBlocks.length; i++) {
    const b = cachedBlocks[i];
    if (b.docBottom >= minDocY && b.docTop <= maxDocY) {
      if (minIdx === -1) minIdx = i;
      maxIdx = i;
    }
  }

  if (minIdx === -1 || maxIdx === -1) return null;
  return { minIdx, maxIdx };
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
  // Pure ref-based state: zero React re-renders during drag
  const dragRef = useRef({
    isDragging: false,
    pointerId: -1,
    capturedEl: null as HTMLElement | null,
    startRelX: 0,
    startDocY: 0,
    currentPointerX: 0,
    currentPointerY: 0,
    cachedBlocks: [] as CachedBlockRect[],
    selectedMinIdx: -1,
    selectedMaxIdx: -1,
    hasMoved: false,
    rafId: null as number | null,
  });

  useEffect(() => {
    if (!editor || !scrollContainerRef.current) return;

    const scrollContainer = scrollContainerRef.current;

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

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    const updateSelectionRangeInView = (minIdx: number, maxIdx: number) => {
      if (!editor || editor.isDestroyed) return;
      const state = dragRef.current;

      const selected =
        minIdx >= 0 && maxIdx >= minIdx && maxIdx < state.cachedBlocks.length
          ? state.cachedBlocks.slice(minIdx, maxIdx + 1).map((b) => b.pos)
          : [];

      const anchorPos = minIdx >= 0 ? state.cachedBlocks[minIdx]?.pos ?? null : null;
      const headPos = maxIdx >= 0 ? state.cachedBlocks[maxIdx]?.pos ?? null : null;

      const view = editor.view;
      const tr = view.state.tr.setMeta(blockSelectionPluginKey, {
        anchor: anchorPos,
        head: headPos,
        selectedPositions: selected,
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

      // 2. Recompute docY after scroll (container coordinate space)
      const currentDocY =
        state.currentPointerY - containerRect.top + container.scrollTop;

      const minDocY = Math.min(state.startDocY, currentDocY);
      const maxDocY = Math.max(state.startDocY, currentDocY);

      const hit = getIntersectingBlockIndices(state.cachedBlocks, minDocY, maxDocY);
      const newMinIdx = hit ? hit.minIdx : -1;
      const newMaxIdx = hit ? hit.maxIdx : -1;

      // 3. Selection updates only when the intersected range changes
      if (
        newMinIdx !== state.selectedMinIdx ||
        newMaxIdx !== state.selectedMaxIdx
      ) {
        state.selectedMinIdx = newMinIdx;
        state.selectedMaxIdx = newMaxIdx;
        updateSelectionRangeInView(newMinIdx, newMaxIdx);
      }

      // 4. Update rubber-band marquee box in container coordinates
      const box = rubberBandRef.current;
      if (box) {
        const curRelX = state.currentPointerX - containerRect.left;

        const left = Math.min(state.startRelX, curRelX);
        const top = Math.min(state.startDocY, currentDocY);
        const width = Math.abs(curRelX - state.startRelX);
        const height = Math.abs(currentDocY - state.startDocY);

        if (width > 3 || height > 3) {
          state.hasMoved = true;
          box.style.display = "block";
          box.style.left = `${left}px`;
          box.style.top = `${top}px`;
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

    const handlePointerUp = () => {
      const state = dragRef.current;
      if (state.isDragging) {
        if (state.selectedMinIdx !== -1 && state.selectedMaxIdx !== -1) {
          updateSelectionRangeInView(state.selectedMinIdx, state.selectedMaxIdx);
          setLastDragEndTime(Date.now());
        } else if (state.hasMoved) {
          // Drag finished with no blocks touched -> clear selection
          updateSelectionRangeInView(-1, -1);
          setLastDragEndTime(Date.now());
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

      // Ignore Shift+Click and ⌘+Click (handled in editor plugin)
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        return;
      }

      const view = editor.view;
      const tiptapDom = view.dom;
      const editorRect = tiptapDom.getBoundingClientRect();
      const paddingLeft =
        parseFloat(getComputedStyle(tiptapDom).paddingLeft) || 40;
      const paddingRight =
        parseFloat(getComputedStyle(tiptapDom).paddingRight) || 40;

      const gutterRightEdge = editorRect.left + paddingLeft - 4;
      const contentRightEdge = editorRect.right - paddingRight + 4;

      // 1. Left empty space (gutter)
      const isLeftGutter = e.clientX < gutterRightEdge;

      // 2. Right empty space (right padding / slider gutter or beyond editor)
      const isRightGutter =
        e.clientX > contentRightEdge || e.clientX >= editorRect.right;

      // Check if clicking in empty horizontal space to the right of text on a line
      let isRightOfText = false;
      if (!isLeftGutter && !isRightGutter) {
        if (typeof document.caretRangeFromPoint === "function") {
          const range = document.caretRangeFromPoint(e.clientX, e.clientY);
          if (range) {
            const rangeRect = range.getBoundingClientRect();
            if (rangeRect && e.clientX > rangeRect.right + 14) {
              isRightOfText = true;
            }
          } else {
            isRightOfText = true;
          }
        }
      }

      // 3. Below the text (empty space below all content blocks)
      let lastBlockBottom = editorRect.top;
      const children = tiptapDom.children;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i] as HTMLElement;
        if (child && child.offsetHeight > 0) {
          const r = child.getBoundingClientRect();
          if (r.bottom > lastBlockBottom) {
            lastBlockBottom = r.bottom;
            break;
          }
        }
      }

      const isBelowText =
        e.clientY > lastBlockBottom + 4 ||
        e.target === scrollContainer ||
        (e.target === tiptapDom && e.clientY > lastBlockBottom);

      // ONLY start block drag if clicking in left empty space, right empty space, or below text!
      // Clicking directly on text characters allows normal text editing / cursor positioning.
      if (!isLeftGutter && !isRightGutter && !isRightOfText && !isBelowText) {
        return;
      }

      e.preventDefault();

      const container = scrollContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const startDocY = e.clientY - containerRect.top + scrollTop;
      const startRelX = e.clientX - containerRect.left;

      // Cache block rects at drag start in container coordinates
      const blocks: BlockInfo[] = getAllBlocks(view.state.doc);
      const cachedBlocks: CachedBlockRect[] = [];

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const dom = getBlockDom(view, b.pos);
        if (dom) {
          const r = dom.getBoundingClientRect();
          cachedBlocks.push({
            index: i,
            pos: b.pos,
            nodeSize: b.nodeSize,
            docTop: r.top - containerRect.top + scrollTop,
            docBottom: r.bottom - containerRect.top + scrollTop,
          });
        }
      }

      if (cachedBlocks.length === 0) return;

      // Find initial intersecting block at mouse down point
      const initialHit = getIntersectingBlockIndices(
        cachedBlocks,
        startDocY,
        startDocY
      );
      const initialMin = initialHit ? initialHit.minIdx : -1;
      const initialMax = initialHit ? initialHit.maxIdx : -1;

      // Pointer capture for reliable dragging outside window boundaries
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Fallback if setPointerCapture unavailable
      }

      // WKWebView optimizations: prevent native text selection fighting during block drag
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
      state.selectedMinIdx = initialMin;
      state.selectedMaxIdx = initialMax;
      state.hasMoved = false;

      // If clicked next to a block (left or right gutter), select that block immediately
      // If clicked below all blocks, initialMin is -1 (clears/waits until drag reaches a block)
      updateSelectionRangeInView(initialMin, initialMax);

      // Start RAF auto-scroll and marquee update loop
      state.rafId = requestAnimationFrame(runDragLoop);

      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    };

    const handleWindowBlur = () => {
      // Window lost focus mid-drag: cancel cleanly
      cleanupDrag();
    };

    scrollContainer.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("blur", handleWindowBlur);
      cleanupDrag();
    };
  }, [editor, scrollContainerRef, rubberBandRef]);
}
