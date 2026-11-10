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

describe("Settings Window Responsiveness & Navigation Tabs", () => {
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

  it("renders all 5 navigation tabs without clipping in a fluid container", async () => {
    await act(async () => {
      root.render(<SettingsApp />);
    });

    const pillsContainer = host.querySelector(".settings-tab-pills-container");
    expect(pillsContainer).not.toBeNull();

    const pills = host.querySelectorAll(".settings-tab-pill");
    expect(pills.length).toBe(5);

    const tabNames = Array.from(pills).map((p) => p.textContent?.trim());
    expect(tabNames).toEqual(["General", "Commands", "Aliases", "Storage", "About"]);
  });

  it("allows switching to each tab with active state and correct content rendered", async () => {
    await act(async () => {
      root.render(<SettingsApp />);
    });

    const pills = host.querySelectorAll<HTMLButtonElement>(".settings-tab-pill");

    // 1. Initial tab is General
    expect(pills[0].classList.contains("is-active")).toBe(true);
    expect(host.textContent).toContain("Appearance");

    // 2. Click Commands tab
    await act(async () => {
      pills[1].click();
    });
    expect(pills[1].classList.contains("is-active")).toBe(true);
    expect(pills[0].classList.contains("is-active")).toBe(false);
    expect(host.textContent).toContain("Commands");
    expect(host.textContent).toContain("Application & Window Commands");

    // 3. Click Aliases tab
    await act(async () => {
      pills[2].click();
    });
    expect(pills[2].classList.contains("is-active")).toBe(true);
    expect(host.querySelector(".settings-aliases-search-input")).not.toBeNull();
    expect(host.textContent).toContain("Reset Defaults");

    // 4. Click Storage tab
    await act(async () => {
      pills[3].click();
    });
    expect(pills[3].classList.contains("is-active")).toBe(true);
    expect(host.textContent).toContain("SQLite Database Storage");
    expect(host.textContent).toContain("Open in Finder");
    expect(host.textContent).toContain("Total Notes");
    expect(host.textContent).toContain("Export All Notes");
    expect(host.textContent).toContain("Export Markdown");
    expect(host.textContent).toContain("Danger Zone");
    expect(host.textContent).toContain("Clear All Notes");

    // 5. Click About tab
    await act(async () => {
      pills[4].click();
    });
    expect(pills[4].classList.contains("is-active")).toBe(true);
    expect(host.textContent).toContain("rayNote");
    expect(host.textContent).toContain("Universal");
    expect(host.textContent).toContain("Tech Stack");
  });

  it("preserves Storage actions and confirmation flow", async () => {
    await act(async () => {
      root.render(<SettingsApp />);
    });

    // Switch to Storage tab
    const pills = host.querySelectorAll<HTMLButtonElement>(".settings-tab-pill");
    await act(async () => {
      pills[3].click();
    });

    // Find Clear All Notes button
    const clearBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Clear All Notes")
    );
    expect(clearBtn).toBeDefined();

    // Click Clear All Notes to enter confirmation state
    await act(async () => {
      clearBtn?.click();
    });

    // Confirmation group should appear with checkbox and Delete All button
    expect(host.textContent).toContain("Confirm erase");
    const deleteBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Delete All")
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
    expect(host.textContent).toContain("Clear All Notes");
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
