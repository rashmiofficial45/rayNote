import React, { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export function WindowResizeHandles() {
  const handlePointerDown = useCallback((direction: ResizeDirection, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      getCurrentWindow().startResizeDragging(direction);
    } catch {
      // Ignored
    }
  }, []);

  return (
    <div className="window-resize-container" aria-hidden="true">
      {/* 4 Edges */}
      <div
        className="window-resize-handle edge-n"
        onPointerDown={(e) => handlePointerDown("North", e)}
      />
      <div
        className="window-resize-handle edge-s"
        onPointerDown={(e) => handlePointerDown("South", e)}
      />
      <div
        className="window-resize-handle edge-w"
        onPointerDown={(e) => handlePointerDown("West", e)}
      />
      <div
        className="window-resize-handle edge-e"
        onPointerDown={(e) => handlePointerDown("East", e)}
      />

      {/* 4 Corners */}
      <div
        className="window-resize-handle corner-nw"
        onPointerDown={(e) => handlePointerDown("NorthWest", e)}
      />
      <div
        className="window-resize-handle corner-ne"
        onPointerDown={(e) => handlePointerDown("NorthEast", e)}
      />
      <div
        className="window-resize-handle corner-sw"
        onPointerDown={(e) => handlePointerDown("SouthWest", e)}
      />
      <div
        className="window-resize-handle corner-se"
        onPointerDown={(e) => handlePointerDown("SouthEast", e)}
      />
    </div>
  );
}
