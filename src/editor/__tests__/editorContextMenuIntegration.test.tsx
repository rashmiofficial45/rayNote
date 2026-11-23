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

  it("consumes only outward wheel events at the scroll boundaries", async () => {
    await act(async () => root.render(
      <Editor noteId="wheel-edge" initialContent="# Title" onUpdate={vi.fn()} />
    ));
    const container = host.querySelector<HTMLElement>("[data-scroll-container]")!;
    Object.defineProperties(container, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1000 },
    });
    const wheel = (deltaY: number) => container.dispatchEvent(
      new WheelEvent("wheel", { deltaY, cancelable: true, bubbles: true })
    );
    const scroll = (top: number) => {
      container.scrollTop = top;
      container.dispatchEvent(new Event("scroll"));
    };
    scroll(0);
    expect(wheel(-12)).toBe(false);
    expect(wheel(12)).toBe(true);
    scroll(400);
    expect(wheel(12)).toBe(true);
    expect(wheel(-12)).toBe(true);
    scroll(800);
    expect(wheel(12)).toBe(false);
    expect(wheel(-12)).toBe(true);
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
