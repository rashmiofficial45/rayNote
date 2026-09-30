import { useEffect, useRef, useCallback, useState } from "react";
import { Editor } from "@tiptap/react";

interface SmoothCaretProps {
  editor: Editor | null;
  zoomLevel?: number;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Calculates consistent cursor height based strictly on the block format,
 * identical to professional note apps (Apple Notes, Bear, VS Code).
 * It will NEVER jump between 18px and 26px on empty lines or spaces.
 */
function getFormatCursorHeight(state: any): number {
  if (!state || !state.selection) return 20;
  const { $from } = state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    const typeName = node.type.name;

    if (typeName === "heading") {
      const level = node.attrs.level || 1;
      if (level === 1) return 30; // Heading 1: 30px
      if (level === 2) return 25; // Heading 2: 25px
      if (level === 3) return 22; // Heading 3: 22px
    }
    if (typeName === "codeBlock") {
      return 18; // Code block: 18px
    }
  }

  // Consistent 20px height across normal paragraphs, checklists, bullet lists, blockquotes
  return 20;
}

export function SmoothCaret({
  editor,
  zoomLevel = 1.2,
  scrollContainerRef,
}: SmoothCaretProps) {
  const caretRef = useRef<HTMLDivElement>(null);
  const lastPosRef = useRef<{ x: number; y: number; height: number } | null>(null);
  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMouseDownRef = useRef(false);
  const [isEnabled, setIsEnabled] = useState(() => {
    const saved = localStorage.getItem("notefast_smooth_caret");
    return saved === null ? true : saved === "true";
  });

  // Sync dataset attribute on document root so CSS can toggle native caret cleanly
  useEffect(() => {
    document.documentElement.dataset.smoothCaret = isEnabled ? "true" : "false";
    localStorage.setItem("notefast_smooth_caret", String(isEnabled));
  }, [isEnabled]);

  // Listen to toggle events from Command Palette or shortcuts
  useEffect(() => {
    const handleToggle = (e: CustomEvent<{ enabled: boolean }>) => {
      setIsEnabled(e.detail.enabled);
    };
    window.addEventListener("notefast_toggle_smooth_caret" as any, handleToggle);
    return () => {
      window.removeEventListener("notefast_toggle_smooth_caret" as any, handleToggle);
    };
  }, []);

  const updatePosition = useCallback(
    (immediate = false) => {
      if (!editor || !caretRef.current || !editor.view) return;

      const caret = caretRef.current;
      const { state, view } = editor;

      // Hide if disabled, editor not focused, or text selection is a range
      if (!isEnabled || !view.hasFocus() || !state.selection.empty) {
        caret.style.opacity = "0";
        caret.classList.remove("is-blinking");
        caret.classList.remove("is-smooth");
        return;
      }

      try {
        const from = state.selection.from;
        const coords = view.coordsAtPos(from);
        const parent = caret.parentElement;
        if (!parent || !coords) return;

        // In WebKit, if DOM isn't laid out yet upon mounting, coords may be all zeros
        if (coords.left === 0 && coords.top === 0 && coords.bottom === 0) {
          requestAnimationFrame(() => updatePosition(true));
          return;
        }

        const parentRect = parent.getBoundingClientRect();
        const zoom = zoomLevel || 1;

        // Sub-pixel precision coordinates relative to the zoomed parent container
        const rawX = (coords.left - parentRect.left) / zoom;
        // Snap to Retina half-pixel grid to prevent sub-pixel jitter
        const x = Math.round(rawX * 2) / 2;

        // Format-based deterministic height (Apple Notes / Bear / VS Code)
        const targetHeight = getFormatCursorHeight(state);

        // Calculate invariant center-line Y position:
        // (coords.top + coords.bottom) / 2 represents the exact baseline center of the line box or glyph.
        // It stays 100% constant whether on an empty line (<p><br></p>) or typing text!
        const centerY = (coords.top + coords.bottom) / 2;
        const rawY = (centerY - parentRect.top) / zoom - targetHeight / 2;
        const y = Math.round(rawY * 2) / 2;

        const prev = lastPosRef.current;
        const isMouse = isMouseDownRef.current;
        // Snap instantly if jump is large (mouse click, note switch, distant line or page leap)
        const isFarJump = prev
          ? Math.abs(x - prev.x) > 200 || Math.abs(y - prev.y) > 40
          : false;

        if (immediate || isMouse || isFarJump || !prev) {
          // Instant snap without flight animation
          caret.classList.remove("is-smooth");
          caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          caret.style.height = `${targetHeight}px`;
          isMouseDownRef.current = false;
        } else {
          // VS Code smooth gliding animation: character-by-character fluid motion
          caret.classList.add("is-smooth");
          caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          caret.style.height = `${targetHeight}px`;
        }

        lastPosRef.current = { x, y, height: targetHeight };

        // Keep caret 100% solidly visible while actively typing (no blinking while typing)
        caret.style.opacity = "1";
        caret.classList.remove("is-blinking");

        // After 500ms of inactivity, resume gentle breathing pulse
        if (blinkTimeoutRef.current) {
          clearTimeout(blinkTimeoutRef.current);
        }
        blinkTimeoutRef.current = setTimeout(() => {
          if (view.hasFocus() && editor.state.selection.empty) {
            caret.classList.add("is-blinking");
          }
        }, 500);
      } catch {
        // Coords might be unavailable during rapid unmounts
      }
    },
    [editor, zoomLevel, isEnabled]
  );

  useEffect(() => {
    if (!editor || !isEnabled) {
      if (caretRef.current) {
        caretRef.current.style.opacity = "0";
      }
      return;
    }

    const dom = editor.view?.dom;

    // Detect mouse clicks so cursor jumps immediately without sliding across the note
    const handleMouseDown = () => {
      isMouseDownRef.current = true;
      if (caretRef.current) {
        caretRef.current.classList.remove("is-smooth");
      }
    };

    if (dom) {
      dom.addEventListener("mousedown", handleMouseDown, { capture: true });
    }

    // Coalesce rapid transaction and selectionUpdate emissions into a single microtask per tick.
    // This eliminates double reflows and ensures 0ms latency typing.
    let microtaskPending = false;
    let pendingImmediate = false;

    const scheduleUpdate = (immediate: boolean) => {
      if (immediate) pendingImmediate = true;
      if (microtaskPending) return;
      microtaskPending = true;
      queueMicrotask(() => {
        microtaskPending = false;
        const imm = pendingImmediate;
        pendingImmediate = false;
        updatePosition(imm);
      });
    };

    const handleImmediateUpdate = () => {
      scheduleUpdate(false);
    };

    const handleSnapUpdate = () => {
      scheduleUpdate(true);
    };

    editor.on("transaction", handleImmediateUpdate);
    editor.on("selectionUpdate", handleImmediateUpdate);
    editor.on("focus", handleSnapUpdate);
    editor.on("blur", handleSnapUpdate);

    const scrollEl = scrollContainerRef?.current;
    if (scrollEl) {
      // On scroll, snap immediately so caret stays glued to the text
      scrollEl.addEventListener("scroll", handleSnapUpdate, { passive: true });
    }
    window.addEventListener("resize", handleSnapUpdate);

    // Initial position on note load: snap instantly
    scheduleUpdate(true);

    return () => {
      if (dom) {
        dom.removeEventListener("mousedown", handleMouseDown, { capture: true });
      }
      editor.off("transaction", handleImmediateUpdate);
      editor.off("selectionUpdate", handleImmediateUpdate);
      editor.off("focus", handleSnapUpdate);
      editor.off("blur", handleSnapUpdate);

      if (scrollEl) {
        scrollEl.removeEventListener("scroll", handleSnapUpdate);
      }
      window.removeEventListener("resize", handleSnapUpdate);

      if (blinkTimeoutRef.current) {
        clearTimeout(blinkTimeoutRef.current);
      }
    };
  }, [editor, updatePosition, scrollContainerRef, isEnabled]);

  // Update on zoom change
  useEffect(() => {
    lastPosRef.current = null;
    updatePosition(true);
  }, [zoomLevel, updatePosition]);

  return <div ref={caretRef} className="notefast-smooth-caret" />;
}
