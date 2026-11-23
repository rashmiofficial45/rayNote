// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { CommandPalette } from "../CommandPalette";
import { NoteSummary } from "../../lib/db";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("CommandPalette Notes Search Integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockNotes: NoteSummary[] = [
    {
      id: "note-1",
      title: "System Architecture & Roadmap",
      preview: "Details about SQLite FTS5 indexing and speedups",
      created_at: "2026-10-29T10:00:00Z",
      updated_at: "2026-10-29T10:00:00Z",
      is_pinned: true,
    },
    {
      id: "note-2",
      title: "Groceries & Shopping",
      preview: "Milk, apples, coffee beans",
      created_at: "2026-10-29T09:00:00Z",
      updated_at: "2026-10-29T09:00:00Z",
      is_pinned: false,
    },
  ];

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

  it("does not show notes in Command Palette (notes are exclusive to Note Switcher)", () => {
    const onSelectNote = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <CommandPalette
          isOpen={true}
          onClose={onClose}
          notes={mockNotes}
          activeNoteId="note-2"
          zoomLevel={1.0}
          onNewNote={vi.fn()}
          onDuplicateNote={vi.fn()}
          onSelectNote={onSelectNote}
          onDeleteNote={vi.fn()}
          onTogglePin={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
        />
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toContain("Search commands & settings");

    // Type "Architecture" into search input (which matches note title in mockNotes, but not commands)
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "Architecture");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Notes must NOT appear in Command Palette
    expect(container.textContent).not.toContain("System Architecture & Roadmap");
    expect(container.textContent).not.toContain("Details about SQLite FTS5");
    expect(container.textContent).toContain('No matching commands for "Architecture"');
  });

  it("searches commands and actions cleanly without notes", () => {
    act(() => {
      root.render(
        <CommandPalette
          isOpen={true}
          onClose={vi.fn()}
          notes={mockNotes}
          activeNoteId={null}
          zoomLevel={1.0}
          onNewNote={vi.fn()}
          onDuplicateNote={vi.fn()}
          onSelectNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onTogglePin={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
        />
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "Font");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Editor Font Family");
    expect(container.textContent).not.toContain("Groceries & Shopping");
  });

  it.each([
    ["Green", { color: "green" }],
    ["Crosshatch", { style: "crosshatch" }],
    ["Clear highlight", null],
  ])("runs %s from the Highlight submenu using Enter", (label, options) => {
    const onHighlight = vi.fn();
    const onClose = vi.fn();
    act(() => root.render(
      <CommandPalette
        isOpen notes={mockNotes} activeNoteId="note-1" zoomLevel={1}
        onHighlight={onHighlight} onClose={onClose}
        onNewNote={vi.fn()} onDuplicateNote={vi.fn()} onSelectNote={vi.fn()}
        onDeleteNote={vi.fn()} onTogglePin={vi.fn()} onGoBack={vi.fn()} onGoForward={vi.fn()}
      />
    ));
    const command = [...container.querySelectorAll<HTMLButtonElement>(".command-item")]
      .find(button => button.querySelector(".command-item-label")?.textContent === "Highlight");
    expect(command).toBeDefined();
    act(() => command!.click());

    const input = container.querySelector("input")!;
    expect(input.placeholder).toContain("highlight colors");
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, label);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onHighlight).toHaveBeenCalledExactlyOnceWith(options);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("holds at the last command during key repeat and wraps on a fresh press", () => {
    act(() => root.render(
      <CommandPalette
        isOpen
        notes={mockNotes}
        activeNoteId={null}
        zoomLevel={1}
        onClose={vi.fn()}
        onNewNote={vi.fn()}
        onDuplicateNote={vi.fn()}
        onSelectNote={vi.fn()}
        onDeleteNote={vi.fn()}
        onTogglePin={vi.fn()}
        onGoBack={vi.fn()}
        onGoForward={vi.fn()}
      />
    ));

    const input = container.querySelector("input")!;
    const rows = [...container.querySelectorAll(".command-item")];
    const list = container.querySelector<HTMLElement>(".command-list")!;
    const press = (key: string, repeat = false) => act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, repeat, bubbles: true }));
    });

    press("ArrowUp");
    expect(container.querySelector(".is-selected")).toBe(rows[rows.length - 1]);
    press("ArrowDown", true);
    expect(container.querySelector(".is-selected")).toBe(rows[rows.length - 1]);
    press("ArrowDown");
    expect(container.querySelector(".is-selected")).toBe(rows[0]);

    press("ArrowDown");
    list.scrollTop = 20;
    act(() => rows[0].dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 30, bubbles: true })));
    expect(container.querySelector(".is-selected")).toBe(rows[0]);
    expect(list.scrollTop).toBe(20);
  });
});
