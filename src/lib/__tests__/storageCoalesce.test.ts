// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  safeLocalStorageSetItem,
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  createCoalescedWriter,
  STORAGE_KEYS,
} from "../storage";

describe("Storage Quota Protection & Write Coalescing (Item 3)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("coalesces back-to-back writes across blur + visibilitychange + panel-will-hide into a single invocation", async () => {
    vi.useFakeTimers();
    const writeFn = vi.fn();
    const coalesced = createCoalescedWriter(writeFn, 16);

    // 1. Simulate rapid succession events within milliseconds:
    // Event 1: window blur
    coalesced.schedule();
    // Event 2: document visibilitychange (hidden)
    coalesced.schedule();
    // Event 3: panel-will-hide
    coalesced.schedule();

    // Has not run yet (still debouncing within frame window)
    expect(writeFn).toHaveBeenCalledTimes(0);

    // Fast-forward by 16ms
    vi.advanceTimersByTime(16);

    // Must have executed exactly once
    expect(writeFn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("safely handles QuotaExceededError by evicting cached note summaries while strictly preserving recovery keys", () => {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_NOTE_CONTENT, "precious unsaved content");
    localStorage.setItem("notefast_recovered_note_id", "rec-123");
    localStorage.setItem(STORAGE_KEYS.CACHED_NOTES, JSON.stringify([{ id: "old-1" }]));

    let throwOnce = true;
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, "setItem").mockImplementation((key: string, val: string) => {
      if (throwOnce && key === "some_other_key") {
        throwOnce = false;
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      return originalSetItem(key, val);
    });

    const success = safeLocalStorageSetItem("some_other_key", "val");
    expect(success).toBe(true);

    // Cached notes should have been evicted to make room
    expect(localStorage.getItem(STORAGE_KEYS.CACHED_NOTES)).toBeNull();
    // Critical recovery keys are NEVER evicted!
    expect(localStorage.getItem(STORAGE_KEYS.ACTIVE_NOTE_CONTENT)).toBe("precious unsaved content");
    expect(localStorage.getItem("notefast_recovered_note_id")).toBe("rec-123");
    // Target key was successfully written
    expect(localStorage.getItem("some_other_key")).toBe("val");
  });

  it("returns false safely without throwing when storage is completely blocked", () => {
    const setItemSpy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    });

    let threw = false;
    let result = false;
    try {
      result = safeLocalStorageSetItem("any_key", "value");
    } catch {
      threw = true;
    } finally {
      setItemSpy.mockRestore();
    }

    expect(threw).toBe(false);
    expect(result).toBe(false);
  });

  it("safeLocalStorageRemoveItem strictly allows the app to clear recovery keys after recovery", () => {
    localStorage.setItem("notefast_active_note_unsaved", "true");
    localStorage.setItem("notefast_recovered_note_id", "rec-456");

    safeLocalStorageRemoveItem("notefast_active_note_unsaved");
    expect(localStorage.getItem("notefast_active_note_unsaved")).toBeNull();

    safeLocalStorageRemoveItem("notefast_recovered_note_id");
    expect(localStorage.getItem("notefast_recovered_note_id")).toBeNull();
  });
});


describe('Storage failure and concurrency regressions', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it('handles a SecurityError from the localStorage getter itself', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });
    expect(() => safeLocalStorageSetItem('key', 'value')).not.toThrow();
    expect(safeLocalStorageSetItem('key', 'value')).toBe(false);
    expect(safeLocalStorageGetItem('key')).toBeNull();
    expect(() => safeLocalStorageRemoveItem('key')).not.toThrow();
  });
  it('serializes async writes and coalesces retriggers until completion', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const writer = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => {
      finish = resolve;
    })).mockResolvedValue(undefined);
    const coalesced = createCoalescedWriter(writer);
    const first = coalesced.flush();
    coalesced.flush();
    coalesced.schedule();
    await vi.advanceTimersByTimeAsync(32);
    expect(writer).toHaveBeenCalledTimes(1);
    finish();
    await first;
    await vi.advanceTimersByTimeAsync(16);
    expect(writer).toHaveBeenCalledTimes(2);
    coalesced.cancel();
  });
});
