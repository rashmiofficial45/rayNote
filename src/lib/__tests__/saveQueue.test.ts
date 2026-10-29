import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateNote, flushSaveQueue } from "../db";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}));

describe("Frontend saveQueue FIFO Order & Resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ensures saves execute in strictly sequential FIFO call order even if first call is slower", async () => {
    const executionLog: string[] = [];
    const mockInvoke = vi.mocked(invoke);

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "update_note") {
        const title = args.title;
        executionLog.push(`start:${title}`);
        if (title === "Call 1 (Slow)") {
          await new Promise((resolve) => setTimeout(resolve, 60));
        } else if (title === "Call 2 (Fast)") {
          await new Promise((resolve) => setTimeout(resolve, 10));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        executionLog.push(`end:${title}`);
      }
      return undefined;
    });

    // Fire 3 saves concurrently without awaiting between them
    const p1 = updateNote("note-1", "Call 1 (Slow)", "Content 1");
    const p2 = updateNote("note-1", "Call 2 (Fast)", "Content 2");
    const p3 = updateNote("note-1", "Call 3 (Instant)", "Content 3");

    await Promise.all([p1, p2, p3]);

    expect(executionLog).toEqual([
      "start:Call 1 (Slow)",
      "end:Call 1 (Slow)",
      "start:Call 2 (Fast)",
      "end:Call 2 (Fast)",
      "start:Call 3 (Instant)",
      "end:Call 3 (Instant)",
    ]);
  });

  it("ensures a rejected save does not block subsequent queued saves from applying", async () => {
    const executionLog: string[] = [];
    const mockInvoke = vi.mocked(invoke);

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "update_note") {
        const title = args.title;
        executionLog.push(`start:${title}`);
        if (title === "Failing Save") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          executionLog.push(`fail:${title}`);
          throw new Error("IPC network timeout simulation");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        executionLog.push(`end:${title}`);
      }
      return undefined;
    });

    const pFail = updateNote("note-1", "Failing Save", "Bad Content");
    const pSucceed = updateNote("note-1", "Recovery Save", "Good Content");

    await expect(pFail).rejects.toThrow("IPC network timeout simulation");
    await expect(pSucceed).resolves.toBeUndefined();

    expect(executionLog).toEqual([
      "start:Failing Save",
      "fail:Failing Save",
      "start:Recovery Save",
      "end:Recovery Save",
    ]);
  });

  it("proves save 1 rejects while save 2 and save 3 still run and resolve in FIFO order", async () => {
    const executionLog: string[] = [];
    const mockInvoke = vi.mocked(invoke);

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "update_note") {
        const title = args.title;
        executionLog.push(`start:${title}`);
        if (title === "Save 1") {
          await new Promise((resolve) => setTimeout(resolve, 15));
          executionLog.push(`fail:${title}`);
          throw new Error("Disk IO Error on Save 1");
        } else {
          await new Promise((resolve) => setTimeout(resolve, 10));
          executionLog.push(`success:${title}`);
        }
      }
      return "2026-10-24T12:00:00Z";
    });

    const p1 = updateNote("note-1", "Save 1", "Content 1");
    const p2 = updateNote("note-1", "Save 2", "Content 2");
    const p3 = updateNote("note-1", "Save 3", "Content 3");

    // Save 1 must reject to its caller with the original error
    await expect(p1).rejects.toThrow("Disk IO Error on Save 1");
    // Save 2 and Save 3 must resolve cleanly without being poisoned
    await expect(p2).resolves.toBe("2026-10-24T12:00:00Z");
    await expect(p3).resolves.toBe("2026-10-24T12:00:00Z");

    expect(executionLog).toEqual([
      "start:Save 1",
      "fail:Save 1",
      "start:Save 2",
      "success:Save 2",
      "start:Save 3",
      "success:Save 3",
    ]);
  });

  it("flushSaveQueue waits for all in-flight saves to complete", async () => {
    let completed = false;
    const mockInvoke = vi.mocked(invoke);

    mockInvoke.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      completed = true;
      return undefined;
    });

    updateNote("note-1", "Flush Test", "Flush Content");
    expect(completed).toBe(false);

    await flushSaveQueue();
    expect(completed).toBe(true);
  });

  it("flushes editor pending debounce before awaiting flushSaveQueue during app exit", async () => {
    const eventOrder: string[] = [];
    const mockInvoke = vi.mocked(invoke);
    let exitListener: (() => Promise<void>) | null = null;

    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
      if (eventName === "app-will-exit") {
        exitListener = handler;
      }
      return () => {};
    });

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "update_note") {
        eventOrder.push(`invoke:update_note:${args.title}`);
      } else if (cmd === "flush_done") {
        eventOrder.push("invoke:flush_done");
      }
      return undefined;
    });

    const { registerEditorFlush, registerExitFlushHandler } = await import("../db");

    // Simulate an editor with uncommitted dirty content
    registerEditorFlush(() => {
      eventOrder.push("editor:flushNow");
      updateNote("note-active", "Uncommitted Editor Title", "Uncommitted Editor Body");
    });

    registerExitFlushHandler(() => {
      eventOrder.push("title:flushPendingTitle");
    });

    expect(exitListener).not.toBeNull();
    // Simulate Rust emitting "app-will-exit"
    await exitListener!();

    expect(eventOrder).toEqual([
      "editor:flushNow",
      "title:flushPendingTitle",
      "invoke:update_note:Uncommitted Editor Title",
      "invoke:flush_done",
    ]);

    // Cleanup
    registerEditorFlush(null);
  });

  it("flushes editor and drains saveQueue on panel-will-hide event", async () => {
    const eventOrder: string[] = [];
    const mockInvoke = vi.mocked(invoke);
    let hideListener: (() => Promise<void>) | null = null;

    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
      if (eventName === "panel-will-hide") {
        hideListener = handler;
      }
      return () => {};
    });

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "update_note") {
        eventOrder.push(`invoke:update_note:${args.title}`);
      }
      return undefined;
    });

    const { registerEditorFlush, registerPanelHideHandler } = await import("../db");

    registerEditorFlush(() => {
      eventOrder.push("editor:flushNow");
      updateNote("note-active", "Dirty Editor Content", "Body");
    });

    registerPanelHideHandler(() => {
      eventOrder.push("app:flushPendingTitle");
    });

    expect(hideListener).not.toBeNull();
    await hideListener!();

    expect(eventOrder).toEqual([
      "editor:flushNow",
      "app:flushPendingTitle",
      "invoke:update_note:Dirty Editor Content",
    ]);

    registerEditorFlush(null);
  });

  it("blur + visibilitychange + panel-will-hide in quick succession produce exactly 1 save when doc is unchanged", async () => {
    const mockInvoke = vi.mocked(invoke);
    let updateCount = 0;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "update_note") {
        updateCount++;
      }
      return undefined;
    });

    const { registerEditorFlush, flushEditorNow } = await import("../db");

    // Simulate Editor state tracking with lastSavedDocRef
    let isDirty = true;
    let lastSavedDoc: any = null;
    const currentDoc = { type: "doc", content: [{ type: "paragraph" }] }; // Document reference

    const saveNow = () => {
      if (!isDirty) return;
      if (currentDoc && lastSavedDoc === currentDoc) {
        isDirty = false;
        return;
      }
      isDirty = false;
      lastSavedDoc = currentDoc;
      updateNote("note-active", "Title", JSON.stringify(currentDoc));
    };

    registerEditorFlush(saveNow);

    // 1. First event: blur triggers flush
    flushEditorNow();
    await flushSaveQueue();
    expect(updateCount).toBe(1);

    // 2. Second event: visibilitychange fires immediately after
    flushEditorNow();
    await flushSaveQueue();
    expect(updateCount).toBe(1); // Skipped because isDirty is false and lastSavedDoc === currentDoc

    // 3. Third event: panel-will-hide fires immediately after
    flushEditorNow();
    await flushSaveQueue();
    expect(updateCount).toBe(1); // Skipped

    // 4. If a second flush sequence happens without any new document edit:
    isDirty = true; // Even if a spurious dirty flag was set, doc reference hasn't changed!
    saveNow();
    await flushSaveQueue();
    expect(updateCount).toBe(1); // Still 1! Skipped by lastSavedDocRef

    registerEditorFlush(null);
  });
});
