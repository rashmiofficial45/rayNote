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

  it("finds and displays matching notes at the top when searching in Command Palette", () => {
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
    expect(input.placeholder).toContain("Search notes, commands");

    // Type "Architecture" into search input
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "Architecture");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // The note title and preview should be present
    expect(container.textContent).toContain("System Architecture & Roadmap");
    expect(container.textContent).toContain("Details about SQLite FTS5");

    // Click the note item
    const noteBtn = Array.from(container.querySelectorAll(".command-item")).find(
      (btn) => btn.textContent?.includes("System Architecture")
    ) as HTMLButtonElement;

    expect(noteBtn).not.toBeNull();

    act(() => {
      noteBtn.click();
    });

    expect(onSelectNote).toHaveBeenCalledWith("note-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("finds notes by content preview snippet", () => {
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
      setter?.call(input, "coffee");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Groceries & Shopping");
    expect(container.textContent).toContain("coffee beans");
  });
});
