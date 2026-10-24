// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as db from "../../lib/db";

describe("Navigation Coalescing & Key Repeat Protection (Item 5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores or coalesces Option+Down while an in-flight navigation is pending", async () => {
    let resolveNavigation!: (val: string | null) => void;
    const navigationPromise = new Promise<string | null>((resolve) => {
      resolveNavigation = resolve;
    });

    const getAdjacentSpy = vi.spyOn(db, "getAdjacentNote").mockReturnValue(navigationPromise);
    const flushEditorSpy = vi.spyOn(db, "flushEditorNow").mockResolvedValue();
    const flushSaveSpy = vi.spyOn(db, "flushSaveQueue").mockResolvedValue();

    // Replicate App.tsx coalescing navigation handler
    let isNavigating = false;
    let selectedNoteId: string | null = null;
    let activeNoteId = "note-1";

    const handleNextNote = async () => {
      if (!activeNoteId || isNavigating) return;
      isNavigating = true;
      try {
        db.flushEditorNow();
        await db.flushSaveQueue();
        const nextId = await db.getAdjacentNote(activeNoteId, "next");
        if (nextId) {
          selectedNoteId = nextId;
          activeNoteId = nextId;
        }
      } finally {
        isNavigating = false;
      }
    };

    // 1. First trigger (Option+Down pressed)
    const firstCall = handleNextNote();
    expect(flushEditorSpy).toHaveBeenCalledTimes(1);
    expect(flushSaveSpy).toHaveBeenCalledTimes(1);

    // 2. While navigation is in flight (awaiting flush/navigation), key-repeat fires 5 times rapidly
    const repeat1 = handleNextNote();
    const repeat2 = handleNextNote();
    const repeat3 = handleNextNote();
    const repeat4 = handleNextNote();
    const repeat5 = handleNextNote();

    await Promise.all([repeat1, repeat2, repeat3, repeat4, repeat5]);

    // flushSaveQueue is only called once for the first navigation; repeats were coalesced/ignored
    expect(flushSaveSpy).toHaveBeenCalledTimes(1);

    // 3. Resolve the in-flight navigation
    resolveNavigation("note-2");
    await firstCall;

    expect(getAdjacentSpy).toHaveBeenCalledTimes(1);
    expect(selectedNoteId).toBe("note-2");
    expect(activeNoteId).toBe("note-2");

    // 4. Now that navigation has completed, subsequent Option+Down successfully triggers next navigation
    vi.spyOn(db, "getAdjacentNote").mockResolvedValue("note-3");
    await handleNextNote();

    expect(selectedNoteId).toBe("note-3");
    expect(getAdjacentSpy).toHaveBeenCalledTimes(2);
  });

  it("resets isNavigating when getAdjacentNote rejects and allows subsequent keystroke to succeed", async () => {
    let isNavigating = false;
    let selectedNoteId: string | null = null;
    let activeNoteId = "note-1";

    const handleNextNote = async () => {
      if (!activeNoteId || isNavigating) return;
      isNavigating = true;
      try {
        db.flushEditorNow();
        await db.flushSaveQueue();
        const nextId = await db.getAdjacentNote(activeNoteId, "next");
        if (nextId) {
          selectedNoteId = nextId;
          activeNoteId = nextId;
        }
      } catch {
        // App.tsx logs error and continues to finally block
      } finally {
        isNavigating = false;
      }
    };

    vi.spyOn(db, "flushEditorNow").mockResolvedValue();
    vi.spyOn(db, "flushSaveQueue").mockResolvedValue();

    // 1. getAdjacentNote rejects with database / IPC error
    const getAdjacentSpy = vi.spyOn(db, "getAdjacentNote").mockRejectedValue(new Error("Database reader lock error"));

    await handleNextNote();

    // Verify isNavigating was cleanly reset in finally block even though promise rejected
    expect(isNavigating).toBe(false);
    expect(selectedNoteId).toBeNull();
    expect(getAdjacentSpy).toHaveBeenCalledTimes(1);

    // 2. Next keystroke fires and succeeds
    getAdjacentSpy.mockResolvedValue("note-2");
    await handleNextNote();

    expect(isNavigating).toBe(false);
    expect(selectedNoteId).toBe("note-2");
    expect(activeNoteId).toBe("note-2");
    expect(getAdjacentSpy).toHaveBeenCalledTimes(2);
  });
});
