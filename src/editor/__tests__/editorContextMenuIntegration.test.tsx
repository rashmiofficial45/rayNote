// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "../Editor";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    onFocusChanged: vi.fn().mockResolvedValue(vi.fn()),
    isFocused: vi.fn().mockResolvedValue(true),
    listen: vi.fn().mockResolvedValue(vi.fn()),
  }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Editor pointer interactions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.restoreAllMocks();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    document.querySelectorAll(".editor-context-menu").forEach((el) => el.remove());
  });

  it("keeps typing on the slash line after a mouse click in the portalled menu", async () => {
    await act(async () => root.render(
      <Editor noteId="slash-click" initialContent="# Title" onUpdate={vi.fn()} />
    ));
    const editor = Reflect.get(window, "__RAYNOTE_EDITOR__") as import("@tiptap/core").Editor;
    await act(async () => {
      editor.commands.setContent("<h1>Title</h1><p></p><p>Below</p>");
      editor.view.focus();
      editor.commands.setTextSelection(8);
      editor.view.dispatch(editor.state.tr.insertText("/"));
    });
    const option = document.querySelector<HTMLButtonElement>(".slash-command-item");
    expect(option).toBeTruthy();
    await act(async () => {
      option!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      option!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 250 }));
    });
    await act(async () => { editor.commands.insertContent("Here"); });
    expect(editor.state.doc.child(1).textContent).toBe("Here");
    expect(editor.state.doc.child(2).textContent).toBe("Below");
  });

  it("blocks only outward vertical wheel input at document boundaries", async () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
      observe() {}
      disconnect() {}
    });

    try {
      await act(async () => root.render(
        <Editor noteId="wheel-edge" initialContent="# Title" onUpdate={vi.fn()} />
      ));
      const container = host.querySelector<HTMLElement>("[data-scroll-container]")!;
      let height = 1000;
      Object.defineProperties(container, {
        clientHeight: { value: 200 },
        scrollHeight: { get: () => height },
      });
      const resize = async () => await act(async () => {
        for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
      });
      await resize();

      const wheel = (deltaY: number, options?: WheelEventInit, target = container) => {
        const event = new WheelEvent("wheel", { deltaY, cancelable: true, bubbles: true, ...options });
        // Happy DOM's WheelEvent omits MouseEvent modifier properties.
        Object.defineProperty(event, "ctrlKey", { value: options?.ctrlKey ?? false });
        return target.dispatchEvent(event);
      };
      const scroll = (top: number) => {
        container.scrollTop = top;
        container.dispatchEvent(new Event("scroll"));
      };

      scroll(0);
      expect(wheel(-12)).toBe(false);
      expect(wheel(12)).toBe(true);
      expect(wheel(-12, { ctrlKey: true })).toBe(true);
      expect(wheel(-12, { deltaX: 30 })).toBe(true);

      const nestedScroller = document.createElement("div");
      nestedScroller.style.overflowY = "auto";
      Object.defineProperties(nestedScroller, {
        clientHeight: { value: 100 },
        scrollHeight: { value: 300 },
      });
      await act(async () => { container.firstElementChild!.append(nestedScroller); });
      nestedScroller.scrollTop = 100;
      expect(wheel(-12, {}, nestedScroller)).toBe(true);
      nestedScroller.scrollTop = 0;
      expect(wheel(-12, {}, nestedScroller)).toBe(false);

      const addListener = vi.spyOn(container, "addEventListener");
      const removeListener = vi.spyOn(container, "removeEventListener");
      scroll(400);
      expect(removeListener).toHaveBeenCalledWith("wheel", expect.any(Function));
      expect(wheel(12)).toBe(true);
      expect(wheel(-12)).toBe(true);
      scroll(800);
      expect(addListener).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: false });
      expect(wheel(12)).toBe(false);
      expect(wheel(-12)).toBe(true);

      height = 1600;
      await resize();
      expect(wheel(12)).toBe(true);
      scroll(1400);
      expect(wheel(12)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("suppresses default native context menu by calling preventDefault() on contextmenu event", async () => {
    await act(async () => {
      root.render(
        <Editor
          noteId="test-note-1"
          initialContent="<p>Test document content for context menu</p>"
          onUpdate={vi.fn()}
        />
      );
    });

    const scrollContainer = host.querySelector("[data-scroll-container]") as HTMLElement;
    expect(scrollContainer).not.toBeNull();

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 150,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    await act(async () => {
      scrollContainer.dispatchEvent(event);
    });

    // Native menu MUST be suppressed!
    expect(preventDefaultSpy).toHaveBeenCalled();

    // Custom menu must be rendered in DOM
    const menuEl = document.querySelector(".editor-context-menu");
    expect(menuEl).not.toBeNull();
  });

  it("closes context menu immediately when noteId changes (note switching)", async () => {
    await act(async () => {
      root.render(
        <Editor
          noteId="test-note-1"
          initialContent="<p>First note</p>"
          onUpdate={vi.fn()}
        />
      );
    });

    const scrollContainer = host.querySelector("[data-scroll-container]") as HTMLElement;

    // Open context menu
    await act(async () => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      });
      scrollContainer.dispatchEvent(event);
    });

    expect(document.querySelector(".editor-context-menu")).not.toBeNull();

    // Switch note
    await act(async () => {
      root.render(
        <Editor
          noteId="test-note-2"
          initialContent="<p>Second note</p>"
          onUpdate={vi.fn()}
        />
      );
    });

    // Menu MUST be dismissed on note switch!
    expect(document.querySelector(".editor-context-menu")).toBeNull();
  });

  it("does not trigger custom menu when right clicking outside editor surface (e.g. find bar)", async () => {
    await act(async () => {
      root.render(
        <Editor
          noteId="test-note-1"
          initialContent="<p>First note</p>"
          onUpdate={vi.fn()}
          isFindOpen={true}
        />
      );
    });

    const findBar = host.querySelector(".find-bar") as HTMLElement;
    if (findBar) {
      await act(async () => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 50,
          clientY: 50,
        });
        findBar.dispatchEvent(event);
      });

      // No editor context menu opened
      expect(document.querySelector(".editor-context-menu")).toBeNull();
    }
  });
});
