import { describe, it, expect, vi } from "vitest";
import { SearchResult } from "../../lib/db";

/**
 * Controller modeling keyboard navigation and request cancellation in SmartSearch
 */
export class SmartSearchTestController {
  public query: string = "";
  public results: SearchResult[] = [];
  public selectedIndex: number = 0;
  public isOpen: boolean = false;
  public activeRequestId: number = 0;
  public onSelectNote: (id: string) => void;
  public onClose: () => void;

  constructor(onSelectNote: (id: string) => void, onClose: () => void) {
    this.onSelectNote = onSelectNote;
    this.onClose = onClose;
  }

  public open() {
    this.isOpen = true;
    this.query = "";
    this.selectedIndex = 0;
  }

  public close() {
    this.isOpen = false;
    this.onClose();
  }

  public handleKeyDown(key: string): boolean {
    if (!this.isOpen) return false;

    if (key === "ArrowDown") {
      if (this.results.length > 0) {
        this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
      }
      return true;
    }

    if (key === "ArrowUp") {
      if (this.results.length > 0) {
        this.selectedIndex =
          (this.selectedIndex - 1 + this.results.length) % this.results.length;
      }
      return true;
    }

    if (key === "Enter") {
      const selected = this.results[this.selectedIndex];
      if (selected) {
        this.onSelectNote(selected.id);
        this.close();
      }
      return true;
    }

    if (key === "Escape") {
      this.close();
      return true;
    }

    return false;
  }

  /**
   * Simulates initiating a search request and receiving its asynchronous response.
   */
  public initiateSearch(newQuery: string): number {
    this.query = newQuery;
    this.activeRequestId++;
    return this.activeRequestId;
  }

  public resolveSearch(requestId: number, results: SearchResult[]): boolean {
    // Stale response guard: reject if request ID does not match current active request
    if (requestId !== this.activeRequestId) {
      return false;
    }
    this.results = results;
    this.selectedIndex = 0;
    return true;
  }
}

