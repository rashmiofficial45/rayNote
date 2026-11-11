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

describe("Editor Secondary Click (Context Menu) Integration", () => {
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
