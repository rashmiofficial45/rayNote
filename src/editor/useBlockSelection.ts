import { useEffect, useRef } from "react";
import { Editor } from "@tiptap/react";
import { TextSelection, NodeSelection } from "@tiptap/pm/state";

interface CachedBlock {
  index: number;
  docTop: number;
  docBottom: number;
}

interface UseBlockSelectionProps {
  editor: Editor | null;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  selectionBoxRef: React.RefObject<HTMLDivElement | null>;
}

export function useBlockSelection({ editor, scrollContainerRef, selectionBoxRef }: UseBlockSelectionProps) {
  const stateRef = useRef({
    isSelecting: false,
    startX: 0,
    startY: 0,
    startDocY: 0,
    currentClientX: 0,
    currentClientY: 0,
    cachedBlocks: [] as CachedBlock[],
    containerRect: null as DOMRect | null,
    selectedMinIdx: -1,
    selectedMaxIdx: -1,
    scrollSpeed: 0,
    animFrameId: null as number | null,
  });

  useEffect(() => {
    if (!editor || !scrollContainerRef.current) return;

    const scrollContainer = scrollContainerRef.current;

    const clearSelectionClasses = () => {
      if (!editor || editor.isDestroyed) return;
      const tiptapDom = editor.view.dom;
      const selected = tiptapDom.querySelectorAll(".notefast-block-selected");
      selected.forEach((el) => el.classList.remove("notefast-block-selected"));
    };

    // Updates visual styles directly on LIVE DOM elements
    const updateVisualBlockHighlights = (minIdx: number, maxIdx: number) => {
      if (!editor || editor.isDestroyed) return;
      const tiptapDom = editor.view.dom;
      const children = tiptapDom.children;

      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const isSelected = minIdx !== -1 && maxIdx !== -1 && i >= minIdx && i <= maxIdx;
        const hasClass = el.classList.contains("notefast-block-selected");

        if (isSelected && !hasClass) {
          el.classList.add("notefast-block-selected");
        } else if (!isSelected && hasClass) {
          el.classList.remove("notefast-block-selected");
        }
      }
    };

    // Synchronizes ProseMirror selection ONLY when drag finishes (on pointerup)
    const synchronizeProseMirrorSelection = (minIdx: number, maxIdx: number) => {
      if (!editor || editor.isDestroyed) return;
      if (minIdx === -1 || maxIdx === -1) return;

      const view = editor.view;
      const doc = view.state.doc;
      if (minIdx >= doc.childCount || maxIdx >= doc.childCount) return;

      try {
        let fromPos = 0;
        for (let i = 0; i < minIdx; i++) {
          fromPos += doc.child(i).nodeSize;
        }

        let toPos = fromPos;
        for (let i = minIdx; i <= maxIdx; i++) {
          toPos += doc.child(i).nodeSize;
        }

        let tr;
        if (minIdx === maxIdx) {
          const singleNode = doc.child(minIdx);
          if (singleNode.type.spec.selectable !== false) {
            try {
              tr = view.state.tr.setSelection(NodeSelection.create(doc, fromPos));
            } catch {
              tr = view.state.tr.setSelection(TextSelection.create(doc, fromPos, toPos));
            }
          } else {
            tr = view.state.tr.setSelection(TextSelection.create(doc, fromPos, toPos));
          }
        } else {
          tr = view.state.tr.setSelection(TextSelection.create(doc, fromPos, toPos));
        }

        if (tr && !view.state.selection.eq(tr.selection)) {
          view.dispatch(tr);
        }
      } catch {
        // Safe fallback
      }
    };

    const renderFrame = () => {
      if (!stateRef.current.isSelecting) {
        stateRef.current.animFrameId = null;
        return;
      }

      const container = scrollContainerRef.current;
      if (!container) {
        stateRef.current.animFrameId = null;
        return;
      }

      // 1. Auto-scroll step if near window edge
      if (stateRef.current.scrollSpeed !== 0) {
        const prevScroll = container.scrollTop;
        container.scrollTop += stateRef.current.scrollSpeed;
        if (container.scrollTop === prevScroll) {
          stateRef.current.scrollSpeed = 0;
        }
      }

      const currentScrollTop = container.scrollTop;
      const currentDocY = stateRef.current.currentClientY + currentScrollTop;
      const startDocY = stateRef.current.startDocY;

      const minDocY = Math.min(startDocY, currentDocY);
      const maxDocY = Math.max(startDocY, currentDocY);

      const startX = stateRef.current.startX;
      const currentX = stateRef.current.currentClientX;
      const boxLeft = Math.min(startX, currentX);
      const boxWidth = Math.abs(currentX - startX);

      const boxTop = minDocY - currentScrollTop;
      const boxHeight = maxDocY - minDocY;

      // 2. Update Marquee Box DOM
      const box = selectionBoxRef.current;
      if (box) {
        if (boxWidth > 3 || boxHeight > 3) {
          box.style.display = "block";
          box.style.left = `${boxLeft}px`;
          box.style.top = `${boxTop}px`;
          box.style.width = `${boxWidth}px`;
          box.style.height = `${boxHeight}px`;
        }
      }

      // 3. Fast block intersection check (pure numeric comparison, zero layout queries)
      const { cachedBlocks } = stateRef.current;
      let minIdx = -1;
      let maxIdx = -1;

      for (let i = 0; i < cachedBlocks.length; i++) {
        const b = cachedBlocks[i];
        if (b.docBottom >= minDocY && b.docTop <= maxDocY) {
          if (minIdx === -1) minIdx = i;
          maxIdx = i;
        }
      }

      // 4. Update visual block styles directly on live DOM (NO ProseMirror transactions while dragging!)
      if (minIdx !== -1 && maxIdx !== -1) {
        if (minIdx !== stateRef.current.selectedMinIdx || maxIdx !== stateRef.current.selectedMaxIdx) {
          stateRef.current.selectedMinIdx = minIdx;
          stateRef.current.selectedMaxIdx = maxIdx;
          updateVisualBlockHighlights(minIdx, maxIdx);
        }
      }

      // 5. Keep loop going if auto-scrolling, otherwise yield until next pointermove or scroll
      if (stateRef.current.scrollSpeed !== 0) {
        stateRef.current.animFrameId = requestAnimationFrame(renderFrame);
      } else {
        stateRef.current.animFrameId = null;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!stateRef.current.isSelecting) return;
      if (e.buttons !== 1) {
        handlePointerUp();
        return;
      }

      stateRef.current.currentClientX = e.clientX;
      stateRef.current.currentClientY = e.clientY;

      // Auto-scroll speed calculation (proportional & fast)
      const cRect = stateRef.current.containerRect;
      if (cRect) {
        const y = e.clientY;
        const edgeZone = 80;
        let speed = 0;

        if (y < cRect.top + edgeZone) {
          const intensity = Math.min(2.5, Math.max(0, (cRect.top + edgeZone - y) / edgeZone));
          speed = -Math.round(intensity * 40);
        } else if (y > cRect.bottom - edgeZone) {
          const intensity = Math.min(2.5, Math.max(0, (y - (cRect.bottom - edgeZone)) / edgeZone));
          speed = Math.round(intensity * 40);
        }
        stateRef.current.scrollSpeed = speed;
      }

      if (stateRef.current.animFrameId === null) {
        stateRef.current.animFrameId = requestAnimationFrame(renderFrame);
      }
    };

    const handleScroll = () => {
      if (stateRef.current.isSelecting && stateRef.current.animFrameId === null) {
        stateRef.current.animFrameId = requestAnimationFrame(renderFrame);
      }
    };

    const handlePointerUp = () => {
      if (!stateRef.current.isSelecting) return;
      stateRef.current.isSelecting = false;
      stateRef.current.scrollSpeed = 0;

      if (stateRef.current.animFrameId !== null) {
        cancelAnimationFrame(stateRef.current.animFrameId);
        stateRef.current.animFrameId = null;
      }

      if (selectionBoxRef.current) {
        selectionBoxRef.current.style.display = "none";
      }

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      // Finalize ProseMirror selection on pointerup
      const min = stateRef.current.selectedMinIdx;
      const max = stateRef.current.selectedMaxIdx;
      if (min !== -1 && max !== -1) {
        updateVisualBlockHighlights(min, max);
        synchronizeProseMirrorSelection(min, max);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      const view = editor.view;
      const tiptapDom = view.dom;
      const editorRect = tiptapDom.getBoundingClientRect();
      const paddingLeft = parseFloat(getComputedStyle(tiptapDom).paddingLeft) || 0;
      const gutterRightEdge = editorRect.left + paddingLeft - 10;

      // If clicked inside the text area, clear block selection classes and let normal text selection happen
      if (e.clientX > gutterRightEdge) {
        clearSelectionClasses();
        return;
      }

      e.preventDefault();

      const container = scrollContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const currentScrollTop = container.scrollTop;
      const startDocY = e.clientY + currentScrollTop;

      const children = Array.from(tiptapDom.children) as HTMLElement[];
      const cachedBlocks: CachedBlock[] = children.map((el, index) => {
        const r = el.getBoundingClientRect();
        return {
          index,
          docTop: r.top + currentScrollTop,
          docBottom: r.bottom + currentScrollTop,
        };
      });

      stateRef.current = {
        isSelecting: true,
        startX: e.clientX,
        startY: e.clientY,
        startDocY,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        cachedBlocks,
        containerRect,
        selectedMinIdx: -1,
        selectedMaxIdx: -1,
        scrollSpeed: 0,
        animFrameId: null,
      };

      // Select clicked block immediately
      let initialIdx = -1;
      for (let i = 0; i < cachedBlocks.length; i++) {
        const b = cachedBlocks[i];
        if (startDocY >= b.docTop && startDocY <= b.docBottom) {
          initialIdx = i;
          break;
        }
      }
      if (initialIdx === -1 && cachedBlocks.length > 0) {
        let closestIdx = 0;
        let closestDist = Infinity;
        for (let i = 0; i < cachedBlocks.length; i++) {
          const b = cachedBlocks[i];
          const dist = Math.min(Math.abs(startDocY - b.docTop), Math.abs(startDocY - b.docBottom));
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = i;
          }
        }
        initialIdx = closestIdx;
      }

      if (initialIdx !== -1) {
        stateRef.current.selectedMinIdx = initialIdx;
        stateRef.current.selectedMaxIdx = initialIdx;
        updateVisualBlockHighlights(initialIdx, initialIdx);
      }

      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerup", handlePointerUp);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearSelectionClasses();
      }
    };

    scrollContainer.addEventListener("pointerdown", handlePointerDown);
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (stateRef.current.animFrameId !== null) {
        cancelAnimationFrame(stateRef.current.animFrameId);
        stateRef.current.animFrameId = null;
      }
    };
  }, [editor, scrollContainerRef, selectionBoxRef]);
}
