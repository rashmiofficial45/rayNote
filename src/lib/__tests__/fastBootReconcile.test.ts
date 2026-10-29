// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { reconcileSnapshotWithDb, NoteLRUCache } from "../noteCache";
import { deleteNote } from "../db";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(true),
}));

describe("Fast-Boot Snapshot Reconciliation Invariants", () => {
  const t0 = "2026-10-23T10:00:00.000Z";
  const t1 = "2026-10-23T10:00:01.500Z";

  it("Case 1: Clean snapshot matching DB timestamp and content is a clean no-op", () => {
    const cached = {
      content: "Clean document text",
      baseUpdatedAt: t0,
      unsaved: false,
    };
    const fullNote = {
      content: "Clean document text",
      updated_at: t0,
    };

    const result = reconcileSnapshotWithDb(cached, fullNote);
    expect(result.action).toBe("noop");
    expect(result.content).toBe("Clean document text");
    expect(result.isDirty).toBe(false);
  });

  it("Case 1b: Equal timestamps with different content applies authoritative DB version and marks clean", () => {
    const cached = {
      content: "Altered snapshot text but marked clean",
      baseUpdatedAt: t0,
      unsaved: false,
    };
    const fullNote = {
      content: "Authoritative database content",
      updated_at: t0, // Equal timestamp!
    };

    const result = reconcileSnapshotWithDb(cached, fullNote);
    expect(result.action).toBe("apply_db");
    expect(result.content).toBe("Authoritative database content");
    expect(result.isDirty).toBe(false);
  });

  it("Case 1c: Clean snapshot with newer DB timestamp applies DB version without marking dirty", () => {
    const cached = {
      content: "Stale document text",
      baseUpdatedAt: t0,
      unsaved: false,
    };
    const fullNote = {
      content: "Authoritative text updated externally",
      updated_at: t1,
    };

    const result = reconcileSnapshotWithDb(cached, fullNote);
    expect(result.action).toBe("apply_db");
    expect(result.content).toBe("Authoritative text updated externally");
    expect(result.isDirty).toBe(false);
  });

  it("Case 2: Unsaved snapshot with DB row unchanged (updated_at == baseUpdatedAt) re-applies snapshot & marks dirty", () => {
    const cached = {
      content: "Unsaved local edit that survived app kill",
      baseUpdatedAt: t0,
      unsaved: true,
    };
    const fullNote = {
      content: "Original database text before edits",
      updated_at: t0, // DB row has NOT changed since the user started editing
    };

    const result = reconcileSnapshotWithDb(cached, fullNote);
    expect(result.action).toBe("keep_snapshot_and_mark_dirty");
    expect(result.content).toBe("Unsaved local edit that survived app kill");
    expect(result.isDirty).toBe(true);
  });

  it("Case 3 (Text loss prevention): save C1 in flight -> user types C2 -> blur writes snapshot (C2, base T0, unsaved) -> C1 lands (DB T1) -> hard kill -> boot sees T1 != T0 -> Case 3 re-applies C2 and marks dirty", () => {
    // Sequence:
    // 1. Initial note state at T0.
    // 2. User typed C1, save C1 sent in-flight.
    // 3. User immediately typed C2 (uncommitted, based on T0).
    // 4. Window blur writes snapshot: content C2, baseUpdatedAt T0, unsaved: true.
    // 5. C1 lands in SQLite backend, updating DB row updated_at to T1 (content C1).
    // 6. Hard kill occurs before frontend can finish saving C2.
    // 7. On reboot: DB has content C1 with timestamp T1. Snapshot has content C2 with baseUpdatedAt T0.
    const cached = {
      content: "Content C2 (latest unsaved keystrokes)",
      baseUpdatedAt: t0,
      unsaved: true,
    };
    const fullNote = {
      content: "Content C1 (landed from prior in-flight save)",
      updated_at: t1, // DB timestamp advanced to T1!
    };

    const result = reconcileSnapshotWithDb(cached, fullNote);
    // In single-instance rayNote with no external background writers, C2 is strictly newer than C1.
    // The snapshot must win and be marked dirty so C2 will be saved to DB.
    expect(result.action).toBe("keep_snapshot_and_mark_dirty");
    expect(result.content).toBe("Content C2 (latest unsaved keystrokes)");
    expect(result.isDirty).toBe(true);
  });

  it("Snapshot written while save is in flight: when in-flight save lands, baseUpdatedAt is updated to T1", () => {
    const cache = new NoteLRUCache(10, 1024 * 1024);
    // Snapshot written while save C1 is in flight (based on T0)
    cache.set("note-inflight", "Content C2 in flight", t0, undefined, 0, true);

    expect(cache.get("note-inflight")?.baseUpdatedAt).toBe(t0);
    expect(cache.get("note-inflight")?.unsaved).toBe(true);

    // In-flight save C1 lands in SQLite and returns authoritative new updated_at T1
    cache.setBaseUpdatedAt("note-inflight", t1, true); // Still unsaved because C2 was typed
    cache.persistActiveToLocalStorage("note-inflight", "Content C2 in flight", t1, true);

    // Verify cache and localStorage now reflect baseUpdatedAt T1
    const entry = cache.get("note-inflight");
    expect(entry?.baseUpdatedAt).toBe(t1);
    expect(entry?.unsaved).toBe(true);

    const rehydrated = new NoteLRUCache(10, 1024 * 1024);
    const rehydratedEntry = rehydrated.get("note-inflight");
    expect(rehydratedEntry?.baseUpdatedAt).toBe(t1);
    expect(rehydratedEntry?.unsaved).toBe(true);
  });

  it("NoteLRUCache localStorage hydration restores baseUpdatedAt and unsaved metadata", () => {
    const cache = new NoteLRUCache(10, 1024 * 1024);
    cache.persistActiveToLocalStorage("boot-note", "Snapshot Content", t0, true);

    const rehydratedCache = new NoteLRUCache(10, 1024 * 1024);
    const entry = rehydratedCache.get("boot-note");
    expect(entry).toBeDefined();
    expect(entry?.content).toBe("Snapshot Content");
    expect(entry?.baseUpdatedAt).toBe(t0);
    expect(entry?.unsaved).toBe(true);
  });

  it("snapshot refers to a note that no longer exists in the DB: evicts clean orphan and recovers unsaved text as new note without dirtying dead ID", () => {
    // 1. Clean snapshot for a note deleted from SQLite (e.g. deleted while app was closed or pruned)
    const cleanOrphanSnapshot = {
      content: "Deleted note text",
      baseUpdatedAt: t0,
      unsaved: false,
    };

    const resultClean = reconcileSnapshotWithDb(cleanOrphanSnapshot, null);
    expect(resultClean.action).toBe("evict_orphan");
    expect(resultClean.isDirty).toBe(false);

    // 2. Unsaved snapshot for a note missing from SQLite:
    // Invariant: Do NOT mark dirty and save to the dead ID (which would fail with QueryReturnedNoRows).
    // Returns "recover_orphan_as_new" so the app can create a fresh note, switch to it, and evict the dead snapshot.
    const unsavedOrphanSnapshot = {
      content: "Unsaved text in a note that was removed from SQLite",
      baseUpdatedAt: t0,
      unsaved: true,
    };

    const resultUnsaved = reconcileSnapshotWithDb(unsavedOrphanSnapshot, null);
    expect(resultUnsaved.action).toBe("recover_orphan_as_new");
    expect(resultUnsaved.content).toBe("Unsaved text in a note that was removed from SQLite");
    expect(resultUnsaved.isDirty).toBe(false);
  });

  it("deleteNote clears localStorage snapshot when IDs match and preserves it when they do not", async () => {
    // 1. Snapshot exists for note-delete-1
    localStorage.setItem("notefast_active_note_id", "note-delete-1");
    localStorage.setItem("notefast_active_note_content", "Snapshot of note 1");
    localStorage.setItem("notefast_active_note_base_updated_at", t0);
    localStorage.setItem("notefast_active_note_unsaved", "true");

    // Deleting an unrelated note leaves note-delete-1 snapshot intact
    await deleteNote("unrelated-note");
    expect(localStorage.getItem("notefast_active_note_id")).toBe("note-delete-1");
    expect(localStorage.getItem("notefast_active_note_content")).toBe("Snapshot of note 1");

    // Deleting note-delete-1 clears the snapshot
    await deleteNote("note-delete-1");
    expect(localStorage.getItem("notefast_active_note_id")).toBeNull();
    expect(localStorage.getItem("notefast_active_note_content")).toBeNull();
    expect(localStorage.getItem("notefast_active_note_base_updated_at")).toBeNull();
    expect(localStorage.getItem("notefast_active_note_unsaved")).toBeNull();
  });
});
