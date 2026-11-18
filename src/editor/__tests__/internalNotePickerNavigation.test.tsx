// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { InternalNoteLink, InternalNoteList, internalNoteLinkPluginKey, type InternalNoteListRef } from "../InternalNoteLink";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../lib/db", () => ({ getAllNotes: vi.fn().mockResolvedValue([]) }));

describe("internal note picker navigation", () => {
  it("moves one row at a time and reveals the active row in both directions", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const ref = createRef<InternalNoteListRef>();
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: String(index), title: `Note ${index}`, preview: "",
    }));
    act(() => root.render(<InternalNoteList ref={ref} items={items} command={vi.fn()} />));
    const list = host.querySelector(".internal-note-picker-list") as HTMLElement;
    Object.defineProperty(list, "clientHeight", { value: 60 });
    list.getBoundingClientRect = () => ({ top: 0, bottom: 60 } as DOMRect);
    Array.from(list.children).forEach((row, index) => {
      (row as HTMLElement).getBoundingClientRect = () => ({
        top: index * 30 - list.scrollTop,
        bottom: (index + 1) * 30 - list.scrollTop,
      } as DOMRect);
    });

    const press = (key: string) => act(() => ref.current!.onKeyDown({ event: new KeyboardEvent("keydown", { key }) }));
    for (let index = 1; index < items.length; index++) {
      press("ArrowDown");
      expect(list.querySelectorAll('[data-active="true"]')).toHaveLength(1);
      expect(list.querySelector('[data-active="true"]')?.textContent).toBe(`Note ${index}`);
    }
    expect(list.scrollTop).toBe(120);
    for (let index = 4; index >= 0; index--) {
      press("ArrowUp");
      expect(list.querySelector('[data-active="true"]')?.textContent).toBe(`Note ${index}`);
    }
    expect(list.scrollTop).toBe(0);
    act(() => root.unmount());
    host.remove();
  });

  it("keeps a multiword query active after typing [[", () => {
    const editor = new Editor({ extensions: [StarterKit, InternalNoteLink], content: "<p></p>" });
    editor.commands.focus();
    editor.commands.insertContent("[[system design");
    const suggestion = internalNoteLinkPluginKey.getState(editor.state);
    expect(suggestion?.active).toBe(true);
    expect(suggestion?.query).toBe("system design");
    editor.destroy();
  });
});
