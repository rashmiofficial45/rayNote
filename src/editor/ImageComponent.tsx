import React, { useState, useRef, useEffect, createContext, useContext } from "react";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  Crop as CropIcon,
} from "lucide-react";
import { ImageCropModal } from "./ImageCropModal";

export const ImageFullscreenContext = createContext(false);

export function ImageComponent({
  node,
  updateAttributes,
  selected,
  deleteNode,
}: NodeViewProps) {
  const isFullscreen = useContext(ImageFullscreenContext);
  const { src, alt, title, width, alignment = "center" } = node.attrs;

  const containerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const resize = useRef<{
    pointerId: number;
    startX: number;
    width: number;
    maxWidth: number;
    multiplier: number;
    originalStyle: string;
  } | null>(null);

  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isCropOpen, setIsCropOpen] = useState(false);

  // Track window resizing so floating controls don't show during screen/window resizing
  const [isWindowResizing, setIsWindowResizing] = useState(false);
  const windowResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsWindowResizing(true);
      if (windowResizeTimerRef.current) clearTimeout(windowResizeTimerRef.current);
      windowResizeTimerRef.current = setTimeout(() => {
        setIsWindowResizing(false);
      }, 200);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (windowResizeTimerRef.current) clearTimeout(windowResizeTimerRef.current);
    };
  }, []);

  // Compute active initial width
  const displayWidth =
    width && width !== "100%"
      ? typeof width === "number"
        ? `${width}px`
        : width
      : "100%";

  // Alignment classes for outer flex container
  const alignmentClass =
    alignment === "left"
      ? "justify-start"
      : alignment === "right"
      ? "justify-end"
      : "justify-center";

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>, side: "left" | "right") => {
    const box = boxRef.current;
    const container = containerRef.current;
    if (!isFullscreen || event.button !== 0 || resize.current || !box || !container || !box.offsetWidth) return;
    event.preventDefault();
    event.stopPropagation();
    const zoom = box.getBoundingClientRect().width / box.offsetWidth;
    if (zoom <= 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      width: box.offsetWidth,
      maxWidth: container.clientWidth,
      multiplier: (side === "right" ? 1 : -1) * (alignment === "center" ? 2 : 1) / zoom,
      originalStyle: box.style.width,
    };
    setIsResizing(true);
  };

  const getResizeWidth = (drag: NonNullable<typeof resize.current>, clientX: number) =>
    Math.round(Math.min(drag.maxWidth, Math.max(80, drag.width + (clientX - drag.startX) * drag.multiplier)));

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = resize.current;
    if (drag?.pointerId !== event.pointerId || !boxRef.current) return;
    boxRef.current.style.width = `${getResizeWidth(drag, event.clientX)}px`;
  };

  const finishResize = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = resize.current;
    const box = boxRef.current;
    if (drag?.pointerId !== event.pointerId || !box) return;
    resize.current = null;
    setIsResizing(false);
    if (commit && event.clientX !== drag.startX) {
      const nextWidth = `${getResizeWidth(drag, event.clientX)}px`;
      box.style.width = nextWidth;
      updateAttributes({ width: nextWidth });
    } else {
      box.style.width = drag.originalStyle;
    }
  };

  useEffect(() => {
    if (isFullscreen) return;
    setIsCropOpen(false);
    if (resize.current) {
      if (boxRef.current) boxRef.current.style.width = resize.current.originalStyle;
      resize.current = null;
      setIsResizing(false);
    }
  }, [isFullscreen]);

  // Floating controls: hide while resizing (image or window) or when not hovered/selected
  const showControls = !isResizing && !isWindowResizing && (selected || isHovered) && Boolean(src);
  // Resize handles: visible when hovered, selected, or actively resizing
  const showHandles = isFullscreen && (selected || isHovered || isResizing) && Boolean(src);

  return (
    <NodeViewWrapper
      ref={containerRef}
      className={`notefast-image-block my-4 flex w-full select-none ${alignmentClass} group relative`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-drag-handle
    >
      <div
        ref={boxRef}
        className="relative inline-block max-w-full group/box"
        style={{ width: displayWidth }}
      >
        {/* The Image Element */}
        <img
          src={src}
          alt={alt || "Image"}
          title={title || ""}
          className={`block h-auto w-full rounded-xl object-contain cursor-default transition-shadow duration-150 ${
            selected || isResizing
              ? "ring-2 ring-blue-500/70 shadow-lg shadow-blue-500/10"
              : "border border-black/10 dark:border-white/10 shadow-sm hover:ring-1 hover:ring-blue-400/40"
          }`}
          loading="lazy"
          draggable={false}
          onDoubleClick={isFullscreen ? () => setIsCropOpen(true) : undefined}
        />

        {showControls && (
          <div className="image-action-glass" role="group" aria-label="Image actions" contentEditable={false}
            onMouseDown={(event) => event.preventDefault()}>
            {isFullscreen && (
              <>
                <button type="button" className="image-crop-action" onClick={() => setIsCropOpen(true)} title="Crop image">
                  <CropIcon size={15} aria-hidden="true" />
                  <span>Crop</span>
                </button>
                {([
                  ["left", AlignLeft],
                  ["center", AlignCenter],
                  ["right", AlignRight],
                ] as const).map(([value, Icon]) => (
                  <button key={value} type="button" aria-pressed={alignment === value}
                    title={`Align ${value}`} onClick={() => updateAttributes({ alignment: value })}>
                    <Icon size={15} aria-hidden="true" />
                  </button>
                ))}
              </>
            )}
            <button type="button" className="image-delete-action" onClick={deleteNode} title="Delete image">
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        )}

        {showHandles && (["left", "right"] as const).map(side => (
          <div
            key={side}
            data-resize-handle={side}
            onPointerDown={(event) => handleResizeStart(event, side)}
            onPointerMove={handleResizeMove}
            onPointerUp={(event) => finishResize(event, true)}
            onPointerCancel={(event) => finishResize(event, false)}
            onLostPointerCapture={(event) => finishResize(event, false)}
            className={`image-resize-hit-area image-resize-hit-area-${side}`}
            title="Drag to resize image"
          >
            <div className="image-resize-grip" />
          </div>
        ))}
      </div>

      {/* Fullscreen Crop & Edit Modal */}
      {isFullscreen && isCropOpen && (
        <ImageCropModal
          src={src}
          alt={alt}
          isOpen={isCropOpen}
          onClose={() => setIsCropOpen(false)}
          onSave={(croppedDataUrl) => {
            updateAttributes({ src: croppedDataUrl });
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
