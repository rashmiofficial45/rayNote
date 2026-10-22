// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { TitleBar } from "../TitleBar";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
  }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("TitleBar UI Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders note title correctly", () => {
    act(() => {
      root.render(
        <TitleBar
          title="Meeting Notes with Team"
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    const titleEl = container.querySelector(".title-text");
    expect(titleEl?.textContent).toBe("Meeting Notes with Team");
  });

  it("renders 'Untitled' placeholder when title is empty or blank", () => {
    act(() => {
      root.render(
        <TitleBar
          title=""
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    const titleEl = container.querySelector(".title-text");
    expect(titleEl?.textContent).toBe("Untitled");
  });

  it("clicking Copy Markdown button calls onCopyMarkdown", () => {
    const onCopyMarkdown = vi.fn();

    act(() => {
      root.render(
        <TitleBar
          title="Test Note"
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={onCopyMarkdown}
        />
      );
    });

    const copyBtn = container.querySelector(".copy-md-btn") as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();

    act(() => {
      copyBtn.click();
    });

    expect(onCopyMarkdown).toHaveBeenCalled();
  });

  it("clicking Command Palette button calls onOpenCommandPalette", () => {
    const onOpenCommandPalette = vi.fn();

    act(() => {
      root.render(
        <TitleBar
          title="Test Note"
          onNewNote={vi.fn()}
          onOpenCommandPalette={onOpenCommandPalette}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    const cmdBtn = container.querySelector(".command-palette-btn") as HTMLButtonElement;
    expect(cmdBtn).not.toBeNull();

    act(() => {
      cmdBtn.click();
    });

    expect(onOpenCommandPalette).toHaveBeenCalled();
  });

  it("clicking Delete Note button calls onDeleteNote", () => {
    const onDeleteNote = vi.fn();

    act(() => {
      root.render(
        <TitleBar
          title="Test Note"
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={onDeleteNote}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    const deleteBtn = container.querySelector(".delete-btn") as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    act(() => {
      deleteBtn.click();
    });

    expect(onDeleteNote).toHaveBeenCalled();
  });

  it("clicking red close button invokes hide_window", () => {
    act(() => {
      root.render(
        <TitleBar
          title="Test Note"
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    const closeBtn = container.querySelector(".close-btn-x") as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    act(() => {
      closeBtn.click();
    });

    expect(invoke).toHaveBeenCalledWith("hide_window");
  });

  it("initiates native window drag on mousedown over titlebar but not over buttons", () => {
    act(() => {
      root.render(
        <TitleBar
          title="Test Note"
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    const titleBar = container.querySelector(".title-bar") as HTMLDivElement;
    expect(titleBar).not.toBeNull();

    // Clicking titlebar background initiates start_native_drag
    act(() => {
      titleBar.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    });
    expect(invoke).toHaveBeenCalledWith("start_native_drag");

    // Clicking a button does NOT initiate drag
    (invoke as any).mockClear();
    const copyBtn = container.querySelector(".copy-md-btn") as HTMLButtonElement;
    act(() => {
      copyBtn.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
