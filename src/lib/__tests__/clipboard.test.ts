// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "../clipboard";
import * as tauriCore from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("Clipboard Fallback Chain Suite", () => {
  const originalNavigatorClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalNavigatorClipboard,
      configurable: true,
      writable: true,
    });
  });

  it("Layer 1: returns true when navigator.clipboard.writeText succeeds", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    const success = await copyToClipboard("Hello world");
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("Hello world");
    expect(tauriCore.invoke).not.toHaveBeenCalled();
  });

  it("Layer 2: falls back to Tauri native invoke('write_to_clipboard') when navigator.clipboard throws", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Clipboard permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });
    vi.mocked(tauriCore.invoke).mockResolvedValue(undefined as any);

    const success = await copyToClipboard("Fallback to pbcopy");
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("Fallback to pbcopy");
    expect(tauriCore.invoke).toHaveBeenCalledWith("write_to_clipboard", { text: "Fallback to pbcopy" });
  });

  it("Layer 3: falls back to document.execCommand when both navigator.clipboard and Tauri invoke throw", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Blocked"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });
    vi.mocked(tauriCore.invoke).mockRejectedValue(new Error("Tauri IPC failed"));

    const execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    const success = await copyToClipboard("Fallback to execCommand");
    expect(success).toBe(true);
    expect(execCommandMock).toHaveBeenCalledWith("copy");
  });

  it("returns false when all 3 clipboard strategies fail", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Blocked"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });
    vi.mocked(tauriCore.invoke).mockRejectedValue(new Error("Tauri IPC failed"));

    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error("execCommand failed");
    });

    const success = await copyToClipboard("All failed");
    expect(success).toBe(false);
  });
});
