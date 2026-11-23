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

  it.each([
    ["Bold", "strong", "Text styles"],
    ["Italic", "em", "Text styles"],
    ["Underline", "u", "Text styles"],
    ["Strikethrough", "s", "Text styles"],
    ["Inline Code", "code", null],
    ["Heading 1", "h1", "Headings"],
    ["Heading 2", "h2", "Headings"],
    ["Bullet List", "ul", "Lists"],
    ["Numbered List", "ol", "Lists"],
    ["Task List", 'ul[data-type="taskList"]', "Lists"],
    ["Quote", "blockquote", null],
    ["Code Block", "pre", null],
    ["Divider", "hr", "Insert"],
    ["Insert Table", "table", "Insert"],
  ])("applies %s using the dock control", (label, selector, group) => {
    editor.commands.selectAll();
    act(() => root.render(<BottomToolbar editor={editor} />));
    act(() => container.querySelector<HTMLButtonElement>(".format-corner-btn")!.click());
    if (group) act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${group}"]`)!.click());
    const button = container.querySelector<HTMLButtonElement>(`button[title^="${label}"]`);
    expect(button).not.toBeNull();
    act(() => button!.click());
    const output = document.createElement("div");
    output.innerHTML = editor.getHTML();
    expect(output.querySelector(selector)).not.toBeNull();
    if (label === "Divider") expect(output.textContent).toContain("Initial editor text");
  });

  it("preserves selected text when opening the dock and applies and clears highlighting", () => {
    editor.commands.selectAll();
    const selection = editor.state.selection;
    act(() => root.render(<BottomToolbar editor={editor} />));
    act(() => container.querySelector<HTMLButtonElement>(".format-corner-btn")!.click());
    expect(editor.state.selection.eq(selection)).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Highlight options"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('.highlight-swatches [data-color="yellow"]')!.click());
    expect(editor.getHTML()).toContain("<mark");
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove highlight"]')!.click());
    expect(editor.getHTML()).not.toContain("<mark");
  });

  it("returns keyboard focus to Format after closing the dock with Escape", () => {
    act(() => root.render(<BottomToolbar editor={editor} />));
    const toggle = container.querySelector<HTMLButtonElement>(".format-corner-btn")!;
    toggle.focus();
    act(() => toggle.click());
    expect(document.activeElement).toBe(container.querySelector(".toolbar-btn"));
    act(() => document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
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

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Appearance"]')!.click());
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

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Appearance"]')!.click());
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

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Appearance"]')!.click());
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
