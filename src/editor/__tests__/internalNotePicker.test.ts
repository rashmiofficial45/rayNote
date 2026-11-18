// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db", () => ({
  getAllNotes: vi.fn(),
}));

import { getAllNotes } from "../../lib/db";
import { InternalNoteLink } from "../InternalNoteLink";

describe("internal note suggestions", () => {
  it("loads all current notes and finds notes beyond the first page", async () => {
    const notes = Array.from({ length: 125 }, (_, index) => ({
      id: String(index), title: `Note ${index}`, preview: "", is_pinned: false,
    }));
    vi.mocked(getAllNotes).mockResolvedValue(notes as any);
    const items = InternalNoteLink.options.suggestion.items!;
    const search = (query: string) => items({ query, editor: null as any, signal: new AbortController().signal });

    expect(await search("")).toHaveLength(125);
    expect(await search("Note 124")).toEqual([notes[124]]);

    notes.push({ id: "new", title: "New note", preview: "", is_pinned: false });
    expect(await search("New note")).toEqual([notes[125]]);
    expect(getAllNotes).toHaveBeenCalledTimes(3);
  });
});