describe("Smart Search - Keyboard Navigation & Selection Behavior", () => {
  const mockNotes: SearchResult[] = [
    {
      id: "note-1",
      title: "RayNote Roadmap",
      snippet: "Performance goals",
      score: 1000,
      match_type: "exact_title",
      updated_at: new Date().toISOString(),
      is_pinned: true,
    },
    {
      id: "note-2",
      title: "Cache Eviction",
      snippet: "LRU algorithm specs",
      score: 800,
      match_type: "title_prefix",
      updated_at: new Date().toISOString(),
      is_pinned: false,
    },
    {
      id: "note-3",
      title: "SQLite Migration",
      snippet: "FTS5 virtual table",
      score: 650,
      match_type: "title_substring",
      updated_at: new Date().toISOString(),
      is_pinned: false,
    },
  ];

  it("1. ArrowDown cycles forward through results and wraps around", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const ctrl = new SmartSearchTestController(onSelect, onClose);

    ctrl.open();
    ctrl.results = mockNotes;
    expect(ctrl.selectedIndex).toBe(0);

    ctrl.handleKeyDown("ArrowDown");
    expect(ctrl.selectedIndex).toBe(1);

    ctrl.handleKeyDown("ArrowDown");
    expect(ctrl.selectedIndex).toBe(2);

    // Wrap around to top
    ctrl.handleKeyDown("ArrowDown");
    expect(ctrl.selectedIndex).toBe(0);
  });

  it("2. ArrowUp cycles backward through results and wraps around", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const ctrl = new SmartSearchTestController(onSelect, onClose);

    ctrl.open();
    ctrl.results = mockNotes;
    expect(ctrl.selectedIndex).toBe(0);

    // Wrap backward to last item
    ctrl.handleKeyDown("ArrowUp");
    expect(ctrl.selectedIndex).toBe(2);

    ctrl.handleKeyDown("ArrowUp");
    expect(ctrl.selectedIndex).toBe(1);

    ctrl.handleKeyDown("ArrowUp");
    expect(ctrl.selectedIndex).toBe(0);
  });

  it("3. Enter opens selected note and dismisses overlay", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const ctrl = new SmartSearchTestController(onSelect, onClose);

    ctrl.open();
    ctrl.results = mockNotes;

    ctrl.handleKeyDown("ArrowDown"); // select note-2
    expect(ctrl.selectedIndex).toBe(1);

    ctrl.handleKeyDown("Enter");
    expect(onSelect).toHaveBeenCalledWith("note-2");
    expect(onClose).toHaveBeenCalled();
    expect(ctrl.isOpen).toBe(false);
  });

  it("4. Escape dismisses overlay without selecting", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const ctrl = new SmartSearchTestController(onSelect, onClose);

    ctrl.open();
    ctrl.results = mockNotes;

    ctrl.handleKeyDown("Escape");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(ctrl.isOpen).toBe(false);
  });

  it("5. Reopening Smart Search resets query and selection state", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const ctrl = new SmartSearchTestController(onSelect, onClose);

    ctrl.open();
    ctrl.query = "old stale query";
    ctrl.selectedIndex = 2;
    ctrl.close();

    // Reopen
    ctrl.open();
    expect(ctrl.query).toBe("");
    expect(ctrl.selectedIndex).toBe(0);
  });

  it("6. Single-selection invariant: exactly one item is selected at all times when typing new queries", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const ctrl = new SmartSearchTestController(onSelect, onClose);

    ctrl.open();
    ctrl.results = mockNotes;

    // Move to item 2
    ctrl.handleKeyDown("ArrowDown");
    ctrl.handleKeyDown("ArrowDown");
    expect(ctrl.selectedIndex).toBe(2);

    // Typing new query replaces results and resets selection strictly to top item (index 0)
    const req = ctrl.initiateSearch("sqlite");
    ctrl.resolveSearch(req, [mockNotes[2]]);
    expect(ctrl.selectedIndex).toBe(0);
    expect(ctrl.results).toHaveLength(1);

    // Verify index stays bounded and singular
    ctrl.handleKeyDown("ArrowDown");
    expect(ctrl.selectedIndex).toBe(0);
    ctrl.handleKeyDown("ArrowUp");
    expect(ctrl.selectedIndex).toBe(0);
  });
});

describe("Smart Search - Request Cancellation & Stale Response Rejection", () => {
  it("rejects outdated asynchronous responses when user continues typing", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const ctrl = new SmartSearchTestController(onSelect, onClose);

    ctrl.open();

    // Keystroke 1: "r"
    const req1 = ctrl.initiateSearch("r");

    // Keystroke 2: "ra"
    ctrl.initiateSearch("ra");

    // Keystroke 3: "ray"
    const req3 = ctrl.initiateSearch("ray");

    const req1Data: SearchResult[] = [
      {
        id: "stale-1",
        title: "Random Note",
        snippet: "",
        score: 100,
        match_type: "fuzzy_title",
        updated_at: new Date().toISOString(),
        is_pinned: false,
      },
    ];

    const req3Data: SearchResult[] = [
      {
        id: "fresh-3",
        title: "rayNote Guide",
        snippet: "",
        score: 1000,
        match_type: "exact_title",
        updated_at: new Date().toISOString(),
        is_pinned: false,
      },
    ];

    // Request 1 resolves late after Request 3 was already sent
    const appliedReq1 = ctrl.resolveSearch(req1, req1Data);
    expect(appliedReq1).toBe(false);
    expect(ctrl.results).toHaveLength(0); // must NOT be overwritten!

    // Request 3 resolves
    const appliedReq3 = ctrl.resolveSearch(req3, req3Data);
    expect(appliedReq3).toBe(true);
    expect(ctrl.results).toEqual(req3Data);
    expect(ctrl.results[0].id).toBe("fresh-3");
  });
});
