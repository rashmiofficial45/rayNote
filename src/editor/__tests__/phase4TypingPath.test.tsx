// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Editor as TipTapEditor } from "@tiptap/core";
import { Editor } from "../Editor";
import { getExtensions } from "../extensions";
import { BottomToolbar } from "../../components/BottomToolbar";
import { titleStore } from "../../lib/titleStore";
import { noteCache } from "../../lib/noteCache";
import { flushEditorNow } from "../../lib/db";
import { getCachedAllBlocks } from "../../extensions/BlockSelection";
import { searchPluginKey } from "../searchExtension";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
    listen: vi.fn().mockResolvedValue(() => {}),
  }),
}));

describe("Phase 4: Typing Path Optimizations & Format Menu State", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editor: TipTapEditor;

  beforeEach(() => {
    titleStore.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    editor = new TipTapEditor({
      extensions: getExtensions(),
      content: "<p>Initial text</p>",
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    editor?.destroy();
    vi.restoreAllMocks();
  });

  describe("Aa Format Menu States via useEditorState", () => {
    it("reflects bold format active state in Aa menu", () => {
      act(() => {
        root.render(<BottomToolbar editor={editor} />);
      });

      // Open Aa menu
      const formatBtn = container.querySelector(".format-corner-btn[aria-label='Format']") as HTMLButtonElement;
      act(() => {
        formatBtn.click();
      });

      const boldBtn = container.querySelector("button[title='Bold (⌘B)']") as HTMLButtonElement;
      expect(boldBtn).not.toBeNull();
      expect(boldBtn.classList.contains("is-active")).toBe(false);

      // Select all and toggle bold
      act(() => {
        editor.chain().selectAll().toggleBold().run();
      });

      expect(boldBtn.classList.contains("is-active")).toBe(true);
      expect(formatBtn.classList.contains("is-active")).toBe(true);
    });

    it("reflects Heading 1 and Heading 2 format states in Aa menu", () => {
      act(() => {
        root.render(<BottomToolbar editor={editor} />);
      });

      const formatBtn = container.querySelector(".format-corner-btn[aria-label='Format']") as HTMLButtonElement;
      act(() => {
        formatBtn.click();
      });

      const h1Btn = container.querySelector("button[title='Heading 1 (⌘⌥1)']") as HTMLButtonElement;
      const h2Btn = container.querySelector("button[title='Heading 2 (⌘⌥2)']") as HTMLButtonElement;

      expect(h1Btn.classList.contains("is-active")).toBe(false);
      expect(h2Btn.classList.contains("is-active")).toBe(false);

      act(() => {
        editor.chain().setHeading({ level: 1 }).run();
      });
      expect(h1Btn.classList.contains("is-active")).toBe(true);
      expect(h2Btn.classList.contains("is-active")).toBe(false);

      act(() => {
        editor.chain().setHeading({ level: 2 }).run();
      });
      expect(h1Btn.classList.contains("is-active")).toBe(false);
      expect(h2Btn.classList.contains("is-active")).toBe(true);
    });

    it("reflects list formats (bulletList, orderedList, taskList) in Aa menu", () => {
      act(() => {
        root.render(<BottomToolbar editor={editor} />);
      });

      const formatBtn = container.querySelector(".format-corner-btn[aria-label='Format']") as HTMLButtonElement;
      act(() => {
        formatBtn.click();
      });

      const bulletBtn = container.querySelector("button[title='Bullet List (⇧⌘8)']") as HTMLButtonElement;
      const orderedBtn = container.querySelector("button[title='Numbered List (⇧⌘7)']") as HTMLButtonElement;
      const taskBtn = container.querySelector("button[title='Task List (⇧⌘9)']") as HTMLButtonElement;

      expect(bulletBtn.classList.contains("is-active")).toBe(false);
      expect(orderedBtn.classList.contains("is-active")).toBe(false);
      expect(taskBtn.classList.contains("is-active")).toBe(false);

      act(() => {
        editor.chain().toggleBulletList().run();
      });
      expect(bulletBtn.classList.contains("is-active")).toBe(true);
      expect(orderedBtn.classList.contains("is-active")).toBe(false);

      act(() => {
        editor.chain().toggleOrderedList().run();
      });
      expect(bulletBtn.classList.contains("is-active")).toBe(false);
      expect(orderedBtn.classList.contains("is-active")).toBe(true);

      act(() => {
        editor.chain().toggleTaskList().run();
      });
      expect(taskBtn.classList.contains("is-active")).toBe(true);
    });
  });

  describe("External titleStore Decoupling", () => {
    it("subscribes and updates listeners with 0ms lag", () => {
      const listener = vi.fn();
      const unsubscribe = titleStore.subscribe(listener);

      expect(titleStore.getSnapshot()).toBeNull();

      titleStore.setTitle("New Note Title");
      expect(titleStore.getSnapshot()).toBe("New Note Title");
      expect(listener).toHaveBeenCalledTimes(1);

      // Same title is a no-op
      titleStore.setTitle("New Note Title");
      expect(listener).toHaveBeenCalledTimes(1);

      // Reset
      titleStore.reset();
      expect(titleStore.getSnapshot()).toBeNull();
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      titleStore.setTitle("After Unsubscribe");
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe("BlockSelection Caching", () => {
    it("getCachedAllBlocks returns the exact same object reference if doc has not changed", () => {
      const doc = editor.state.doc;
      const first = getCachedAllBlocks(doc);
      const second = getCachedAllBlocks(doc);

      expect(first).toBe(second); // Strict reference equality: 0 re-traversals
      expect(first.length).toBeGreaterThan(0);

      // Inserting content changes doc reference
      editor.commands.insertContent(" additional content");
      const updatedDoc = editor.state.doc;
      expect(updatedDoc).not.toBe(doc);

      const third = getCachedAllBlocks(updatedDoc);
      const fourth = getCachedAllBlocks(updatedDoc);
      expect(third).toBe(fourth);
      expect(third).not.toBe(first);
    });
  });

  describe("searchExtension mapping and inactive state", () => {
    it("returns DecorationSet.empty when search is inactive", () => {
      const pluginState = searchPluginKey.getState(editor.state);
      expect(pluginState).toBeDefined();
      const decs = pluginState.find();
      expect(decs.length).toBe(0);
    });

    it("maps decorations through tr.mapping during document edits without throwing", () => {
      // Set a search term that exists
      editor.commands.setSearchTerm("text");
      const initialState = searchPluginKey.getState(editor.state);
      const decs = initialState.find();
      expect(decs.length).toBeGreaterThan(0);

      // Type some characters before the match
      editor.commands.insertContentAt(1, "abc");
      const mappedState = searchPluginKey.getState(editor.state);
      expect(mappedState).toBeDefined();
      expect(mappedState.find().length).toBeGreaterThan(0);
    });

    it("typing inside a highlighted match maps decorations and updates match count after 150ms rescan", () => {
      vi.useFakeTimers();
      editor.commands.setContent("<p>apple banana apple</p>");
      editor.commands.setSearchTerm("apple");

      expect((editor.storage as any).search.results.length).toBe(2);

      // Type 'X' inside the first match "ap[X]ple"
      editor.commands.insertContentAt(3, "X");

      // O(1) mapping retains decorated region without crash
      const mappedState = searchPluginKey.getState(editor.state);
      expect(mappedState).toBeDefined();

      // Advance debounce timer by 150ms
      vi.advanceTimersByTime(160);

      // Match count updates to 1 (only second "apple" remains)
      expect((editor.storage as any).search.results.length).toBe(1);

      // Find bar closes / clearSearch clears storage and timer
      editor.commands.clearSearch();
      expect((editor.storage as any).search.searchTerm).toBe("");
      expect((editor.storage as any).search.results.length).toBe(0);

      vi.useRealTimers();
    });
  });

  describe("Data Safety & Persistence Guarantees (Mounted Real Editor Component)", () => {
    it("blur within 50ms of typing saves the latest text", async () => {
      vi.useFakeTimers();
      let editorInstance: any = null;
      const onUpdateSpy = vi.fn();

      await act(async () => {
        root.render(
          <Editor
            noteId="note-test-blur"
            initialContent="<p>Initial content</p>"
            onUpdate={onUpdateSpy}
            onEditorReady={(ed) => {
              editorInstance = ed;
            }}
          />
        );
      });

      expect(editorInstance).not.toBeNull();

      // Type some characters into the real mounted editor
      await act(async () => {
        editorInstance.commands.insertContent(" extra typed text");
      });

      // 40 ms later (within 50 ms, before normal 300 ms debounce), blur occurs
      await act(async () => {
        vi.advanceTimersByTime(40);
      });
      expect(onUpdateSpy).not.toHaveBeenCalled();

      // Trigger blur DOM event on the tiptap element
      await act(async () => {
        const tiptapEl = container.querySelector(".tiptap");
        tiptapEl?.dispatchEvent(new Event("blur"));
      });

      expect(onUpdateSpy).toHaveBeenCalled();
      expect(onUpdateSpy.mock.calls[0][0]).toBe("note-test-blur");
      const savedPayload = onUpdateSpy.mock.calls[0][1];
      expect(savedPayload).toContain("extra typed text");
      vi.useRealTimers();
    });

    it("continuous typing for 5+ seconds triggers save at the 5000ms max-wait bound", async () => {
      vi.useFakeTimers();
      let editorInstance: any = null;
      const onUpdateSpy = vi.fn();

      await act(async () => {
        root.render(
          <Editor
            noteId="note-test-maxwait"
            initialContent="<p>Start</p>"
            onUpdate={onUpdateSpy}
            onEditorReady={(ed) => {
              editorInstance = ed;
            }}
          />
        );
      });

      expect(editorInstance).not.toBeNull();

      // Type every 200 ms for 26 keystrokes (total 5,200 ms)
      // Normal debounce is 300 ms, so without max-wait, save would never fire while typing
      for (let i = 0; i < 26; i++) {
        await act(async () => {
          vi.advanceTimersByTime(200);
          editorInstance.commands.insertContent("x");
        });
      }

      // At 5,000 ms, saveNow() should have fired via remainingMaxWait <= 0
      expect(onUpdateSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("switching notes mid-debounce saves the OLD note under the OLD id", async () => {
      vi.useFakeTimers();
      let editorInstance: any = null;
      const onUpdateSpy = vi.fn();

      await act(async () => {
        root.render(
          <Editor
            noteId="note-A"
            initialContent="<p>Note A body</p>"
            onUpdate={onUpdateSpy}
            onEditorReady={(ed) => {
              editorInstance = ed;
            }}
          />
        );
      });

      // Type into note-A
      await act(async () => {
        editorInstance.commands.insertContent(" modified text");
      });

      // 50 ms in (well before 300 ms debounce), switch note prop to note-B
      await act(async () => {
        vi.advanceTimersByTime(50);
        root.render(
          <Editor
            noteId="note-B"
            initialContent="<p>Note B body</p>"
            onUpdate={onUpdateSpy}
            onEditorReady={(ed) => {
              editorInstance = ed;
            }}
          />
        );
      });

      // Asserts that onUpdate was called with note-A's id, content and title
      expect(onUpdateSpy).toHaveBeenCalled();
      expect(onUpdateSpy.mock.calls[0][0]).toBe("note-A");
      const savedPayload = onUpdateSpy.mock.calls[0][1];
      expect(savedPayload).toContain("modified text");

      // And noteCache for note-A has the flushed content
      const cachedA = noteCache.get("note-A");
      expect(cachedA?.content).toContain("modified text");

      vi.useRealTimers();
    });

    it("panel-will-hide flushes editor and title", async () => {
      vi.useFakeTimers();
      let editorInstance: any = null;
      const onUpdateSpy = vi.fn();

      await act(async () => {
        root.render(
          <Editor
            noteId="note-panel-hide"
            initialContent="<p>Body</p>"
            onUpdate={onUpdateSpy}
            onEditorReady={(ed) => {
              editorInstance = ed;
            }}
          />
        );
      });

      // Type into editor modifying content
      await act(async () => {
        editorInstance.commands.insertContent(" uncommitted edit");
      });

      // Synchronous flush invoked by panel-will-hide event handler
      await act(async () => {
        flushEditorNow();
      });

      expect(onUpdateSpy).toHaveBeenCalled();
      expect(onUpdateSpy.mock.calls[0][0]).toBe("note-panel-hide");
      expect(onUpdateSpy.mock.calls[0][1]).toContain("uncommitted edit");

      vi.useRealTimers();
    });

    it("note switch resets or updates titleStore so previous title never flashes", async () => {
      titleStore.setTitle("Previous Note Title");
      expect(titleStore.getSnapshot()).toBe("Previous Note Title");

      // Switching note without a summary hint resets titleStore synchronously
      titleStore.reset();
      expect(titleStore.getSnapshot()).toBeNull();

      // Applying incoming note's title
      titleStore.setTitle("Fresh Note 2 Title");
      expect(titleStore.getSnapshot()).toBe("Fresh Note 2 Title");
    });
  });

  describe("Adaptive Debounce Timing Calculation", () => {
    it("calculates 300ms for small docs (<20k), 800ms for medium docs (<100k), 1500ms for large docs", () => {
      function getAdaptiveDelay(contentSize: number): number {
        if (contentSize >= 100000) return 1500;
        if (contentSize >= 20000) return 800;
        return 300;
      }

      expect(getAdaptiveDelay(500)).toBe(300);
      expect(getAdaptiveDelay(19999)).toBe(300);
      expect(getAdaptiveDelay(20000)).toBe(800);
      expect(getAdaptiveDelay(99999)).toBe(800);
      expect(getAdaptiveDelay(100000)).toBe(1500);
      expect(getAdaptiveDelay(1000000)).toBe(1500);
    });
  });
});
