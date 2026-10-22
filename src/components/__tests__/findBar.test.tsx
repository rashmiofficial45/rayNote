// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../../editor/extensions";
import { FindBar } from "../FindBar";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("FindBar In-Note Search & Replace UI Component", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editor: Editor;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    editor = new Editor({
      extensions: getExtensions(),
      content: "<p>The quick brown fox jumps over the lazy dog. The fox is quick.</p>",
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    editor?.destroy();
    vi.restoreAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    act(() => {
      root.render(<FindBar isOpen={false} onClose={vi.fn()} editor={editor} />);
    });

    expect(container.querySelector(".find-bar-container")).toBeNull();
  });

  it("renders search input and controls when isOpen is true", () => {
    act(() => {
      root.render(<FindBar isOpen={true} onClose={vi.fn()} editor={editor} />);
    });

    const searchInput = container.querySelector(".find-bar-input") as HTMLInputElement;
    expect(searchInput).not.toBeNull();
    expect(searchInput.placeholder).toContain("Find in note");
  });

  it("typing search query triggers setSearchTerm and updates search storage", () => {
    act(() => {
      root.render(<FindBar isOpen={true} onClose={vi.fn()} editor={editor} />);
    });

    const searchInput = container.querySelector(".find-bar-input") as HTMLInputElement;
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(searchInput, "fox");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const searchStorage = (editor.storage as any).search;
    expect(searchStorage.searchTerm).toBe("fox");
    expect(searchStorage.results.length).toBe(2);
  });

  it("pressing Escape closes FindBar and clears search", () => {
    const onClose = vi.fn();
    // First set a search term
    editor.commands.setSearchTerm("fox");
    expect((editor.storage as any).search.searchTerm).toBe("fox");

    act(() => {
      root.render(<FindBar isOpen={true} onClose={onClose} editor={editor} />);
    });

    const searchInput = container.querySelector(".find-bar-input") as HTMLInputElement;
    act(() => {
      searchInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });

    expect(onClose).toHaveBeenCalled();
    expect((editor.storage as any).search.searchTerm).toBe("");
  });


  it("clicking close button invokes onClose", () => {
    const onClose = vi.fn();

    act(() => {
      root.render(<FindBar isOpen={true} onClose={onClose} editor={editor} />);
    });

    const closeBtn = container.querySelector(".find-bar-btn.close") as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    act(() => {
      closeBtn.click();
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("toggles replace row when replace toggle button is clicked", () => {
    act(() => {
      root.render(<FindBar isOpen={true} onClose={vi.fn()} editor={editor} />);
    });

    expect(container.querySelector(".replace-row")).toBeNull();

    const replaceToggleBtn = container.querySelector("button[title='Toggle Replace']") as HTMLButtonElement;
    expect(replaceToggleBtn).not.toBeNull();

    // Open replace row
    act(() => {
      replaceToggleBtn.click();
    });

    expect(container.querySelector(".replace-row")).not.toBeNull();
    const replaceInput = container.querySelector(".replace-row .find-bar-input") as HTMLInputElement;
    expect(replaceInput.placeholder).toContain("Replace with");

    // Close replace row
    act(() => {
      replaceToggleBtn.click();
    });

    expect(container.querySelector(".replace-row")).toBeNull();
  });
});
