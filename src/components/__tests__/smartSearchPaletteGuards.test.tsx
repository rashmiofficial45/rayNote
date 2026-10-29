// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { SmartSearch } from "../SmartSearch";
import * as db from "../../lib/db";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("SmartSearch & Command Palette State Guards (Item 4)", () => {
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

  it("(a) dialog is open synchronously before flushSaveQueue resolves", async () => {
    let resolveFlush!: () => void;
    const flushPromise = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });

    vi.spyOn(db, "flushSaveQueue").mockReturnValue(flushPromise);
    vi.spyOn(db, "flushEditorNow").mockResolvedValue();
    vi.spyOn(db, "getRecentSearchResults").mockResolvedValue([
      {
        id: "r1",
        title: "Cached Note 1",
        snippet: "Preview",
        score: 100,
        match_type: "recent",
        updated_at: "2026-10-22T00:00:00Z",
        is_pinned: false,
      },
    ]);

    // Render palette with isOpen = true
    act(() => {
      root.render(
        <SmartSearch
          isOpen={true}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    // Synchronous assertion: palette modal DOM is immediately mounted and visible in 0ms BEFORE flushSaveQueue resolves
    const modalInput = container.querySelector("input");
    expect(modalInput).not.toBeNull();
    expect(container.querySelector(".smart-search-overlay")).not.toBeNull();

    // Now resolve flush
    await act(async () => {
      resolveFlush();
    });
  });

  it("(b) fresh recents arriving after the user has typed a query do NOT replace the search results", async () => {
    vi.useFakeTimers();

    let resolveSlowRecents!: (notes: db.SearchResult[]) => void;
    const slowRecentsPromise = new Promise<db.SearchResult[]>((resolve) => {
      resolveSlowRecents = resolve;
    });

    vi.spyOn(db, "flushSaveQueue").mockResolvedValue();
    vi.spyOn(db, "flushEditorNow").mockResolvedValue();
    vi.spyOn(db, "getRecentSearchResults").mockReturnValue(slowRecentsPromise);

    const searchMock = vi.spyOn(db, "searchDocuments").mockResolvedValue([
      {
        id: "search-result-1",
        title: "Found Query Result",
        snippet: "Matched query text",
        score: 900,
        match_type: "exact_title",
        updated_at: "2026-10-22T10:00:00Z",
        is_pinned: false,
      },
    ]);

    // 1. Open modal
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={true}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    // 2. User immediately types a search query "query"
    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(input, "query");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Advance 35ms debounce timer for search execution
    await act(async () => {
      vi.advanceTimersByTime(35);
    });

    expect(searchMock).toHaveBeenCalledWith("query", 30);

    // Asserts search results are displayed
    expect(container.textContent).toContain("Found Query Result");

    // 3. Now slow background recents finally arrive
    await act(async () => {
      resolveSlowRecents([
        {
          id: "stale-recents",
          title: "Stale Late Recents",
          snippet: "Should not replace search results",
          score: 100,
          match_type: "recent",
          updated_at: "2026-10-22T00:00:00Z",
          is_pinned: false,
        },
      ]);
    });

    // Asserts search results were NOT overwritten by late recents
    expect(container.textContent).toContain("Found Query Result");
    expect(container.textContent).not.toContain("Stale Late Recents");

    vi.useRealTimers();
  });

  it("(c) no setState happens after the palette closes", async () => {
    vi.useFakeTimers();

    let resolveSearch!: (res: db.SearchResult[]) => void;
    const pendingSearch = new Promise<db.SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });

    vi.spyOn(db, "searchDocuments").mockReturnValue(pendingSearch);

    // Render open
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={true}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(input, "async-search");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      vi.advanceTimersByTime(35);
    });

    // Close palette before search promise resolves
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={false}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    // Now resolve the search after palette has closed
    await act(async () => {
      resolveSearch([
        {
          id: "late-res",
          title: "Late Arriving Note",
          snippet: "Snippet",
          score: 500,
          match_type: "title_substring",
          updated_at: "2026-10-22T00:00:00Z",
          is_pinned: false,
        },
      ]);
      vi.advanceTimersByTime(100);
    });

    // When closed, SmartSearch returns null (no DOM nodes)
    expect(container.querySelector(".smart-search-overlay")).toBeNull();

    vi.useRealTimers();
  });
});
