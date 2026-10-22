// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { EditorCharCount } from "../Editor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("EditorCharCount Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  function createMockEditor(initialText = "") {
    let currentText = initialText;
    const listeners: Record<string, ((...args: any[]) => void)[]> = {};

    return {
      state: {
        doc: {
          get textContent() {
            return currentText;
          },
        },
      },
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
      }),
      off: vi.fn((event: string, callback: (...args: any[]) => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((cb) => cb !== callback);
        }
      }),
      emitTransaction(docChanged: boolean, newText?: string) {
        if (newText !== undefined) {
          currentText = newText;
        }
        const callbacks = listeners["transaction"] || [];
        callbacks.forEach((cb) => cb({ transaction: { docChanged } }));
      },
      setDocText(newText: string) {
        currentText = newText;
      },
      getListeners(event: string) {
        return listeners[event] || [];
      },
    };
  }

  it("renders 0 characters on empty initial document", () => {
    const mockEditor = createMockEditor("");

    act(() => {
      root.render(<EditorCharCount editor={mockEditor} noteId="note-1" />);
    });

    const el = container.querySelector(".editor-char-count");
    expect(el?.textContent).toBe("0 characters");
  });

  it("renders 1 character correctly with singular pluralization", () => {
    const mockEditor = createMockEditor("A");

    act(() => {
      root.render(<EditorCharCount editor={mockEditor} noteId="note-1" />);
    });

    const el = container.querySelector(".editor-char-count");
    expect(el?.textContent).toBe("1 character");
  });

  it("formats large character counts with commas", () => {
    const mockEditor = createMockEditor("x".repeat(12500));

    act(() => {
      root.render(<EditorCharCount editor={mockEditor} noteId="note-1" />);
    });

    const el = container.querySelector(".editor-char-count");
    expect(el?.textContent).toBe((12500).toLocaleString() + " characters");
  });

  it("updates count when document changes via transaction", () => {
    const mockEditor = createMockEditor("Hello");

    act(() => {
      root.render(<EditorCharCount editor={mockEditor} noteId="note-1" />);
    });

    let el = container.querySelector(".editor-char-count");
    expect(el?.textContent).toBe("5 characters");

    act(() => {
      mockEditor.emitTransaction(true, "Hello, world!");
    });

    el = container.querySelector(".editor-char-count");
    expect(el?.textContent).toBe("13 characters");
  });

  it("does not trigger recalculation or state update when transaction.docChanged is false", () => {
    const mockEditor = createMockEditor("Unchanged text");

    act(() => {
      root.render(<EditorCharCount editor={mockEditor} noteId="note-1" />);
    });

    let el = container.querySelector(".editor-char-count");
    expect(el?.textContent).toBe("14 characters");

    // Simulating cursor move / selection transaction without document change
    act(() => {
      mockEditor.emitTransaction(false);
    });

    el = container.querySelector(".editor-char-count");
    expect(el?.textContent).toBe("14 characters");
  });

  it("resynchronizes count when switching to a different note", () => {
    const mockEditor = createMockEditor("First Note Content");

    act(() => {
      root.render(<EditorCharCount editor={mockEditor} noteId="note-1" />);
    });

    expect(container.querySelector(".editor-char-count")?.textContent).toBe("18 characters");

    // Simulate switching active note
    mockEditor.setDocText("Short");
    act(() => {
      root.render(<EditorCharCount editor={mockEditor} noteId="note-2" />);
    });

    expect(container.querySelector(".editor-char-count")?.textContent).toBe("5 characters");
  });

  it("cleans up transaction listener on unmount", () => {
    const mockEditor = createMockEditor("Content");

    act(() => {
      root.render(<EditorCharCount editor={mockEditor} noteId="note-1" />);
    });

    expect(mockEditor.getListeners("transaction").length).toBe(1);

    act(() => {
      root.unmount();
    });

    expect(mockEditor.off).toHaveBeenCalledWith("transaction", expect.any(Function));
  });

  it("handles null editor gracefully without crashing", () => {
    act(() => {
      root.render(<EditorCharCount editor={null} noteId="note-1" />);
    });

    const el = container.querySelector(".editor-char-count");
    expect(el?.textContent).toBe("0 characters");
  });
});
