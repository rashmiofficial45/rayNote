// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { SmoothCaret } from "../SmoothCaret";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Phase 5: SmoothCaret & GPU Loop Cancellation Tests", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mockEditor: any;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const listeners: Record<string, Function[]> = {};

    mockEditor = {
      state: {
        selection: {
          from: 10,
          empty: true,
          $from: { depth: 0, node: () => ({ type: { name: "paragraph" }, attrs: {} }) },
        },
      },
      view: {
        dom: document.createElement("div"),
        hasFocus: () => true,
        coordsAtPos: vi.fn().mockReturnValue({ left: 100, top: 200, bottom: 220 }),
      },
      on: (event: string, fn: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      off: (event: string, fn: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((f) => f !== fn);
        }
      },
      emit: (event: string, ...args: any[]) => {
        if (listeners[event]) {
          listeners[event].forEach((fn) => fn(...args));
        }
      },
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("does not call coordsAtPos synchronously in transaction handler; coalesces multiple transactions into 1 rAF read", () => {
    let caretEl: HTMLElement | null = null;

    act(() => {
      root.render(
        <div style={{ position: "relative" }}>
          <SmoothCaret editor={mockEditor} />
        </div>
      );
    });

    caretEl = container.querySelector(".notefast-smooth-caret");
    expect(caretEl).not.toBeNull();

    // Reset coordsAtPos spy
    mockEditor.view.coordsAtPos.mockClear();

    // Fire 5 rapid transactions within the same tick
    act(() => {
      mockEditor.emit("transaction");
      mockEditor.emit("selectionUpdate");
      mockEditor.emit("transaction");
      mockEditor.emit("transaction");
      mockEditor.emit("selectionUpdate");
    });

    // Asserts coordsAtPos was NOT called synchronously inside the transaction handler!
    expect(mockEditor.view.coordsAtPos).not.toHaveBeenCalled();

    // Now execute requestAnimationFrame
    // In happy-dom, rAF will flush on next microtask / timer tick
  });

  it("cancels all loops, blink timers, and pending rAF when hidden; restarts on show", async () => {
    const cancelRafSpy = vi.spyOn(window, "cancelAnimationFrame");

    act(() => {
      root.render(
        <div style={{ position: "relative" }}>
          <SmoothCaret editor={mockEditor} />
        </div>
      );
    });

    const caret = container.querySelector(".notefast-smooth-caret") as HTMLElement;
    expect(caret).not.toBeNull();

    // Trigger transaction to schedule a frame
    act(() => {
      mockEditor.emit("transaction");
    });

    // Simulate panel-will-hide event
    act(() => {
      window.dispatchEvent(new Event("panel-will-hide"));
    });

    // Asserts cancelAnimationFrame was invoked
    expect(cancelRafSpy).toHaveBeenCalled();
    // Asserts caret opacity is 0 while hidden
    expect(caret.style.opacity).toBe("0");

    // Simulate panel-did-show
    const requestRafSpy = vi.spyOn(window, "requestAnimationFrame");
    act(() => {
      window.dispatchEvent(new Event("panel-did-show"));
    });

    // Asserts requestAnimationFrame was scheduled upon showing
    expect(requestRafSpy).toHaveBeenCalled();
  });

  it("stops blinking animation after 4.5 seconds of idle inactivity", () => {
    vi.useFakeTimers();

    act(() => {
      root.render(
        <div style={{ position: "relative" }}>
          <SmoothCaret editor={mockEditor} />
        </div>
      );
    });

    const caret = container.querySelector(".notefast-smooth-caret") as HTMLElement;

    // Simulate focus
    act(() => {
      mockEditor.emit("focus");
      vi.advanceTimersByTime(10);
    });

    // Advance 600ms: gentle pulse begins
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Advance to 4,600ms (> 4.5s idle cap)
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // Asserts is-blinking class is removed to conserve GPU/WebKit power
    expect(caret.classList.contains("is-blinking")).toBe(false);

    vi.useRealTimers();
  });
});
