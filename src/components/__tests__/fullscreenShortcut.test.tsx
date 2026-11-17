// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { TitleBar } from "../TitleBar";
import { ShortcutsModal } from "../ShortcutsModal";
import { DEFAULT_COMMANDS, splitHotkeyToKeys } from "../../lib/commandsConfig";
import { matchesEvent, setCapsLockHeld, formatKeystrokeFromEvent } from "../../lib/settingsSync";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
  })),
}));

describe("Fullscreen Shortcut & Hyper Key Integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setCapsLockHeld(false);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    setCapsLockHeld(false);
    vi.clearAllMocks();
  });

  it("DEFAULT_COMMANDS registers toggle_fullscreen with default hotkey ⌃F", () => {
    const cmd = DEFAULT_COMMANDS.find((c) => c.id === "toggle_fullscreen");
    expect(cmd).toBeDefined();
    expect(cmd?.hotkey).toBe("⌃F");
    expect(cmd?.title).toBe("Toggle Fullscreen");
    expect(cmd?.category).toBe("commands");
  });

  it("TitleBar green button renders dynamic hotkey in tooltip", () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        <TitleBar
          title="Fullscreen Note"
          isFullscreen={false}
          onToggleFullscreen={onToggle}
          onNewNote={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onDuplicateNote={vi.fn()}
          onDeleteNote={vi.fn()}
          onCopyMarkdown={vi.fn()}
        />
      );
    });

    const greenBtn = container.querySelector(".fullscreen-btn") as HTMLButtonElement;
    expect(greenBtn).not.toBeNull();
    expect(greenBtn.getAttribute("title")).toBe("Enter fullscreen (⌃F)");

    act(() => {
      greenBtn.click();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("ShortcutsModal displays Toggle Fullscreen alongside Hide Window", () => {
    act(() => {
      root.render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    });

    const modalText = container.textContent || "";
    expect(modalText).toContain("Toggle Fullscreen (Green Button)");
    expect(modalText).toContain("Hide Window (Run in Background)");
  });

  it("splits hotkey with Hyper modifier into badge symbols", () => {
    expect(splitHotkeyToKeys("✦F")).toEqual(["✦", "F"]);
    expect(splitHotkeyToKeys("⌃F")).toEqual(["⌃", "F"]);
  });

  it("supports Control + F as fullscreen shortcut", () => {
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true });
    expect(matchesEvent(event, "⌃F")).toBe(true);
    expect(matchesEvent(event, "^F")).toBe(true);
    expect(matchesEvent(event, "Control+F")).toBe(true);
  });

  it("supports Caps Lock as Hyper key", () => {
    // When Caps Lock is pressed alone
    const capsEvent = new KeyboardEvent("keydown", { key: "CapsLock", code: "CapsLock" });
    expect(formatKeystrokeFromEvent(capsEvent)).toEqual({ isModifierOnly: true, result: "✦" });

    // When Caps Lock is held down + F is pressed
    setCapsLockHeld(true);
    const eventF = new KeyboardEvent("keydown", { key: "f" });
    expect(matchesEvent(eventF, "✦F")).toBe(true);
    expect(matchesEvent(eventF, "Hyper+F")).toBe(true);
    expect(formatKeystrokeFromEvent(eventF)).toEqual({ isModifierOnly: false, result: "✦F" });

    // When Caps Lock is released
    setCapsLockHeld(false);
    expect(matchesEvent(eventF, "✦F")).toBe(false);
  });

  it("supports hardware/Karabiner 4-modifier combo as Hyper", () => {
    const event = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      altKey: true,
      ctrlKey: true,
      shiftKey: true,
    });
    expect(matchesEvent(event, "✦F")).toBe(true);
    expect(formatKeystrokeFromEvent(event)).toEqual({ isModifierOnly: false, result: "✦F" });
  });
});
