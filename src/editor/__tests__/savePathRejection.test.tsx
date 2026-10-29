// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Editor } from "../Editor";
import { noteCache } from "../../lib/noteCache";
import { flushEditorNow } from "../../lib/db";
import { invoke } from "@tauri-apps/api/core";

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

describe("Save Path Rejection Recovery & lastSavedDocRef Invariants", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    noteCache.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not update lastSavedDocRef when DB write rejects, and next flush still saves", async () => {
    const updatePromiseResolvers: Array<{ resolve: () => void; reject: (err: any) => void }> = [];

    const mockOnUpdate = vi.fn((_id: string, _content?: string, _title?: string) => {
      return new Promise<void>((res, rej) => {
        updatePromiseResolvers.push({ resolve: res, reject: rej });
      });
    });

    let editorInstance: any = null;

    // Seed noteCache so mount is an immediate cache hit
    noteCache.set("test-note-1", "# Initial Note Content", new Date().toISOString(), "Initial Title", 0);

    act(() => {
      root.render(
        <Editor
          noteId="test-note-1"
          noteTitle="Initial Title"
          initialContent="# Initial Note Content"
          onUpdate={mockOnUpdate}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    expect(editorInstance).not.toBeNull();

    // Advance timers past any initial load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    mockOnUpdate.mockClear();
    updatePromiseResolvers.length = 0;

    // 1. Simulate user typing a change into the editor
    act(() => {
      editorInstance.commands.insertContent(" Modified text.");
    });

    // Advance debounce timer (300ms) to trigger first save
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(mockOnUpdate).toHaveBeenCalledTimes(1);

    // 2. Reject the first DB write attempt (e.g. database locked or IPC failure)
    await act(async () => {
      updatePromiseResolvers[0].reject(new Error("Database locked"));
      await vi.advanceTimersByTimeAsync(50);
    });

    // Since the first attempt rejected, lastSavedDocRef was NOT set to the doc,
    // and isDirtyRef remains true!

    // 3. User types or blurs, advancing the debounce timer for attempt 2
    const tiptapEl = container.querySelector(".tiptap");
    expect(tiptapEl).not.toBeNull();
    act(() => {
      tiptapEl?.dispatchEvent(new Event("blur"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // The second flush MUST attempt to save because the first save failed!
    expect(mockOnUpdate).toHaveBeenCalledTimes(2);

    // 4. This second attempt succeeds
    await act(async () => {
      updatePromiseResolvers[1].resolve();
    });

    // 5. Trigger a third flush without any new edits
    act(() => {
      tiptapEl?.dispatchEvent(new Event("blur"));
    });

    // Since the second attempt succeeded, lastSavedDocRef was updated and isDirtyRef cleared.
    // Redundant third flush should NOT call onUpdate!
    expect(mockOnUpdate).toHaveBeenCalledTimes(2);
  });

  it("(a) edits made while a save is in flight are saved after it resolves", async () => {
    const resolvers: Array<{ resolve: () => void; content: string }> = [];

    const mockOnUpdate = vi.fn((_id: string, content: string, _title?: string) => {
      return new Promise<void>((resolve) => {
        resolvers.push({ resolve, content });
      });
    });

    let editorInstance: any = null;
    noteCache.set("flight-note", "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Head\"}]}]}", new Date().toISOString(), "Head", 0);

    act(() => {
      root.render(
        <Editor
          noteId="flight-note"
          noteTitle="Head"
          onUpdate={mockOnUpdate}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    mockOnUpdate.mockClear();

    // 1. User types edit A
    act(() => {
      editorInstance.commands.insertContent(" edit A");
    });

    // Advance debounce to fire save A
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(mockOnUpdate).toHaveBeenCalledTimes(1);
    expect(resolvers.length).toBe(1);
    expect(resolvers[0].content).toContain("edit A");

    // 2. While save A is still pending in-flight, user types edit B
    act(() => {
      editorInstance.commands.insertContent(" and B");
    });

    // Advance debounce while save A is in flight
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    // Save B should not fire yet because save A is in flight
    expect(mockOnUpdate).toHaveBeenCalledTimes(1);

    // 3. Now save A resolves
    await act(async () => {
      resolvers[0].resolve();
      await vi.advanceTimersByTimeAsync(50);
    });

    // Follow-up save for edit B must automatically run!
    expect(mockOnUpdate).toHaveBeenCalledTimes(2);
    expect(resolvers.length).toBe(2);
    expect(resolvers[1].content).toContain("and B");

    // Resolve save B
    await act(async () => {
      resolvers[1].resolve();
      await vi.advanceTimersByTimeAsync(50);
    });
  });

  it("(b) the exit flush waits for the in-flight save AND the follow-up", async () => {
    const resolvers: Array<{ resolve: () => void; content: string }> = [];

    const mockOnUpdate = vi.fn((_id: string, content: string, _title?: string) => {
      return new Promise<void>((resolve) => {
        resolvers.push({ resolve, content });
      });
    });

    let editorInstance: any = null;
    noteCache.set("exit-note", "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Exit\"}]}]}", new Date().toISOString(), "Exit", 0);

    act(() => {
      root.render(
        <Editor
          noteId="exit-note"
          noteTitle="Exit"
          onUpdate={mockOnUpdate}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    mockOnUpdate.mockClear();

    // 1. User types edit 1
    act(() => {
      editorInstance.commands.insertContent(" 1");
    });

    // Debounce triggers save 1
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(mockOnUpdate).toHaveBeenCalledTimes(1);
    expect(resolvers.length).toBe(1);

    // 2. While save 1 is in flight, user types edit 2
    act(() => {
      editorInstance.commands.insertContent(" 2");
    });

    // 3. App exit occurs: flushEditorNow is called and awaited
    let exitFlushDone = false;
    const flushPromise = flushEditorNow().then(() => {
      exitFlushDone = true;
    });

    // Before resolving save 1, exit flush should NOT be done
    expect(exitFlushDone).toBe(false);

    // Resolve save 1
    await act(async () => {
      resolvers[0].resolve();
      await vi.advanceTimersByTimeAsync(50);
    });

    // Save 2 should have started as follow-up, but exit flush still waiting for save 2!
    expect(mockOnUpdate).toHaveBeenCalledTimes(2);
    expect(resolvers.length).toBe(2);
    expect(exitFlushDone).toBe(false);

    // Resolve save 2
    await act(async () => {
      resolvers[1].resolve();
      await vi.advanceTimersByTimeAsync(50);
    });

    await flushPromise;

    // Now exit flush is completely done, having waited for both!
    expect(exitFlushDone).toBe(true);
    expect(resolvers[1].content).toContain("1 2");
  });

  it("continuous typing during a slow save does not recurse without bound and coalesces into a single follow-up save", async () => {
    const resolvers: Array<{ resolve: () => void; content: string }> = [];

    const mockOnUpdate = vi.fn((_id: string, content: string, _title?: string) => {
      return new Promise<void>((resolve) => {
        resolvers.push({ resolve, content });
      });
    });

    let editorInstance: any = null;
    noteCache.set(
      "continuous-note",
      "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Start\"}]}]}",
      new Date().toISOString(),
      "Start",
      0
    );

    act(() => {
      root.render(
        <Editor
          noteId="continuous-note"
          noteTitle="Start"
          onUpdate={mockOnUpdate}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    mockOnUpdate.mockClear();

    // 1. Initial edit triggers save 1
    act(() => {
      editorInstance.commands.insertContent(" edit 1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    // Save 1 is now in flight
    expect(mockOnUpdate).toHaveBeenCalledTimes(1);
    expect(resolvers.length).toBe(1);

    // 2. While save 1 is in flight (slow backend / IPC), simulate continuous rapid typing:
    // 50 separate keystrokes with small delays
    for (let i = 2; i <= 51; i++) {
      act(() => {
        editorInstance.commands.insertContent(` k${i}`);
      });
      // Fire blur / flush attempts or advance partial debounce timers
      act(() => {
        vi.advanceTimersByTime(20);
      });
    }

    // No intermediate save calls must have escaped during the in-flight slow save!
    expect(mockOnUpdate).toHaveBeenCalledTimes(1);

    // 3. Save 1 now completes and resolves
    await act(async () => {
      resolvers[0].resolve();
      await vi.advanceTimersByTimeAsync(100);
    });

    // Follow-up save 2 must have fired automatically, coalescing all 50 keystrokes!
    expect(mockOnUpdate).toHaveBeenCalledTimes(2);
    expect(resolvers.length).toBe(2);
    expect(resolvers[1].content).toContain("k51");

    // 4. Save 2 completes
    await act(async () => {
      resolvers[1].resolve();
      await vi.advanceTimersByTimeAsync(500);
    });

    // The chain terminates cleanly: no further saves are triggered, proving no unbounded recursion
    expect(mockOnUpdate).toHaveBeenCalledTimes(2);
  });

  it("type A (save starts and hangs), type B, switch notes, resolve first save, assert note 1 final saved content contains AB", async () => {
    const note1Resolvers: Array<{ resolve: () => void; content: string }> = [];

    const mockOnUpdate = vi.fn((_id: string, content: string, _title?: string) => {
      return new Promise<void>((resolve) => {
        note1Resolvers.push({ resolve, content });
      });
    });

    let editorInstance: any = null;
    noteCache.set(
      "note-switch-1",
      JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Start" }] }] }),
      new Date().toISOString(),
      "Start",
      0
    );
    noteCache.set(
      "note-switch-2",
      JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Note Two" }] }] }),
      new Date().toISOString(),
      "Note Two",
      0
    );

    act(() => {
      root.render(
        <Editor
          noteId="note-switch-1"
          noteTitle="Start"
          onUpdate={mockOnUpdate}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    mockOnUpdate.mockClear();

    // 1. Type "A" -> triggers save 1 which hangs
    act(() => {
      editorInstance.commands.insertContent(" A");
    });

    // Advance debounce to trigger save 1
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(mockOnUpdate).toHaveBeenCalledTimes(1);
    expect(note1Resolvers.length).toBe(1);
    expect(note1Resolvers[0].content).toContain("Start A");

    // 2. Type "B" while save 1 is in-flight (hanging)
    act(() => {
      editorInstance.commands.insertContent("B");
    });

    // 3. User switches to note 2
    act(() => {
      root.render(
        <Editor
          noteId="note-switch-2"
          noteTitle="Note Two"
          onUpdate={mockOnUpdate}
        />
      );
    });

    // Note switch is initiated but must await save chain before clearing or swapping
    // At this point save 1 is still hanging
    expect(note1Resolvers.length).toBe(1);

    // 4. Resolve the first save (save A)
    await act(async () => {
      note1Resolvers[0].resolve();
      await vi.advanceTimersByTimeAsync(50);
    });

    // Follow-up save B for note 1 must run automatically before note 2 takes over!
    expect(mockOnUpdate).toHaveBeenCalledTimes(2);
    expect(note1Resolvers.length).toBe(2);
    expect(note1Resolvers[1].content).toContain("Start AB");

    // 5. Resolve the follow-up save
    await act(async () => {
      note1Resolvers[1].resolve();
      await vi.advanceTimersByTimeAsync(100);
    });

    // 6. Assert note 1's final saved content strictly contains "AB"
    const finalSaveNote1 = note1Resolvers[note1Resolvers.length - 1].content;
    expect(finalSaveNote1).toContain("AB");
  });

  it("rapid note switch without save errors does NOT trigger onSwitchConflict", async () => {
    const mockOnUpdate = vi.fn().mockResolvedValue(new Date().toISOString());
    const mockOnSwitchConflict = vi.fn();
    let editorInstance: any = null;

    noteCache.set("switch-test-1", "{}", new Date().toISOString(), "Title 1", 0);
    noteCache.set("switch-test-2", "{}", new Date().toISOString(), "Title 2", 0);

    act(() => {
      root.render(
        <Editor
          noteId="switch-test-1"
          noteTitle="Title 1"
          onUpdate={mockOnUpdate}
          onSwitchConflict={mockOnSwitchConflict}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Make edit
    act(() => {
      editorInstance.commands.insertContent(" Clean edit");
    });

    // Switch to note 2
    act(() => {
      root.render(
        <Editor
          noteId="switch-test-2"
          noteTitle="Title 2"
          onUpdate={mockOnUpdate}
          onSwitchConflict={mockOnSwitchConflict}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Clean save should resolve and onSwitchConflict must NOT be called
    expect(mockOnSwitchConflict).not.toHaveBeenCalled();
  });

  it("forced save failure during note switch triggers onSwitchConflict escape hatch", async () => {
    const mockOnUpdate = vi.fn().mockRejectedValue(new Error("Disk IO failure"));
    const mockOnSwitchConflict = vi.fn();
    let editorInstance: any = null;

    noteCache.set("switch-fail-1", "{}", new Date().toISOString(), "Title 1", 0);
    noteCache.set("switch-fail-2", "{}", new Date().toISOString(), "Title 2", 0);

    act(() => {
      root.render(
        <Editor
          noteId="switch-fail-1"
          noteTitle="Title 1"
          onUpdate={mockOnUpdate}
          onSwitchConflict={mockOnSwitchConflict}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Make dirty edit
    act(() => {
      editorInstance.commands.insertContent(" Critical unsaved edit");
    });

    // Attempt note switch while save will fail
    act(() => {
      root.render(
        <Editor
          noteId="switch-fail-2"
          noteTitle="Title 2"
          onUpdate={mockOnUpdate}
          onSwitchConflict={mockOnSwitchConflict}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Must have triggered onSwitchConflict modal escape hatch with the failed note's content!
    expect(mockOnSwitchConflict).toHaveBeenCalledTimes(1);
    const conflictData = mockOnSwitchConflict.mock.calls[0][0];
    expect(conflictData.failedNoteId).toBe("switch-fail-1");
    expect(conflictData.targetNoteId).toBe("switch-fail-2");
    expect(conflictData.text).toContain("Critical unsaved edit");
  });

  it("when NOTE_NOT_FOUND recovery fails, keeps dirty state, keeps snapshot, and opens conflict modal", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "get_note") {
        if (args?.id === "missing-1") {
          return { id: "missing-1", content: "{}", updated_at: "t0", title: "Title 1" } as any;
        }
        return { id: args?.id, content: "{}", updated_at: "t0", title: "Target" } as any;
      }
      return undefined;
    });

    const mockOnUpdate = vi.fn().mockRejectedValue(new Error("NOTE_NOT_FOUND"));
    const mockOnRecoverOrphan = vi.fn().mockRejectedValue(new Error("Disk IO during recovery"));
    const mockOnSwitchConflict = vi.fn();
    let editorInstance: any = null;

    localStorage.setItem("notefast_active_note_content", "precious snapshot");
    localStorage.setItem("notefast_active_note_unsaved", "true");

    noteCache.set("missing-1", "{}", "t0", "Title 1", 0);
    noteCache.set("target-2", "{}", "t0", "Title 2", 0);

    act(() => {
      root.render(
        <Editor
          noteId="missing-1"
          noteTitle="Title 1"
          onUpdate={mockOnUpdate}
          onRecoverOrphan={mockOnRecoverOrphan}
          onSwitchConflict={mockOnSwitchConflict}
          onEditorReady={(ed) => {
            editorInstance = ed;
          }}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    act(() => {
      editorInstance.commands.insertContent(" Edits before missing row switch");
    });

    // Switch to target note
    act(() => {
      root.render(
        <Editor
          noteId="target-2"
          noteTitle="Title 2"
          onUpdate={mockOnUpdate}
          onRecoverOrphan={mockOnRecoverOrphan}
          onSwitchConflict={mockOnSwitchConflict}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Recovery was attempted
    expect(mockOnRecoverOrphan).toHaveBeenCalledTimes(1);

    // Because recovery failed, conflict escape hatch must be opened
    expect(mockOnSwitchConflict).toHaveBeenCalledTimes(1);
    const conflictData = mockOnSwitchConflict.mock.calls[0][0];
    expect(conflictData.failedNoteId).toBe("missing-1");
    expect(conflictData.targetNoteId).toBe("target-2");

    // LocalStorage recovery snapshot is preserved and NOT wiped
    expect(localStorage.getItem("notefast_active_note_content")).toBe("precious snapshot");
    expect(localStorage.getItem("notefast_active_note_unsaved")).toBe("true");
  });
});
