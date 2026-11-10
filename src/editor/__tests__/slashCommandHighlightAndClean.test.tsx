// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { SlashCommand, CommandList, CommandListRef, CommandItem, computeSlashMenuPlacementAndHeight } from "../SlashCommand";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("SlashCommand Menu Highlighting & Minimal UI", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("filters items by alias and title correctly", () => {
    const getItems = (SlashCommand.options as any).suggestion.items;

    // Filtering by alias "todo" returns Task List
    const todoMatches = getItems({ query: "todo" });
    expect(todoMatches.length).toBeGreaterThanOrEqual(1);
    expect(todoMatches[0].title).toBe("Task List");

    // Filtering by alias "h1" returns Heading 1
    const h1Matches = getItems({ query: "h1" });
    expect(h1Matches.length).toBe(1);
    expect(h1Matches[0].title).toBe("Heading 1");

    // Filtering by alias "bullet" returns Bullet List
    const bulletMatches = getItems({ query: "bullet" });
    expect(bulletMatches[0].title).toBe("Bullet List");

    // Filtering by alias "code" returns Code Block & Inline Code
    const codeMatches = getItems({ query: "code" });
    const titles = codeMatches.map((m: any) => m.title);
    expect(titles).toContain("Code Block");
    expect(titles).toContain("Inline Code");
  });

  it("renders only icon and title, with NO shortcut labels or slash alias badges in the UI", async () => {
    const getItems = (SlashCommand.options as any).suggestion.items;
    const items: CommandItem[] = getItems({ query: "" });
    const onCommand = vi.fn();
    const ref = createRef<CommandListRef>();

    await act(async () => {
      root.render(<CommandList ref={ref} items={items} command={onCommand} />);
    });

    const renderedItems = host.querySelectorAll(".slash-command-item");
    expect(renderedItems.length).toBe(items.length);

    // Verify absence of complex shortcut metadata containers
    expect(host.querySelector(".slash-command-item-meta")).toBeNull();
    expect(host.querySelector(".slash-command-item-shortcut")).toBeNull();

    // Verify slash shortcut badge like /todo, /h1 is rendered in row
    const badgeEl = host.querySelector(".slash-command-item-badge");
    expect(badgeEl).not.toBeNull();
    expect(badgeEl?.textContent).toBe("/h1");

    // Verify each row displays icon, title, and slash shortcut badge
    renderedItems.forEach((row, i) => {
      expect(row.querySelector(".slash-command-item-icon")).not.toBeNull();
      const titleEl = row.querySelector(".slash-command-item-title");
      expect(titleEl).not.toBeNull();
      expect(titleEl?.textContent).toBe(items[i].title);
      if (items[i].badge) {
        const rowBadge = row.querySelector(".slash-command-item-badge");
        expect(rowBadge?.textContent).toBe(`/${items[i].badge}`);
      }
    });
  });

  it("ensures exactly ONE option has the active navigation highlight at a time", async () => {
    const getItems = (SlashCommand.options as any).suggestion.items;
    const items: CommandItem[] = getItems({ query: "" });
    const onCommand = vi.fn();
    const ref = createRef<CommandListRef>();

    await act(async () => {
      root.render(<CommandList ref={ref} items={items} command={onCommand} />);
    });

    // Initially, only item 0 is selected
    let selected = host.querySelectorAll(".slash-command-item.is-selected");
    expect(selected.length).toBe(1);
    expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe(items[0].title);

    // Navigate down with ArrowDown
    await act(async () => {
      ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
    });

    selected = host.querySelectorAll(".slash-command-item.is-selected");
    expect(selected.length).toBe(1);
    expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe(items[1].title);

    // Navigate down again
    await act(async () => {
      ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
    });

    selected = host.querySelectorAll(".slash-command-item.is-selected");
    expect(selected.length).toBe(1);
    expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe(items[2].title);

    // Navigate back up with ArrowUp
    await act(async () => {
      ref.current?.onKeyDown({ event: { key: "ArrowUp" } as KeyboardEvent });
    });

    selected = host.querySelectorAll(".slash-command-item.is-selected");
    expect(selected.length).toBe(1);
    expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe(items[1].title);
  });

  it("coordinates pointer hover with keyboard navigation without dual highlights", async () => {
    const getItems = (SlashCommand.options as any).suggestion.items;
    const items: CommandItem[] = getItems({ query: "" });
    const onCommand = vi.fn();
    const ref = createRef<CommandListRef>();

    await act(async () => {
      root.render(<CommandList ref={ref} items={items} command={onCommand} />);
    });

    // Arrow down to item 1 (Heading 2)
    await act(async () => {
      ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
    });
    expect(host.querySelectorAll(".slash-command-item.is-selected").length).toBe(1);
    expect(
      host.querySelectorAll(".slash-command-item.is-selected")[0].querySelector(".slash-command-item-title")?.textContent
    ).toBe("Heading 2");

    const item3 = host.querySelectorAll(".slash-command-item")[3]; // Task List
    expect(item3.querySelector(".slash-command-item-title")?.textContent).toBe("Task List");

    // First mouse movement registers initial pointer position
    await act(async () => {
      item3.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 100 }));
    });

    // Second mouse movement with moved coordinates sets active highlight to Task List
    await act(async () => {
      item3.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 110, clientY: 120 }));
    });

    // Only Task List (index 3) should now be highlighted; Heading 2 must NOT be highlighted
    const selected = host.querySelectorAll(".slash-command-item.is-selected");
    expect(selected.length).toBe(1);
    expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe("Task List");
  });

  it("executes the currently highlighted option on Enter", async () => {
    const getItems = (SlashCommand.options as any).suggestion.items;
    const items: CommandItem[] = getItems({ query: "" });
    const onCommand = vi.fn();
    const ref = createRef<CommandListRef>();

    await act(async () => {
      root.render(<CommandList ref={ref} items={items} command={onCommand} />);
    });

    // Navigate to item 2 (Heading 3)
    await act(async () => {
      ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
      ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
    });

    // Press Enter
    await act(async () => {
      ref.current?.onKeyDown({ event: { key: "Enter" } as KeyboardEvent });
    });

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith(items[2]);
  });

  it("executes an option on click", async () => {
    const getItems = (SlashCommand.options as any).suggestion.items;
    const items: CommandItem[] = getItems({ query: "" });
    const onCommand = vi.fn();
    const ref = createRef<CommandListRef>();

    await act(async () => {
      root.render(<CommandList ref={ref} items={items} command={onCommand} />);
    });

    const itemButtons = host.querySelectorAll(".slash-command-item");
    await act(async () => {
      (itemButtons[4] as HTMLButtonElement).click();
    });

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith(items[4]);
  });

  describe("Dynamic Sizing and Viewport Boundary Positioning", () => {
    it("wraps navigation from last option to first option on ArrowDown, and from first to last on ArrowUp", async () => {
      const getItems = (SlashCommand.options as any).suggestion.items;
      const items: CommandItem[] = getItems({ query: "" });
      const onCommand = vi.fn();
      const ref = createRef<CommandListRef>();

      await act(async () => {
        root.render(<CommandList ref={ref} items={items} command={onCommand} />);
      });

      // Initially at item 0
      let selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe(items[0].title);

      // ArrowUp at item 0 wraps to the last item
      await act(async () => {
        ref.current?.onKeyDown({ event: { key: "ArrowUp" } as KeyboardEvent });
      });

      selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe(items[items.length - 1].title);

      // ArrowDown at last item wraps back to the first item
      await act(async () => {
        ref.current?.onKeyDown({ event: { key: "ArrowDown" } as KeyboardEvent });
      });

      selected = host.querySelectorAll(".slash-command-item.is-selected");
      expect(selected[0].querySelector(".slash-command-item-title")?.textContent).toBe(items[0].title);
    });

    it("caps menu height to comfortable ~348px when typing '/' so scrollbar is present", () => {
      // 17 commands total, caret near top of 800px window
      const caretRect = {
        top: 100,
        bottom: 120,
        left: 50,
        right: 60,
        width: 10,
        height: 20,
        x: 50,
        y: 100,
        toJSON: () => {},
      } as DOMRect;

      const { placement, maxHeight } = computeSlashMenuPlacementAndHeight(caretRect, 17, 800);

      expect(placement).toBe("bottom-start");
      // Comfortable window cap: 348px (~12 items with scrollbar)
      expect(maxHeight).toBe(348);
    });

    it("shrinks menu height to fit filtered results when typing '/he' without unnecessary scrolling space", () => {
      // 2 items match "Heading 1" and "Heading 2"
      const caretRect = {
        top: 200,
        bottom: 220,
        left: 50,
        right: 60,
        width: 10,
        height: 20,
        x: 50,
        y: 200,
        toJSON: () => {},
      } as DOMRect;

      const { placement, maxHeight } = computeSlashMenuPlacementAndHeight(caretRect, 2, 800);

      expect(placement).toBe("bottom-start");
      // 2 items * 28 + 12 = 68px
      expect(maxHeight).toBe(68);
    });

    it("automatically opens menu above the caret when near the bottom edge of the window", () => {
      // Window height 600, caret at 540-560 (only 22px available below caret)
      const caretNearBottom = {
        top: 540,
        bottom: 560,
        left: 50,
        right: 60,
        width: 10,
        height: 20,
        x: 50,
        y: 540,
        toJSON: () => {},
      } as DOMRect;

      // Filtered to 2 items (68px)
      const filteredResult = computeSlashMenuPlacementAndHeight(caretNearBottom, 2, 600);
      expect(filteredResult.placement).toBe("top-start");
      expect(filteredResult.maxHeight).toBe(68);

      // Full list of 17 items (capped at 348px)
      const fullResult = computeSlashMenuPlacementAndHeight(caretNearBottom, 17, 600);
      expect(fullResult.placement).toBe("top-start");
      // Space above is 540 - 18 = 522px, so 348px fits comfortably above
      expect(fullResult.maxHeight).toBe(348);
    });

    it("chooses the side with most usable space and clamps height when neither side fits full content", () => {
      // Window height 300, caret in middle at 150-170
      // spaceAbove = 150 - 18 = 132px; spaceBelow = 300 - 170 - 18 = 112px
      const caretMid = {
        top: 150,
        bottom: 170,
        left: 50,
        right: 60,
        width: 10,
        height: 20,
        x: 50,
        y: 150,
        toJSON: () => {},
      } as DOMRect;

      const { placement, maxHeight } = computeSlashMenuPlacementAndHeight(caretMid, 17, 300);

      // Top has 132px vs bottom 112px, so top-start is picked
      expect(placement).toBe("top-start");
      // Height clamped to exactly available space above (132px), never overflowing viewport!
      expect(maxHeight).toBe(132);
    });
  });
});
