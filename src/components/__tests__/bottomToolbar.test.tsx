// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { getExtensions } from "../../editor/extensions";
import { BottomToolbar } from "../BottomToolbar";
import * as themeModule from "../../lib/theme";

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
  }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("BottomToolbar UI Component", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editor: Editor;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    editor = new Editor({
      extensions: getExtensions(),
      content: "<p>Initial editor text</p>",
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

  it("renders format corner button", () => {
    act(() => {
      root.render(<BottomToolbar editor={editor} />);
    });

    const formatBtn = container.querySelector(".format-corner-btn[aria-label='Format']");
    expect(formatBtn).not.toBeNull();
  });

  it("toggles format menu when format button is clicked", () => {
    act(() => {
      root.render(<BottomToolbar editor={editor} />);
    });

    const formatBtn = container.querySelector(".format-corner-btn[aria-label='Format']") as HTMLButtonElement;
    expect(container.querySelector(".bottom-toolbar-expanded-menu")).toBeNull();

    // Click to open menu
    act(() => {
      formatBtn.click();
    });

    expect(container.querySelector(".bottom-toolbar-expanded-menu")).not.toBeNull();

    // Click again to close menu
    act(() => {
      formatBtn.click();
    });

    expect(container.querySelector(".bottom-toolbar-expanded-menu")).toBeNull();
  });

  it("displays and selects theme modes (dark, light, system)", () => {
    const setThemeSpy = vi.spyOn(themeModule, "setStoredThemeMode");

    act(() => {
      root.render(<BottomToolbar editor={editor} />);
    });

    // Open format menu
    const formatBtn = container.querySelector(".format-corner-btn[aria-label='Format']") as HTMLButtonElement;
    act(() => {
      formatBtn.click();
    });

    const lightBtn = container.querySelector("button[aria-label='Light Mode']") as HTMLButtonElement;
    expect(lightBtn).not.toBeNull();

    act(() => {
      lightBtn.click();
    });

    expect(setThemeSpy).toHaveBeenCalledWith("light");
  });

  it("displays 6 accent palette color buttons and handles accent selection", () => {
    const setAccentSpy = vi.spyOn(themeModule, "setStoredAccent");

    act(() => {
      root.render(<BottomToolbar editor={editor} />);
    });

    // Open format menu
    const formatBtn = container.querySelector(".format-corner-btn[aria-label='Format']") as HTMLButtonElement;
    act(() => {
      formatBtn.click();
    });

    const accentButtons = container.querySelectorAll(".accent-color-btn");
    expect(accentButtons.length).toBe(6);

    const emeraldBtn = container.querySelector("button[aria-label='Accent: Emerald Mint']") as HTMLButtonElement;
    expect(emeraldBtn).not.toBeNull();

    act(() => {
      emeraldBtn.click();
    });

    expect(setAccentSpy).toHaveBeenCalledWith("emerald");
  });

  it("opens font dropdown and selects font option", () => {
    const setFontSpy = vi.spyOn(themeModule, "setStoredFont");

    act(() => {
      root.render(<BottomToolbar editor={editor} />);
    });

    // Open format menu
    const formatBtn = container.querySelector(".format-corner-btn[aria-label='Format']") as HTMLButtonElement;
    act(() => {
      formatBtn.click();
    });

    const fontBtn = container.querySelector(".toolbar-font-btn") as HTMLButtonElement;
    expect(fontBtn).not.toBeNull();

    // Open font dropdown
    act(() => {
      fontBtn.click();
    });

    const fontOptions = container.querySelectorAll(".toolbar-font-item");
    expect(fontOptions.length).toBe(6);

    const monoOption = Array.from(fontOptions).find(
      (btn) => btn.getAttribute("title") === "JetBrains Mono"
    ) as HTMLButtonElement;
    expect(monoOption).not.toBeNull();

    act(() => {
      monoOption.click();
    });

    expect(setFontSpy).toHaveBeenCalledWith("mono");
  });

  it("indicates active formatting with dot when editor has active marks or headings", () => {
    editor.commands.selectAll();
    editor.commands.toggleHeading({ level: 1 });

    act(() => {
      root.render(<BottomToolbar editor={editor} />);
    });

    const indicatorDot = container.querySelector(".format-indicator-dot");
    expect(indicatorDot).not.toBeNull();
  });
});
