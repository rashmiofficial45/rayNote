import React, { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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

interface NativeWindowFrame {
  x: f64;
  y: f64;
  width: f64;
  height: f64;
}
type f64 = number;

interface ActiveDrag {
  direction: ResizeDirection;
  startScreenX: number;
  startScreenY: number;
  startFrame: NativeWindowFrame;
  lastFrame: NativeWindowFrame;
  pointerId: number;
  rafId: number | null;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;

export function WindowResizeHandles() {
  const activeDragRef = useRef<ActiveDrag | null>(null);

  const computeNewFrame = useCallback(
    (direction: ResizeDirection, startFrame: NativeWindowFrame, deltaX: number, deltaY: number): NativeWindowFrame => {
      let x = startFrame.x;
      let y = startFrame.y;
      let width = startFrame.width;
      let height = startFrame.height;

      // Cocoa coordinate system:
      // (0,0) is bottom-left of primary screen.
      // Origin (x, y) is bottom-left corner of the window.
      // - Moving mouse RIGHT (+deltaX): increases width or moves left origin right.
      // - Moving mouse UP (-deltaY): increases top edge (height increases, origin y unchanged).
      // - Moving mouse DOWN (+deltaY): increases bottom edge (height increases, origin y decreases).

      switch (direction) {
        case "East": {
          width = Math.max(MIN_WIDTH, startFrame.width + deltaX);
          break;
        }
        case "West": {
          const targetW = Math.max(MIN_WIDTH, startFrame.width - deltaX);
          x = startFrame.x + (startFrame.width - targetW);
          width = targetW;
          break;
        }
        case "North": {
          // Top edge: dragging UP (deltaY < 0) expands height
          height = Math.max(MIN_HEIGHT, startFrame.height - deltaY);
          break;
        }
        case "South": {
          // Bottom edge: dragging DOWN (deltaY > 0) expands height and moves origin y downwards
          const targetH = Math.max(MIN_HEIGHT, startFrame.height + deltaY);
          y = startFrame.y + (startFrame.height - targetH);
          height = targetH;
          break;
        }
        case "NorthEast": {
          width = Math.max(MIN_WIDTH, startFrame.width + deltaX);
          height = Math.max(MIN_HEIGHT, startFrame.height - deltaY);
          break;
        }
        case "NorthWest": {
          const targetW = Math.max(MIN_WIDTH, startFrame.width - deltaX);
          x = startFrame.x + (startFrame.width - targetW);
          width = targetW;
          height = Math.max(MIN_HEIGHT, startFrame.height - deltaY);
          break;
        }
        case "SouthEast": {
          width = Math.max(MIN_WIDTH, startFrame.width + deltaX);
          const targetH = Math.max(MIN_HEIGHT, startFrame.height + deltaY);
          y = startFrame.y + (startFrame.height - targetH);
          height = targetH;
          break;
        }
        case "SouthWest": {
          const targetW = Math.max(MIN_WIDTH, startFrame.width - deltaX);
          x = startFrame.x + (startFrame.width - targetW);
          width = targetW;
          const targetH = Math.max(MIN_HEIGHT, startFrame.height + deltaY);
          y = startFrame.y + (startFrame.height - targetH);
          height = targetH;
          break;
        }
      }

      return { x, y, width, height };
    },
    []
  );

  const handlePointerDown = useCallback(
    async (direction: ResizeDirection, e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const el = e.currentTarget;
      const pointerId = e.pointerId;

      try {
        el.setPointerCapture(pointerId);
      } catch {
        // Ignored if capture fails
      }

      const startScreenX = e.screenX;
      const startScreenY = e.screenY;

      try {
        // Query current native frame from Cocoa
        const startFrame = await invoke<NativeWindowFrame>("get_native_window_frame");
        activeDragRef.current = {
          direction,
          startScreenX,
          startScreenY,
          startFrame,
          lastFrame: startFrame,
          pointerId,
          rafId: null,
        };
      } catch {
        // Non-macOS or fallback: call standard Tauri resize dragging
        try {
          getCurrentWindow().startResizeDragging(direction);
        } catch {
          // Ignored
        }
      }
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      e.preventDefault();
      e.stopPropagation();

      const deltaX = e.screenX - drag.startScreenX;
      const deltaY = e.screenY - drag.startScreenY;

      const newFrame = computeNewFrame(drag.direction, drag.startFrame, deltaX, deltaY);
      drag.lastFrame = newFrame;

      if (drag.rafId === null) {
        drag.rafId = requestAnimationFrame(() => {
          if (!activeDragRef.current) return;
          activeDragRef.current.rafId = null;
          const frame = activeDragRef.current.lastFrame;
          invoke("set_native_window_frame", {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            save: false,
          }).catch(() => {});
        });
      }
    },
    [computeNewFrame]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      e.preventDefault();
      e.stopPropagation();

      try {
        e.currentTarget.releasePointerCapture(drag.pointerId);
      } catch {
        // Ignored
      }

      if (drag.rafId !== null) {
        cancelAnimationFrame(drag.rafId);
        drag.rafId = null;
      }

      const finalFrame = drag.lastFrame;
      activeDragRef.current = null;

      // Commit and save final frame to persistence
      invoke("set_native_window_frame", {
        x: finalFrame.x,
        y: finalFrame.y,
        width: finalFrame.width,
        height: finalFrame.height,
        save: true,
      }).catch(() => {});
    },
    []
  );

  return (
    <div className="window-resize-container" aria-hidden="true">
      {/* 4 Perimeter Edges (strictly 4px at the outer boundary) */}
      <div
        className="window-resize-handle edge-n"
        onPointerDown={(e) => handlePointerDown("North", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div
        className="window-resize-handle edge-s"
        onPointerDown={(e) => handlePointerDown("South", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div
        className="window-resize-handle edge-w"
        onPointerDown={(e) => handlePointerDown("West", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div
        className="window-resize-handle edge-e"
        onPointerDown={(e) => handlePointerDown("East", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      {/* 4 Perimeter Corners (compact 14px conforming to 28px rounded corners) */}
      <div
        className="window-resize-handle corner-nw"
        onPointerDown={(e) => handlePointerDown("NorthWest", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div
        className="window-resize-handle corner-ne"
        onPointerDown={(e) => handlePointerDown("NorthEast", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div
        className="window-resize-handle corner-sw"
        onPointerDown={(e) => handlePointerDown("SouthWest", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div
        className="window-resize-handle corner-se"
        onPointerDown={(e) => handlePointerDown("SouthEast", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
