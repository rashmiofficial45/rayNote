import { describe, it, expect } from "vitest";

// Frame computation logic matching WindowResizeHandles for all 8 resize directions
interface NativeWindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;

function computeNewFrame(
  direction: string,
  startFrame: NativeWindowFrame,
  deltaX: number,
  deltaY: number
): NativeWindowFrame {
  let x = startFrame.x;
  let y = startFrame.y;
  let width = startFrame.width;
  let height = startFrame.height;

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
      height = Math.max(MIN_HEIGHT, startFrame.height - deltaY);
      break;
    }
    case "South": {
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
}

describe("WindowResizeHandles Coordinate Math", () => {
  const initialFrame: NativeWindowFrame = {
    x: 100,
    y: 200,
    width: 380,
    height: 600,
  };

  it("resizes East correctly (expanding right, left origin fixed)", () => {
    const frame = computeNewFrame("East", initialFrame, 50, 0);
    expect(frame.width).toBe(430);
    expect(frame.x).toBe(100);
    expect(frame.height).toBe(600);
  });

  it("resizes West correctly (expanding left, right edge fixed)", () => {
    const frame = computeNewFrame("West", initialFrame, -50, 0);
    expect(frame.width).toBe(430);
    expect(frame.x).toBe(50);
    expect(frame.x + frame.width).toBe(initialFrame.x + initialFrame.width);
  });

  it("resizes North correctly (expanding top in Cocoa coordinates, bottom origin fixed)", () => {
    // In web, dragging UP gives deltaY = -80
    const frame = computeNewFrame("North", initialFrame, 0, -80);
    expect(frame.height).toBe(680);
    expect(frame.y).toBe(200);
  });

  it("resizes South correctly (expanding bottom in Cocoa coordinates, top edge fixed)", () => {
    // In web, dragging DOWN gives deltaY = +50
    const frame = computeNewFrame("South", initialFrame, 0, 50);
    expect(frame.height).toBe(650);
    expect(frame.y).toBe(150);
    expect(frame.y + frame.height).toBe(initialFrame.y + initialFrame.height);
  });

  it("enforces MIN_WIDTH and MIN_HEIGHT constraints", () => {
    const shrunk = computeNewFrame("SouthWest", initialFrame, 300, -500);
    expect(shrunk.width).toBe(MIN_WIDTH);
    expect(shrunk.height).toBe(MIN_HEIGHT);
  });

  it("resizes NorthEast corner accurately", () => {
    const frame = computeNewFrame("NorthEast", initialFrame, 40, -60);
    expect(frame.width).toBe(420);
    expect(frame.height).toBe(660);
    expect(frame.x).toBe(100);
    expect(frame.y).toBe(200);
  });
});
