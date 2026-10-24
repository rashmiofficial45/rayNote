// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { TitleBar } from "../TitleBar";
import { titleStore } from "../../lib/titleStore";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
  }),
}));

describe("TitleBar Note Switch Component Test (Item 6)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    titleStore.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    titleStore.reset();
    vi.restoreAllMocks();
  });

  it("renders real TitleBar and asserts first render after note switch never shows previous note title", () => {
    // 1. Initial render on Note A
    act(() => {
      root.render(
        <TitleBar
          title="Note A Original"
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    const titleEl = container.querySelector(".title-text");
    expect(titleEl).not.toBeNull();
    expect(titleEl?.textContent).toBe("Note A Original");

    // 2. User edits first line of Note A: external titleStore updates synchronously
    act(() => {
      titleStore.setTitle("Typed Title in Note A");
    });
    expect(titleEl?.textContent).toBe("Typed Title in Note A");

    // 3. User switches note to Note B:
    // In App.tsx: titleStore.reset() is called immediately, then TitleBar renders with new title
    act(() => {
      titleStore.reset();
      root.render(
        <TitleBar
          title="Note B Fresh"
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    // Assert that on the FIRST render after switch, TitleBar displays Note B Fresh
    // and NEVER shows "Typed Title in Note A" or "Note A Original"
    expect(titleEl?.textContent).toBe("Note B Fresh");
    expect(titleEl?.textContent).not.toContain("Note A");

    // 4. Note switch to an untitled empty note ("")
    act(() => {
      titleStore.reset();
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

    expect(titleEl?.textContent).toBe("Untitled");
  });
});
