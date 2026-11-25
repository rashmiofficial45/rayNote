// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrashDialog } from "../TrashDialog";
import { listTrashedNotes, purgeTrashedNotes, restoreAllTrashedNotes } from "../../lib/db";

vi.mock("../../lib/db", () => ({
  listTrashedNotes: vi.fn(),
  purgeTrashedNote: vi.fn(),
  purgeTrashedNotes: vi.fn(),
  restoreAllTrashedNotes: vi.fn(),
  restoreTrashedNote: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Trash bulk actions", () => {
  let host: HTMLDivElement;
  let root: Root;
  const restored = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const initialNotes = [{ id: "1", title: "First note" }, { id: "2", title: "Second note" }];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTrashedNotes).mockResolvedValue(initialNotes);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const mount = () => act(async () => {
    root.render(<TrashDialog onClose={vi.fn()} onRestored={restored} onShowToast={showToast} toast={null} />);
  });
  const button = (name: string) => Array.from(host.querySelectorAll("button"))
    .find((element) => element.textContent?.trim() === name)!;
  const filter = (value: string) => act(async () => {
    const input = host.querySelector("input")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  it("restores all notes even when a search shows only one", async () => {
    vi.mocked(restoreAllTrashedNotes).mockImplementation(async () => {
      vi.mocked(listTrashedNotes).mockResolvedValue([]);
      return 2;
    });
    await mount();
    await filter("first");
    expect(host.querySelectorAll(".trash-row")).toHaveLength(1);
    await act(async () => button("Restore All").click());
    expect(restoreAllTrashedNotes).toHaveBeenCalledOnce();
    expect(restored).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith("2 notes restored", expect.anything());
    expect(host.textContent).toContain("No notes in Trash");
  });

  it("requires confirmation and deletes all confirmed notes regardless of search", async () => {
    vi.mocked(purgeTrashedNotes).mockImplementation(async () => {
      vi.mocked(listTrashedNotes).mockResolvedValue([{ id: "3", title: "New arrival" }]);
      return 2;
    });
    await mount();
    await filter("first");
    await act(async () => button("Empty Trash").click());
    expect(purgeTrashedNotes).not.toHaveBeenCalled();
    expect(host.querySelector("#trash-confirm-description")?.textContent).toContain("2 notes");
    expect(document.activeElement).toBe(button("Cancel"));
    await act(async () => button("Cancel").click());
    expect(purgeTrashedNotes).not.toHaveBeenCalled();

    await act(async () => button("Empty Trash").click());
    await act(async () => button("Empty Trash").click());
    expect(purgeTrashedNotes).toHaveBeenCalledExactlyOnceWith(["1", "2"]);
    expect(restored).not.toHaveBeenCalled();
    expect(host.textContent).toContain("New arrival");
    expect(host.textContent).not.toContain("First note");
  });
});
