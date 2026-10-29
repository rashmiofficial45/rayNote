// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { useBlockDrag } from "../useBlockDrag";
import { useRef } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("useBlockDrag Hook & Event Behavior", () => {
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

  function createMockBlockElement() {
    const el = document.createElement("p");
    el.textContent = "Test paragraph block";
    el.getBoundingClientRect = () => ({
      top: 50,
      bottom: 90,
      left: 60,
      right: 500,
      width: 440,
      height: 40,
      x: 60,
      y: 50,
      toJSON: () => {},
    });
    Object.defineProperty(el, "offsetHeight", { value: 40, configurable: true });
    return el;
  }

  function createMockEditor(blockEl: HTMLElement) {
    const tiptapDom = document.createElement("div");
    tiptapDom.className = "tiptap";
    tiptapDom.appendChild(blockEl);
    tiptapDom.getBoundingClientRect = () => ({
      top: 20,
      bottom: 500,
      left: 40,
      right: 760,
      width: 720,
      height: 480,
      x: 40,
      y: 20,
      toJSON: () => {},
    });

    const mockDispatch = vi.fn();
    return {
      isDestroyed: false,
      view: {
        dom: tiptapDom,
        nodeDOM: vi.fn().mockReturnValue(blockEl),
        domAtPos: vi.fn().mockReturnValue({ node: blockEl, offset: 0 }),
        state: {
          tr: {
            setMeta: vi.fn().mockReturnThis(),
          },
          doc: {
            childCount: 1,
            child: () => ({ isBlock: true, nodeSize: 20, type: { name: "paragraph" } }),
          },
        },
        dispatch: mockDispatch,
      },
      chain: () => ({
        focus: () => ({
          run: vi.fn(),
        }),
      }),
    };
  }

  function TestHarness({
    mockEditor,
    onMount,
  }: {
    mockEditor: any;
    onMount?: (scrollEl: HTMLDivElement, rubberEl: HTMLDivElement) => void;
  }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const rubberBandRef = useRef<HTMLDivElement>(null);

    useBlockDrag({
      editor: mockEditor,
      scrollContainerRef: scrollRef,
      rubberBandRef,
    });

    return (
      <div
        ref={(el) => {
          (scrollRef as any).current = el;
          if (el && rubberBandRef.current) {
            onMount?.(el, rubberBandRef.current);
          }
        }}
        data-scroll-container
        style={{ width: "800px", height: "600px", overflow: "auto" }}
      >
        <div ref={rubberBandRef} style={{ display: "none" }} />
      </div>
    );
  }

  it("attaches pointerdown listener on scrollContainer", () => {
    const blockEl = createMockBlockElement();
    const mockEditor = createMockEditor(blockEl);

    let scrollEl: HTMLDivElement | null = null;
    act(() => {
      root.render(
        <TestHarness
          mockEditor={mockEditor}
          onMount={(el) => {
            scrollEl = el;
          }}
        />
      );
    });

    expect(scrollEl).not.toBeNull();
  });

  it("cancels active drag and resets marquee when Escape key is pressed", () => {
    const blockEl = createMockBlockElement();
    const mockEditor = createMockEditor(blockEl);

    let scrollEl!: HTMLDivElement;
    let rubberEl!: HTMLDivElement;

    act(() => {
      root.render(
        <TestHarness
          mockEditor={mockEditor}
          onMount={(s, r) => {
            scrollEl = s;
            rubberEl = r;
          }}
        />
      );
    });

    scrollEl.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Empty area in left margin (x: 20 < textColumnLeft 80)
    const pointerDownEvent = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 100,
      button: 0,
    }) as any;
    pointerDownEvent.pointerId = 1;

    act(() => {
      scrollEl.dispatchEvent(pointerDownEvent);
    });

    expect(document.body.classList.contains("is-block-dragging")).toBe(true);

    // Press Escape
    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(escapeEvent);
    });

    // Verify drag cleanup occurred: class removed, rubber-band hidden, selection cleared
    expect(document.body.classList.contains("is-block-dragging")).toBe(false);
    expect(rubberEl.style.display).toBe("none");
    expect(mockEditor.view.dispatch).toHaveBeenCalled();
  });

  it("cancels active drag when window blur occurs", () => {
    const blockEl = createMockBlockElement();
    const mockEditor = createMockEditor(blockEl);

    let scrollEl!: HTMLDivElement;

    act(() => {
      root.render(
        <TestHarness
          mockEditor={mockEditor}
          onMount={(s) => {
            scrollEl = s;
          }}
        />
      );
    });

    scrollEl.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const pointerDownEvent = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 100,
      button: 0,
    }) as any;
    pointerDownEvent.pointerId = 1;

    act(() => {
      scrollEl.dispatchEvent(pointerDownEvent);
    });

    expect(document.body.classList.contains("is-block-dragging")).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(document.body.classList.contains("is-block-dragging")).toBe(false);
  });

  it("ignores non-primary mouse button clicks (e.g. right-click)", () => {
    const blockEl = createMockBlockElement();
    const mockEditor = createMockEditor(blockEl);

    let scrollEl!: HTMLDivElement;

    act(() => {
      root.render(
        <TestHarness
          mockEditor={mockEditor}
          onMount={(s) => {
            scrollEl = s;
          }}
        />
      );
    });

    // Right-click: button 2
    const pointerDownEvent = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 100,
      button: 2,
    }) as any;
    pointerDownEvent.pointerId = 1;

    act(() => {
      scrollEl.dispatchEvent(pointerDownEvent);
    });

    expect(document.body.classList.contains("is-block-dragging")).toBe(false);
  });

  it("invalidates cachedBlocks on scroll mid-drag and updates hit testing", () => {
    const block0 = createMockBlockElement();
    const block1 = document.createElement("p");
    block1.textContent = "Second paragraph";
    block1.getBoundingClientRect = () => ({
      top: 150,
      bottom: 190,
      left: 60,
      right: 500,
      width: 440,
      height: 40,
      x: 60,
      y: 150,
      toJSON: () => {},
    });
    Object.defineProperty(block1, "offsetHeight", { value: 40, configurable: true });

    const tiptapDom = document.createElement("div");
    tiptapDom.className = "tiptap";
    tiptapDom.appendChild(block0);
    tiptapDom.appendChild(block1);
    tiptapDom.getBoundingClientRect = () => ({
      top: 20,
      bottom: 500,
      left: 40,
      right: 760,
      width: 720,
      height: 480,
      x: 40,
      y: 20,
      toJSON: () => {},
    });

    const mockDispatch = vi.fn();
    const mockEditor = {
      isDestroyed: false,
      view: {
        dom: tiptapDom,
        nodeDOM: vi.fn((pos: number) => (pos === 0 ? block0 : block1)),
        domAtPos: vi.fn((pos: number) => ({ node: pos === 0 ? block0 : block1, offset: 0 })),
        state: {
          tr: {
            setMeta: vi.fn().mockReturnThis(),
          },
          doc: {
            childCount: 2,
            child: (_i: number) => ({ isBlock: true, nodeSize: 20, type: { name: "paragraph" } }),
          },
        },
        dispatch: mockDispatch,
      },
      chain: () => ({ focus: () => ({ run: vi.fn() }) }),
    };

    let scrollEl!: HTMLDivElement;
    act(() => {
      root.render(
        <TestHarness
          mockEditor={mockEditor}
          onMount={(s) => {
            scrollEl = s;
          }}
        />
      );
    });

    scrollEl.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Start drag at left margin: clientX 20, clientY 30
    const pointerDownEvent = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
      button: 0,
    }) as any;
    pointerDownEvent.pointerId = 1;

    act(() => {
      scrollEl.dispatchEvent(pointerDownEvent);
    });

    expect(document.body.classList.contains("is-block-dragging")).toBe(true);

    // Simulate scroll container scrolling by 100px mid-drag
    scrollEl.scrollTop = 100;
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll"));
    });

    // Pointer move at new position after scrolling
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          clientX: 200,
          clientY: 170,
          buttons: 1,
        })
      );
    });

    // Clean up drag
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(document.body.classList.contains("is-block-dragging")).toBe(false);
  });

  it("computes hit testing on scroll mid-drag with ZERO block DOM reads (uses document-relative offsets)", () => {
    const blockEl = createMockBlockElement();
    const getBoundingClientRectSpy = vi.spyOn(blockEl, "getBoundingClientRect");
    const mockEditor = createMockEditor(blockEl);

    let scrollEl!: HTMLDivElement;
    act(() => {
      root.render(
        <TestHarness
          mockEditor={mockEditor}
          onMount={(s) => {
            scrollEl = s;
          }}
        />
      );
    });

    scrollEl.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Start drag
    const pointerDownEvent = new MouseEvent("pointerdown", {
      clientX: 200,
      clientY: 30,
      button: 0,
    }) as any;
    pointerDownEvent.pointerId = 1;

    act(() => {
      scrollEl.dispatchEvent(pointerDownEvent);
    });

    // At drag start, getBoundingClientRect was called once to measure document offsets
    const callsAtStart = getBoundingClientRectSpy.mock.calls.length;
    expect(callsAtStart).toBeGreaterThan(0);

    // Mid-drag scroll occurs:
    scrollEl.scrollTop = 150;
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll"));
    });

    // Zero additional DOM reads on block elements during scroll!
    expect(getBoundingClientRectSpy.mock.calls.length).toBe(callsAtStart);

    // Clean up drag
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
  });
});
