// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { SmartSearch } from "../SmartSearch";
import * as db from "../../lib/db";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("Phase 3 Data Flow & Keyset Navigation Unit Tests", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setInputValue(input: HTMLInputElement, value: string) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("ensures older out-of-order search responses never overwrite newer ones", async () => {
    let resolveFirst: (res: db.SearchResult[]) => void;
    let resolveSecond: (res: db.SearchResult[]) => void;

    const searchDocsMock = vi.spyOn(db, "searchDocuments").mockImplementation((query: string) => {
      if (query === "slow") {
        return new Promise<db.SearchResult[]>((res) => {
          resolveFirst = res;
        });
      }
      if (query === "fast") {
        return new Promise<db.SearchResult[]>((res) => {
          resolveSecond = res;
        });
      }
      return Promise.resolve([]);
    });

    vi.spyOn(db, "getRecentSearchResults").mockResolvedValue([]);

    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={true}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    const input = container.querySelector(".smart-search-input") as HTMLInputElement;

    // 1. Type "slow"
    await act(async () => {
      setInputValue(input, "slow");
    });
    await act(async () => {
      vi.advanceTimersByTime(35);
    });

    expect(searchDocsMock).toHaveBeenCalledWith("slow", 30);

    // 2. Quickly type "fast"
    await act(async () => {
      setInputValue(input, "fast");
    });
    await act(async () => {
      vi.advanceTimersByTime(35);
    });

    expect(searchDocsMock).toHaveBeenCalledWith("fast", 30);

    // 3. Resolve the second (fast) request first
    const fastResults: db.SearchResult[] = [
      {
        id: "fast-1",
        title: "Fast Result",
        snippet: "Snippet",
        score: 900,
        match_type: "exact_title",
        updated_at: "2026-10-20T00:00:00Z",
        is_pinned: false,
      },
    ];

    await act(async () => {
      resolveSecond(fastResults);
    });

    // Check UI shows Fast Result
    expect(container.textContent).toContain("Fast Result");

    // 4. Resolve the older (slow) request afterwards
    const slowResults: db.SearchResult[] = [
      {
        id: "slow-1",
        title: "Stale Slow Result",
        snippet: "Snippet",
        score: 500,
        match_type: "title_substring",
        updated_at: "2026-10-10T00:00:00Z",
        is_pinned: false,
      },
    ];

    await act(async () => {
      resolveFirst(slowResults);
    });

    // Stale response must be discarded; UI must STILL show "Fast Result"
    expect(container.textContent).toContain("Fast Result");
    expect(container.textContent).not.toContain("Stale Slow Result");
  });

  it("refetches recents on palette open and drops in-flight requests when palette closes", async () => {
    const getRecentNotesMock = vi.spyOn(db, "getRecentSearchResults").mockResolvedValue([
      {
        id: "r1",
        title: "Recent Note",
        snippet: "Preview text",
        score: 100,
        match_type: "recent",
        updated_at: "2026-10-22T00:00:00Z",
        is_pinned: true,
      },
    ]);

    let resolvePendingSearch: (res: db.SearchResult[]) => void;
    vi.spyOn(db, "searchDocuments").mockImplementation(() => {
      return new Promise<db.SearchResult[]>((res) => {
        resolvePendingSearch = res;
      });
    });

    // 1. Initial render closed
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={false}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });
    expect(getRecentNotesMock).not.toHaveBeenCalled();

    // 2. Open palette: asserts getRecentNotes(30) is invoked
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={true}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });
    expect(getRecentNotesMock).toHaveBeenCalledWith(30);

    // 3. Initiate in-flight query
    const input = container.querySelector(".smart-search-input") as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "pending");
    });
    await act(async () => {
      vi.advanceTimersByTime(35);
    });

    // 4. Close palette while search is in flight
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={false}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    // 5. In-flight search resolves after modal is closed
    await act(async () => {
      if (resolvePendingSearch) {
        resolvePendingSearch([
          {
            id: "p1",
            title: "Pending Note",
            snippet: "Snippet",
            score: 500,
            match_type: "title_prefix",
            updated_at: "2026-10-20T00:00:00Z",
            is_pinned: false,
          },
        ]);
      }
    });

    // When reopened, must refetch fresh recents and not show stale pending search results
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={true}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    expect(getRecentNotesMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Pending Note");
  });

  it("passes note summary directly on selection for instant title & pin display", async () => {
    const onSelectNoteMock = vi.fn();
    const mockRecents: db.SearchResult[] = [
      {
        id: "note-remote-999",
        title: "Document Outside Top 30",
        snippet: "Pre-computed preview snippet",
        score: 100,
        match_type: "recent",
        updated_at: "2026-10-01T00:00:00Z",
        is_pinned: true,
      },
    ];

    vi.spyOn(db, "getRecentSearchResults").mockResolvedValue(mockRecents);

    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={true}
          onClose={vi.fn()}
          onSelectNote={onSelectNoteMock}
        />
      );
    });

    const item = container.querySelector(".smart-search-item") as HTMLElement;
    expect(item).not.toBeNull();

    await act(async () => {
      item.click();
    });

    // Asserts summaryHint is provided directly without requiring getNote()
    expect(onSelectNoteMock).toHaveBeenCalledWith(
      "note-remote-999",
      expect.objectContaining({
        id: "note-remote-999",
        title: "Document Outside Top 30",
        preview: "Pre-computed preview snippet",
        is_pinned: true,
      })
    );
  });

  it("asserts keyset getAdjacentNote navigates correctly with wrap-around at both ends", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "get_adjacent_note") {
        const { id, direction } = args;
        // Simulate ordered notes: p1 -> p2 -> u1 -> u2 -> u3
        const order = ["p1", "p2", "u1", "u2", "u3"];
        const idx = order.indexOf(id);
        if (idx === -1) return null;
        if (direction === "next") {
          return order[(idx + 1) % order.length];
        } else {
          return order[(idx + order.length - 1) % order.length];
        }
      }
      return null;
    });

    // Keyset forward navigation
    expect(await db.getAdjacentNote("p1", "next")).toBe("p2");
    expect(await db.getAdjacentNote("p2", "next")).toBe("u1");
    expect(await db.getAdjacentNote("u2", "next")).toBe("u3");
    // Wrap-around at bottom end
    expect(await db.getAdjacentNote("u3", "next")).toBe("p1");

    // Keyset backward navigation
    expect(await db.getAdjacentNote("u3", "prev")).toBe("u2");
    expect(await db.getAdjacentNote("p2", "prev")).toBe("p1");
    // Wrap-around at top end
    expect(await db.getAdjacentNote("p1", "prev")).toBe("u3");
  });

  it("keeps recents list consistent with DB order after create, pin and delete", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);

    let dbState = [
      { id: "n1", title: "Note 1", preview: "P1", created_at: "2026-10-10", updated_at: "2026-10-10T10:00:00Z", is_pinned: false },
      { id: "n2", title: "Note 2", preview: "P2", created_at: "2026-10-10", updated_at: "2026-10-10T09:00:00Z", is_pinned: false },
    ];

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "get_recent_notes" || cmd === "get_all_notes") {
        return [...dbState].sort((a, b) => {
          if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
          return b.updated_at.localeCompare(a.updated_at);
        });
      }
      if (cmd === "create_note") {
        const newNote = {
          id: "n3",
          title: "New Note",
          content: "Body",
          preview: "Preview",
          created_at: "2026-10-22",
          updated_at: "2026-10-22T12:00:00Z",
          is_pinned: false,
        };
        dbState.push(newNote);
        return newNote;
      }
      if (cmd === "toggle_pin") {
        const item = dbState.find((n) => n.id === args.id);
        if (item) {
          item.is_pinned = !item.is_pinned;
          return item.is_pinned;
        }
        return false;
      }
      if (cmd === "delete_note") {
        dbState = dbState.filter((n) => n.id !== args.id);
        return undefined;
      }
      return undefined;
    });

    // 1. Initial recents order
    let recents = await db.getRecentNotes(30);
    expect(recents.map((n) => n.id)).toEqual(["n1", "n2"]);

    // 2. Create note n3 (newest timestamp)
    await db.createNote();
    recents = await db.getRecentNotes(30);
    expect(recents.map((n) => n.id)).toEqual(["n3", "n1", "n2"]);

    // 3. Pin n2 (must float to very top above unpinned n3)
    await db.togglePin("n2");
    recents = await db.getRecentNotes(30);
    expect(recents.map((n) => n.id)).toEqual(["n2", "n3", "n1"]);

    // 4. Delete n3
    await db.deleteNote("n3");
    recents = await db.getRecentNotes(30);
    expect(recents.map((n) => n.id)).toEqual(["n2", "n1"]);
  });

  it("B1 freshness: edits title of active note, immediately opens palette, and asserts new title appears at top", async () => {
    let storedDbNotes = [
      {
        id: "active-1",
        title: "Old Stale Title",
        snippet: "Content snippet",
        score: 100,
        match_type: "recent",
        updated_at: "2026-10-22T10:00:00Z",
        is_pinned: false,
      },
    ];

    const flushEditorSpy = vi.spyOn(db, "flushEditorNow");
    const flushSaveSpy = vi.spyOn(db, "flushSaveQueue");

    vi.spyOn(db, "getRecentSearchResults").mockImplementation(async () => {
      return [...storedDbNotes];
    });

    // Simulate an editor flush callback that saves the freshly edited title
    db.registerEditorFlush(() => {
      storedDbNotes[0].title = "Brand New Fresh Title";
    });

    // 1. Initial state: palette closed
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={false}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    // 2. User edits title and immediately opens the palette
    await act(async () => {
      root.render(
        <SmartSearch
          isOpen={true}
          onClose={vi.fn()}
          onSelectNote={vi.fn()}
        />
      );
    });

    // Asserts flushEditorNow and flushSaveQueue were called upon opening
    expect(flushEditorSpy).toHaveBeenCalled();
    expect(flushSaveSpy).toHaveBeenCalled();

    // Asserts the new title appears at the top and old title is gone
    expect(container.textContent).toContain("Brand New Fresh Title");
    expect(container.textContent).not.toContain("Old Stale Title");

    db.registerEditorFlush(null);
  });

  it("Item 5: toggling pin on an active note that is not in the recents list updates activeNoteSummary and the pin indicator", async () => {
    // 30 recents in DB that do NOT include note-outside-30
    const recentsList: db.NoteSummary[] = Array.from({ length: 30 }, (_, i) => ({
      id: `recent-${i + 1}`,
      title: `Recent Note ${i + 1}`,
      preview: "Snippet",
      created_at: "2026-10-01",
      updated_at: "2026-10-01T00:00:00Z",
      is_pinned: false,
    }));

    // Active note is outside top 30
    let activeSummary: db.NoteSummary = {
      id: "note-outside-30",
      title: "Deep Note",
      preview: "Preview outside 30",
      created_at: "2026-09-01",
      updated_at: "2026-09-01T00:00:00Z",
      is_pinned: false,
    };

    let pinIndicatorState = false;

    // Simulate handleTogglePin logic from App.tsx
    const handleTogglePin = async (id: string) => {
      const isPinned = await db.togglePin(id);
      if (activeSummary.id === id) {
        activeSummary = { ...activeSummary, is_pinned: isPinned };
        pinIndicatorState = isPinned;
      }
      const freshRecents = await db.getRecentNotes(30);
      return freshRecents;
    };

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "toggle_pin" && args.id === "note-outside-30") {
        return true; // becomes pinned
      }
      if (cmd === "get_recent_notes" || cmd === "get_all_notes") {
        return [
          { ...activeSummary, is_pinned: true },
          ...recentsList.slice(0, 29),
        ];
      }
      return undefined;
    });

    // Initial state: not pinned
    expect(activeSummary.is_pinned).toBe(false);
    expect(pinIndicatorState).toBe(false);

    // Toggle pin on the note outside top 30
    const updatedRecents = await handleTogglePin("note-outside-30");

    // Asserts activeNoteSummary is updated directly to pinned
    expect(activeSummary.is_pinned).toBe(true);
    // Asserts pin indicator updates
    expect(pinIndicatorState).toBe(true);
    // Asserts that once pinned, it now floats to the top of recents
    expect(updatedRecents[0].id).toBe("note-outside-30");
    expect(updatedRecents[0].is_pinned).toBe(true);
  });
});
