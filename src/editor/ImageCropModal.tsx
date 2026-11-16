import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, RotateCcw, ChevronDown, Crop as CropIcon, Download } from "lucide-react";

export interface ImageCropModalProps {
  src: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (croppedDataUrl: string) => void;
  alt?: string;
}

type AspectRatioOption = "free" | "original" | "1:1" | "4:3" | "16:9" | "3:2";

interface AspectRatioItem {
  id: AspectRatioOption;
  label: string;
  ratio?: number; // width / height
}

export function ImageCropModal({
  src,
  isOpen,
  onClose,
  onSave,
  alt,
}: ImageCropModalProps) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number; left: number; top: number } | null>(null);
  
  // Crop rect in pixels relative to displaySize (left, top, width, height)
  const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>("free");
  const [isAspectMenuOpen, setIsAspectMenuOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageElementRef = useRef<HTMLImageElement>(null);

  // Aspect ratio presets
  const aspectOptions: AspectRatioItem[] = [
    { id: "free", label: "Freeform" },
    { id: "original", label: "Original", ratio: naturalSize ? naturalSize.width / naturalSize.height : 1 },
    { id: "1:1", label: "1:1 Square", ratio: 1 },
    { id: "4:3", label: "4:3 Standard", ratio: 4 / 3 },
    { id: "16:9", label: "16:9 Widescreen", ratio: 16 / 9 },
    { id: "3:2", label: "3:2 Photo", ratio: 3 / 2 },
  ];

  // Load natural dimensions of the image
  useEffect(() => {
    if (!isOpen || !src) return;
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = src;
  }, [isOpen, src]);

  // Compute display size fit into container
  const updateDisplaySize = useCallback(() => {
    if (!naturalSize || !containerRef.current) return;
    const container = containerRef.current;
    const availableWidth = container.clientWidth - 80;
    const availableHeight = container.clientHeight - 120;

    const scale = Math.min(
      availableWidth / naturalSize.width,
      availableHeight / naturalSize.height,
      1
    );

    const width = Math.round(naturalSize.width * scale);
    const height = Math.round(naturalSize.height * scale);
    const left = Math.round((container.clientWidth - width) / 2);
    const top = Math.round((container.clientHeight - height) / 2 + 20);

    setDisplaySize({ width, height, left, top });
    // Reset crop rect to full image on initial load
    setCropRect({ x: 0, y: 0, width, height });
  }, [naturalSize]);

  useEffect(() => {
    if (isOpen && naturalSize) {
      updateDisplaySize();
    }
  }, [isOpen, naturalSize, updateDisplaySize]);

  // Handle window resize
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("resize", updateDisplaySize);
    return () => window.removeEventListener("resize", updateDisplaySize);
  }, [isOpen, updateDisplaySize]);

  // Keyboard navigation: Escape to cancel, Enter to save
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Apply aspect ratio
  const applyAspectRatio = (ratioId: AspectRatioOption) => {
    setAspectRatio(ratioId);
    setIsAspectMenuOpen(false);
    if (!displaySize || !cropRect) return;

    if (ratioId === "free") return;

    const opt = aspectOptions.find((o) => o.id === ratioId);
    const targetRatio = opt?.ratio || 1;

    let newWidth = cropRect.width;
    let newHeight = Math.round(newWidth / targetRatio);

    if (newHeight > displaySize.height) {
      newHeight = displaySize.height;
      newWidth = Math.round(newHeight * targetRatio);
    }

    const newX = Math.max(0, Math.min(displaySize.width - newWidth, Math.round((displaySize.width - newWidth) / 2)));
    const newY = Math.max(0, Math.min(displaySize.height - newHeight, Math.round((displaySize.height - newHeight) / 2)));

    setCropRect({ x: newX, y: newY, width: newWidth, height: newHeight });
  };

  // Reset crop to full image
  const handleReset = () => {
    if (!displaySize) return;
    setAspectRatio("free");
    setCropRect({ x: 0, y: 0, width: displaySize.width, height: displaySize.height });
  };

  // Dragging crop handles or body
  const handleDragStart = (
    e: React.MouseEvent,
    handleType: "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!cropRect || !displaySize) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const initialRect = { ...cropRect };
    const selectedOption = aspectOptions.find((o) => o.id === aspectRatio);
    const forcedRatio = selectedOption?.ratio;

    const onMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let { x, y, width, height } = initialRect;
      const minSize = 40;

      if (handleType === "move") {
        x = Math.max(0, Math.min(displaySize.width - width, initialRect.x + deltaX));
        y = Math.max(0, Math.min(displaySize.height - height, initialRect.y + deltaY));
      } else {
        if (handleType.includes("e")) {
          width = Math.max(minSize, Math.min(displaySize.width - initialRect.x, initialRect.width + deltaX));
        }
        if (handleType.includes("w")) {
          const maxLeftShift = initialRect.x;
          const shift = Math.max(-maxLeftShift, Math.min(initialRect.width - minSize, deltaX));
          x = initialRect.x + shift;
          width = initialRect.width - shift;
        }
        if (handleType.includes("s")) {
          height = Math.max(minSize, Math.min(displaySize.height - initialRect.y, initialRect.height + deltaY));
        }
        if (handleType.includes("n")) {
          const maxTopShift = initialRect.y;
          const shift = Math.max(-maxTopShift, Math.min(initialRect.height - minSize, deltaY));
          y = initialRect.y + shift;
          height = initialRect.height - shift;
        }

        // Apply forced ratio if set
        if (forcedRatio) {
          if (handleType === "e" || handleType === "w") {
            height = Math.min(displaySize.height - y, Math.round(width / forcedRatio));
          } else {
            width = Math.min(displaySize.width - x, Math.round(height * forcedRatio));
          }
        }
      }

      setCropRect({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      upEvent.preventDefault();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Perform crop on HTML5 Canvas and save
  const handleSaveCrop = () => {
    if (!naturalSize || !displaySize || !cropRect) return;

    const scaleX = naturalSize.width / displaySize.width;
    const scaleY = naturalSize.height / displaySize.height;

    const realCropX = Math.round(cropRect.x * scaleX);
    const realCropY = Math.round(cropRect.y * scaleY);
    const realCropWidth = Math.round(cropRect.width * scaleX);
    const realCropHeight = Math.round(cropRect.height * scaleY);

    const canvas = document.createElement("canvas");
    canvas.width = realCropWidth;
    canvas.height = realCropHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.drawImage(
        img,
        realCropX,
        realCropY,
        realCropWidth,
        realCropHeight,
        0,
        0,
        realCropWidth,
        realCropHeight
      );
      const croppedDataUrl = canvas.toDataURL("image/png");
      onSave(croppedDataUrl);
      onClose();
    };
    img.src = src;
  };

  // Download image (current cropped preview if active, or original src)
  const handleDownload = () => {
    if (!src) return;

    if (
      naturalSize &&
      displaySize &&
      cropRect &&
      (cropRect.x !== 0 ||
        cropRect.y !== 0 ||
        cropRect.width !== displaySize.width ||
        cropRect.height !== displaySize.height)
    ) {
      const scaleX = naturalSize.width / displaySize.width;
      const scaleY = naturalSize.height / displaySize.height;

      const realCropX = Math.round(cropRect.x * scaleX);
      const realCropY = Math.round(cropRect.y * scaleY);
      const realCropWidth = Math.round(cropRect.width * scaleX);
      const realCropHeight = Math.round(cropRect.height * scaleY);

      const canvas = document.createElement("canvas");
      canvas.width = realCropWidth;
      canvas.height = realCropHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          ctx.drawImage(
            img,
            realCropX,
            realCropY,
            realCropWidth,
            realCropHeight,
            0,
            0,
            realCropWidth,
            realCropHeight
          );
          const dataUrl = canvas.toDataURL("image/png");
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = alt || `raynote-cropped-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        };
        img.src = src;
        return;
      }
    }

    const a = document.createElement("a");
    a.href = src;
    a.download = alt || `raynote-image-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[10000] flex flex-col bg-neutral-950/95 backdrop-blur-2xl select-none animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === containerRef.current) onClose();
      }}
    >
      {/* Top Header Bar */}
      <div className="relative z-50 flex h-14 w-full items-center justify-between border-b border-white/10 px-6 bg-neutral-900/70 dark:bg-neutral-950/80 backdrop-blur-2xl">
        {/* Left: Aspect Ratio Dropdown */}
        <div className="relative">
          <button
            type="button"
            className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/15 hover:text-white transition-all active:scale-95"
            onClick={() => setIsAspectMenuOpen((prev) => !prev)}
          >
            <CropIcon size={14} className="text-blue-400" />
            <span>{aspectOptions.find((o) => o.id === aspectRatio)?.label}</span>
            <ChevronDown size={13} className="text-neutral-400" />
          </button>

          {isAspectMenuOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-white/15 bg-neutral-900/95 p-1 shadow-2xl backdrop-blur-xl">
              {aspectOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors ${
                    aspectRatio === opt.id
                      ? "bg-blue-500/20 text-blue-400 font-semibold"
                      : "text-neutral-300 hover:bg-white/10 hover:text-white"
                  }`}
                  onClick={() => applyAspectRatio(opt.id)}
                >
                  <span>{opt.label}</span>
                  {aspectRatio === opt.id && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Center: Title & Reset */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-neutral-100 tracking-wide">Crop & Edit Image</span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            onClick={handleReset}
            title="Reset crop area to full image"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>

        {/* Right: Download, Cancel & Save Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 hover:bg-white/20 px-3.5 py-1.5 text-xs font-medium text-neutral-200 hover:text-white transition-all active:scale-95 shadow-sm"
            onClick={handleDownload}
            title="Download image"
          >
            <Download size={14} className="text-blue-400" />
            <span>Download</span>
          </button>

          <button
            type="button"
            className="rounded-full px-3.5 py-1.5 text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/10 transition-all active:scale-95"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-blue-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            onClick={handleSaveCrop}
          >
            <Check size={14} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Main Cropping Canvas */}
      <div className="relative flex-1 overflow-hidden flex items-center justify-center p-6">
        {displaySize && (
          <div
            className="relative"
            style={{
              width: displaySize.width,
              height: displaySize.height,
            }}
          >
            {/* The Background Display Image */}
            <img
              ref={imageElementRef}
              src={src}
              alt="Crop preview"
              className="block w-full h-full select-none object-contain rounded-lg"
              draggable={false}
            />

            {/* The Interactive Crop Box */}
            {cropRect && (
              <div
                className="absolute z-20 cursor-move border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]"
                style={{
                  left: cropRect.x,
                  top: cropRect.y,
                  width: cropRect.width,
                  height: cropRect.height,
                }}
                onMouseDown={(e) => handleDragStart(e, "move")}
              >
                {/* Rule of Thirds Grid Lines */}
                <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                  <div className="w-full border-b border-dashed border-white/30 h-1/3" />
                  <div className="w-full border-b border-dashed border-white/30 h-1/3" />
                </div>
                <div className="pointer-events-none absolute inset-0 flex justify-between">
                  <div className="h-full border-r border-dashed border-white/30 w-1/3" />
                  <div className="h-full border-r border-dashed border-white/30 w-1/3" />
                </div>

                {/* Notion-style L-shaped Corner Brackets */}
                {/* Top-Left */}
                <div
                  className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-white cursor-nw-resize z-30"
                  onMouseDown={(e) => handleDragStart(e, "nw")}
                />
                {/* Top-Right */}
                <div
                  className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-white cursor-ne-resize z-30"
                  onMouseDown={(e) => handleDragStart(e, "ne")}
                />
                {/* Bottom-Left */}
                <div
                  className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-white cursor-sw-resize z-30"
                  onMouseDown={(e) => handleDragStart(e, "sw")}
                />
                {/* Bottom-Right */}
                <div
                  className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-white cursor-se-resize z-30"
                  onMouseDown={(e) => handleDragStart(e, "se")}
                />

                {/* Edge Center Pill Handles */}
                {/* Top */}
                <div
                  className="absolute left-1/2 -top-1.5 -translate-x-1/2 w-6 h-1.5 rounded-full bg-white cursor-n-resize z-30"
                  onMouseDown={(e) => handleDragStart(e, "n")}
                />
                {/* Bottom */}
                <div
                  className="absolute left-1/2 -bottom-1.5 -translate-x-1/2 w-6 h-1.5 rounded-full bg-white cursor-s-resize z-30"
                  onMouseDown={(e) => handleDragStart(e, "s")}
                />
                {/* Left */}
                <div
                  className="absolute top-1/2 -left-1.5 -translate-y-1/2 h-6 w-1.5 rounded-full bg-white cursor-w-resize z-30"
                  onMouseDown={(e) => handleDragStart(e, "w")}
                />
                {/* Right */}
                <div
                  className="absolute top-1/2 -right-1.5 -translate-y-1/2 h-6 w-1.5 rounded-full bg-white cursor-e-resize z-30"
                  onMouseDown={(e) => handleDragStart(e, "e")}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
