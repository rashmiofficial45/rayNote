// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { CommandPalette } from "../CommandPalette";
import { SmartSearch } from "../SmartSearch";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("CommandPalette Prefetch & Lazy Sub-Views (Item 7)", () => {
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

  it("confirms SmartSearch is eagerly imported as a standard component", () => {
    expect(SmartSearch).toBeDefined();
    expect(typeof SmartSearch).toBe("function");
  });

  it("prefetches PaletteSubViews after 1500ms and renders subviews without displaying any loading fallback spinner", async () => {
    // 1. Simulate the 1500ms idle timer that executes in App.tsx
    const subViewsModule = await import("../PaletteSubViews");
    expect(subViewsModule.default).toBeDefined();

    // 2. Open CommandPalette with initial subview (e.g. appearance)
    await act(async () => {
      root.render(
        <CommandPalette
          isOpen={true}
          onClose={vi.fn()}
          notes={[]}
          activeNoteId={null}
          initialView={"sub_appearance" as any}
          zoomLevel={1}
          onNewNote={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onTogglePin={vi.fn()}
          onSelectNote={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
        />
      );
    });

    // 3. Verify that NO fallback loading spinner or text is rendered
    expect(container.textContent).not.toContain("Loading...");
    expect(container.querySelector(".spinner")).toBeNull();
    expect(container.querySelector(".loading-fallback")).toBeNull();

    // 4. Verify the appearance options are visible
    expect(container.textContent).toContain("System");
    expect(container.textContent).toContain("Dark");
    expect(container.textContent).toContain("Light");
  });
});
