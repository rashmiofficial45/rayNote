import { useEffect, useRef, useCallback, useState } from "react";
import { Editor } from "@tiptap/react";
import { blockSelectionPluginKey } from "../extensions/BlockSelection";

interface SmoothCaretProps {
  editor: Editor | null;
  zoomLevel?: number;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  isFindOpen?: boolean;
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

export interface CaretCoords {
  left: number;
  top: number;
  bottom: number;
  right?: number;
}

export function isInvalidCoords(coords: CaretCoords | null | undefined): boolean {
  if (!coords) return true;
  return coords.left === 0 && coords.top === 0 && coords.bottom === 0;
}

export class SmoothCaretRetryController {
  public retryCount = 0;
  public readonly maxRetries = 3;

  public handleCoords(
    coords: CaretCoords | null | undefined,
    scheduleRetry: () => void
  ): boolean {
    if (isInvalidCoords(coords)) {
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        scheduleRetry();
        return true;
      }
      return false; // Limit reached: cap to prevent CPU runaway
    }
    this.retryCount = 0;
    return true;
  }

  public reset(): void {
    this.retryCount = 0;
  }
}

export function SmoothCaret({
  editor,
  zoomLevel = 1.2,
  scrollContainerRef: _scrollContainerRef,
  isFindOpen,
}: SmoothCaretProps) {
  const caretRef = useRef<HTMLDivElement>(null);
  const lastPosRef = useRef<{ x: number; y: number; height: number } | null>(null);
  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMouseDownRef = useRef(false);
  const retryControllerRef = useRef(new SmoothCaretRetryController());
  const rafIdRef = useRef<number | null>(null);
  const isDirtyRef = useRef(false);
  const pendingImmediateRef = useRef(false);

  const [isEnabled, setIsEnabled] = useState(() => {
    const saved = localStorage.getItem("notefast_smooth_caret");
    return saved === null ? true : saved === "true";
  });

  // Sync dataset attribute on document root so CSS can toggle native caret cleanly
  useEffect(() => {
    document.documentElement.dataset.smoothCaret = isEnabled ? "true" : "false";
    try {
      localStorage.setItem("notefast_smooth_caret", String(isEnabled));
    } catch {}
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

  /**
   * Executes layout reads (coordsAtPos, getBoundingClientRect) strictly inside
   * a single requestAnimationFrame after ProseMirror has completed its DOM update.
   */
  const renderCaretFrame = useCallback(() => {
    rafIdRef.current = null;
    if (!editor || !caretRef.current || !editor.view) return;

    const caret = caretRef.current;
    const { state, view } = editor;

    // Check visibility states
    const blockState = blockSelectionPluginKey.getState(state);
    const hasBlockSelection = Boolean(blockState && blockState.selectedPositions.length > 0);
    if (!isEnabled || !view.hasFocus() || !state.selection.empty || hasBlockSelection || document.hidden) {
      if (caret.style.opacity !== "0") {
        caret.style.opacity = "0";
      }
      if (caret.classList.contains("is-blinking")) {
        caret.classList.remove("is-blinking");
      }
      if (caret.classList.contains("is-smooth")) {
        caret.classList.remove("is-smooth");
      }
      isDirtyRef.current = false;
      return;
    }

    try {
      const from = state.selection.from;
      const coords = view.coordsAtPos(from);
      const parent = caret.parentElement;
      if (!parent || !coords) return;

      // In WebKit, if DOM isn't laid out yet upon mounting, coords may be all zeros.
      // Cap retries to 3 frames (~25ms) to prevent infinite 100% CPU spinning.
      if (isInvalidCoords(coords)) {
        retryControllerRef.current.handleCoords(coords, () => {
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(renderCaretFrame);
          }
        });
        return;
      }
      retryControllerRef.current.reset();

      const parentRect = parent.getBoundingClientRect();
      const zoom = zoomLevel || 1;

      // Sub-pixel precision coordinates relative to the zoomed parent container
      const rawX = (coords.left - parentRect.left) / zoom;
      // Snap to Retina half-pixel grid to prevent sub-pixel jitter
      const x = Math.round(rawX * 2) / 2;

      // Format-based deterministic height (Apple Notes / Bear / VS Code)
      const targetHeight = getFormatCursorHeight(state);

      // Invariant center-line Y position
      const centerY = (coords.top + coords.bottom) / 2;
      const rawY = (centerY - parentRect.top) / zoom - targetHeight / 2;
      const y = Math.round(rawY * 2) / 2;

      const prev = lastPosRef.current;
      const isMouse = isMouseDownRef.current;
      const immediate = pendingImmediateRef.current;
      pendingImmediateRef.current = false;

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
      isDirtyRef.current = false;

      // Keep caret 100% solidly visible while actively typing
      caret.style.opacity = "1";
      caret.classList.remove("is-blinking");

      // After 500ms of inactivity, resume gentle breathing pulse
      if (blinkTimeoutRef.current) {
        clearTimeout(blinkTimeoutRef.current);
      }
      if (blinkStopTimeoutRef.current) {
        clearTimeout(blinkStopTimeoutRef.current);
      }
      blinkTimeoutRef.current = setTimeout(() => {
        if (view.hasFocus() && editor.state.selection.empty && !document.hidden) {
          caret.classList.add("is-blinking");
        }
      }, 500);

      // Cap infinite blinking animation after 4.5s of inactivity (Apple Notes / Bear standard)
      // Prevents WebKit compositor thread from consuming CPU while idle
      blinkStopTimeoutRef.current = setTimeout(() => {
        caret.classList.remove("is-blinking");
        if (view.hasFocus() && editor.state.selection.empty) {
          caret.style.opacity = "1";
        }
      }, 4500);
    } catch {
      // Coords might be unavailable during rapid unmounts
    }
  }, [editor, zoomLevel, isEnabled]);

  /**
   * Schedules a single rAF pass without reading layout inside transaction handlers.
   */
  const scheduleCaretUpdate = useCallback((immediate = false) => {
    isDirtyRef.current = true;
    if (immediate) {
      pendingImmediateRef.current = true;
    }
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(renderCaretFrame);
    }
  }, [renderCaretFrame]);

  useEffect(() => {
    if (!editor || !isEnabled) {
      if (caretRef.current) {
        caretRef.current.style.opacity = "0";
      }
      return;
    }

    const dom = editor.view?.dom;

    const handleMouseDown = () => {
      isMouseDownRef.current = true;
      if (caretRef.current) {
        caretRef.current.classList.remove("is-smooth");
      }
    };

    const handleComposition = () => {
      scheduleCaretUpdate(true);
    };

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && dom) {
      try {
        resizeObserver = new ResizeObserver(() => {
          scheduleCaretUpdate(true);
        });
        resizeObserver.observe(dom);
      } catch {}
    }

    if (dom) {
      dom.addEventListener("mousedown", handleMouseDown, { capture: true });
      dom.addEventListener("compositionstart", handleComposition);
      dom.addEventListener("compositionupdate", handleComposition);
      dom.addEventListener("compositionend", handleComposition);
      dom.addEventListener("load", handleComposition, { capture: true });
    }

    // Zero layout reads inside transaction handlers: only mark dirty & schedule 1 rAF
    const handleTransaction = () => {
      scheduleCaretUpdate(false);
    };

    const handleFocus = () => {
      retryControllerRef.current.reset();
      scheduleCaretUpdate(true);
    };

    const handleBlur = () => {
      if (caretRef.current) {
        caretRef.current.style.opacity = "0";
        caretRef.current.classList.remove("is-blinking");
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      isDirtyRef.current = false;
    };

    // Cancellation and restart handlers on visibilitychange and panel-will-hide
    const handleCancelOnHide = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (blinkTimeoutRef.current) {
        clearTimeout(blinkTimeoutRef.current);
        blinkTimeoutRef.current = null;
      }
      if (blinkStopTimeoutRef.current) {
        clearTimeout(blinkStopTimeoutRef.current);
        blinkStopTimeoutRef.current = null;
      }
      if (caretRef.current) {
        caretRef.current.style.opacity = "0";
        caretRef.current.classList.remove("is-blinking");
      }
      isDirtyRef.current = false;
    };

    const handleRestartOnShow = () => {
      if (!document.hidden && editor && editor.view?.hasFocus()) {
        scheduleCaretUpdate(true);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleCancelOnHide();
      } else {
        handleRestartOnShow();
      }
    };

    editor.on("transaction", handleTransaction);
    editor.on("selectionUpdate", handleTransaction);
    editor.on("focus", handleFocus);
    editor.on("blur", handleBlur);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("panel-will-hide" as any, handleCancelOnHide);
    window.addEventListener("panel-did-show" as any, handleRestartOnShow);
    window.addEventListener("resize", handleFocus);

    // Initial position on mount
    scheduleCaretUpdate(true);

    return () => {
      if (resizeObserver) {
        try {
          resizeObserver.disconnect();
        } catch {}
      }
      if (dom) {
        dom.removeEventListener("mousedown", handleMouseDown, { capture: true });
        dom.removeEventListener("compositionstart", handleComposition);
        dom.removeEventListener("compositionupdate", handleComposition);
        dom.removeEventListener("compositionend", handleComposition);
        dom.removeEventListener("load", handleComposition, { capture: true });
      }
      editor.off("transaction", handleTransaction);
      editor.off("selectionUpdate", handleTransaction);
      editor.off("focus", handleFocus);
      editor.off("blur", handleBlur);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("panel-will-hide" as any, handleCancelOnHide);
      window.removeEventListener("panel-did-show" as any, handleRestartOnShow);
      window.removeEventListener("resize", handleFocus);

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (blinkTimeoutRef.current) {
        clearTimeout(blinkTimeoutRef.current);
      }
      if (blinkStopTimeoutRef.current) {
        clearTimeout(blinkStopTimeoutRef.current);
      }
    };
  }, [editor, scheduleCaretUpdate, isEnabled]);

  // Update on zoom change
  useEffect(() => {
    lastPosRef.current = null;
    scheduleCaretUpdate(true);
  }, [zoomLevel, scheduleCaretUpdate]);

  // Re-measure on find bar open/close
  useEffect(() => {
    scheduleCaretUpdate(true);
  }, [isFindOpen, scheduleCaretUpdate]);

  // Re-measure caret directly on font-family or font-size change
  useEffect(() => {
    const handleFontChange = () => {
      lastPosRef.current = null;
      scheduleCaretUpdate(true);
    };

    window.addEventListener("notefast_font_changed", handleFontChange);
    if (typeof document !== "undefined" && (document as any).fonts) {
      (document as any).fonts.ready?.then(handleFontChange).catch(() => {});
      (document as any).fonts.addEventListener?.("loadingdone", handleFontChange);
    }

    return () => {
      window.removeEventListener("notefast_font_changed", handleFontChange);
      if (typeof document !== "undefined" && (document as any).fonts) {
        (document as any).fonts.removeEventListener?.("loadingdone", handleFontChange);
      }
    };
  }, [scheduleCaretUpdate]);

  return <div ref={caretRef} className="notefast-smooth-caret" />;
}
