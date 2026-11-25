// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import SettingsApp from "../../SettingsApp";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    notes_count: 42,
    size_bytes: 1048576,
    db_path: "/Users/test/Library/Application Support/rayNote/notes.db",
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Settings sidebar navigation", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders all four sections in the settings sidebar", async () => {
    await act(async () => {
      root.render(<SettingsApp />);
    });

    const sidebar = host.querySelector(".settings-sidebar");
    expect(sidebar).not.toBeNull();

    const items = host.querySelectorAll(".settings-sidebar-item");
    expect(items.length).toBe(4);

    const sectionNames = Array.from(items).map((p) => p.textContent?.trim());
    expect(sectionNames).toEqual(["General", "Commands", "Storage", "About"]);
  });

  it("indicates the selected section and updates the pane heading and content", async () => {
    await act(async () => {
      root.render(<SettingsApp />);
    });

    const items = host.querySelectorAll<HTMLButtonElement>(".settings-sidebar-item");

    // 1. Initial tab is General
    expect(items[0].hasAttribute("aria-current")).toBe(true);
    expect(host.querySelector("#settings-pane-title")?.textContent).toBe("General");
    expect(host.textContent).toContain("Appearance");
    const clarity = host.querySelector<HTMLInputElement>(".glass-clarity-slider")!;
    expect(clarity.labels?.[0]?.textContent).toContain("Note Window Liquid Glass");
    expect(host.textContent).toContain("Adjusts the transparency of the note window.");

    // 2. Click Commands tab (unified Commands, Aliases, and Hotkeys)
    await act(async () => {
      items[1].click();
    });
    expect(items[1].hasAttribute("aria-current")).toBe(true);
    expect(items[0].hasAttribute("aria-current")).toBe(false);
    expect(host.querySelector("#settings-pane-title")?.textContent).toBe("Commands");
    expect(host.textContent).toContain("Application & Window Commands");
    expect(host.querySelector(".settings-aliases-search-input")).not.toBeNull();
    expect(host.textContent).toContain("Reset Defaults");
    expect(host.querySelector(".settings-cmd-checkbox")).not.toBeNull();

    // 3. Click Storage tab
    await act(async () => {
      items[2].click();
    });
    expect(items[2].hasAttribute("aria-current")).toBe(true);
    expect(host.textContent).toContain("SQLite Database Storage");
    expect(host.textContent).toContain("Open in Finder");
    expect(host.textContent).toContain("Total Notes");
    expect(host.textContent).toContain("Export All Notes");
    expect(host.textContent).toContain("Export Markdown");
    expect(host.textContent).toContain("Danger Zone");
    expect(host.textContent).toContain("Move All to Trash");

    // 4. Click About tab
    await act(async () => {
      items[3].click();
    });
    expect(items[3].hasAttribute("aria-current")).toBe(true);
    expect(host.textContent).toContain("rayNote");
    expect(host.textContent).toContain("Universal");
    expect(host.textContent).toContain("Tech Stack");
  });

  it("preserves Storage actions and confirmation flow", async () => {
    await act(async () => {
      root.render(<SettingsApp />);
    });

    // Switch to Storage tab (index 2)
    const items = host.querySelectorAll<HTMLButtonElement>(".settings-sidebar-item");
    await act(async () => {
      items[2].click();
    });

    // Find Move All to Trash button
    const clearBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Move All to Trash")
    );
    expect(clearBtn).toBeDefined();

    // Click Move All to Trash to enter confirmation state
    await act(async () => {
      clearBtn?.click();
    });

    // Confirmation group should appear with checkbox and Move to Trash button
    expect(host.textContent).toContain("Confirm move");
    const deleteBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Move to Trash")
    );
    expect(deleteBtn).toBeDefined();
    expect(deleteBtn?.disabled).toBe(true);

    // Checking the checkbox enables the button
    const checkbox = host.querySelector<HTMLInputElement>(".settings-danger-checkbox input");
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox?.click();
    });
    expect(deleteBtn?.disabled).toBe(false);

    // Cancel restores initial state
    const cancelBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancel")
    );
    await act(async () => {
      cancelBtn?.click();
    });
    expect(host.textContent).toContain("Move All to Trash");
  });

  it("has responsive layout container structure for cards and rows", async () => {
    await act(async () => {
      root.render(<SettingsApp />);
    });

    const rootWindow = host.querySelector(".settings-window-root");
    expect(rootWindow).not.toBeNull();

    const bodyContent = host.querySelector(".settings-body-content");
    expect(bodyContent).not.toBeNull();

    const cards = host.querySelectorAll(".settings-card");
    expect(cards.length).toBeGreaterThan(0);

    const rows = host.querySelectorAll(".settings-row");
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.querySelector(".settings-row-text")).not.toBeNull();
      expect(row.querySelector(".settings-row-action")).not.toBeNull();
    });
  });
});
