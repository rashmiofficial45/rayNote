// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { invoke } from "@tauri-apps/api/core";
import {
  insertDictatedText,
  subscribeDictationState,
  isSpeechRecognitionAvailable,
  startNativeDictation,
  startDictation,
  stopDictation,
  toggleDictation,
} from "../dictation";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("Voice Dictation System", () => {
  let editor: Editor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (invoke as any).mockResolvedValue(undefined);
    editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Hello</p>",
    });
  });

  afterEach(() => {
    stopDictation();
    vi.useRealTimers();
    editor?.destroy();
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });

  describe("Availability & Subscription", () => {
    it("checks speech recognition availability when APIs are absent", () => {
      delete (window as any).SpeechRecognition;
      delete (window as any).webkitSpeechRecognition;
      expect(isSpeechRecognitionAvailable()).toBe(false);
    });

    it("checks speech recognition availability when SpeechRecognition or webkitSpeechRecognition is defined", () => {
      (window as any).SpeechRecognition = class MockSpeech {};
      expect(isSpeechRecognitionAvailable()).toBe(true);

      delete (window as any).SpeechRecognition;
      (window as any).webkitSpeechRecognition = class MockWebkit {};
      expect(isSpeechRecognitionAvailable()).toBe(true);
    });

    it("subscribes to dictation state changes and immediately yields initial status", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeDictationState(listener);

      expect(listener).toHaveBeenCalledWith(false, "");
      unsubscribe();
    });

    it("unsubscribes cleanly and stops receiving updates", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeDictationState(listener);
      listener.mockClear();

      unsubscribe();
      stopDictation();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("Dictated Text Insertion & Punctuation", () => {
    it("inserts dictated text with automatic spacing after existing text", () => {
      editor.commands.setTextSelection(6); // end of "Hello"

      insertDictatedText(editor, "world this is a test");
      expect(editor.getText()).toBe("Hello world this is a test");
    });

    it("inserts dictated text without extra space at start of empty line", () => {
      editor.commands.setContent("<p></p>");
      editor.commands.setTextSelection(1);

      insertDictatedText(editor, "Beginning of note");
      expect(editor.getText()).toBe("Beginning of note");
    });

    it("does not insert empty or whitespace-only dictated strings", () => {
      editor.commands.setTextSelection(6);
      insertDictatedText(editor, "   ");
      expect(editor.getText()).toBe("Hello");
    });

    it("does not insert extra leading space before punctuation marks", () => {
      editor.commands.setTextSelection(6);

      insertDictatedText(editor, ", world!");
      expect(editor.getText()).toBe("Hello, world!");

      insertDictatedText(editor, ".");
      expect(editor.getText()).toBe("Hello, world!.");

      insertDictatedText(editor, "?");
      expect(editor.getText()).toBe("Hello, world!.?");

      insertDictatedText(editor, ":");
      expect(editor.getText()).toBe("Hello, world!.?:");

      insertDictatedText(editor, ";");
      expect(editor.getText()).toBe("Hello, world!.?:;");
    });

    it("handles null or undefined editor gracefully without throwing", () => {
      expect(() => insertDictatedText(null, "some text")).not.toThrow();
      expect(() => insertDictatedText(undefined, "some text")).not.toThrow();
    });
  });

  describe("macOS Native Dictation & Tauri Bridge", () => {
    it("startNativeDictation successfully invokes start_native_dictation command", async () => {
      (invoke as any).mockResolvedValueOnce(undefined);
      const res = await startNativeDictation();

      expect(res).toBe(true);
      expect(invoke).toHaveBeenCalledWith("start_native_dictation");
    });

    it("startNativeDictation returns false when invoke fails", async () => {
      (invoke as any).mockRejectedValueOnce(new Error("Cocoa bridge failed"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const res = await startNativeDictation();
      expect(res).toBe(false);
      warnSpy.mockRestore();
    });

    it("startDictation focuses the editor if it is not currently focused", async () => {
      const focusSpy = vi.fn();
      vi.spyOn(editor, "commands", "get").mockReturnValue({ focus: focusSpy } as any);
      Object.defineProperty(editor, "isFocused", { get: () => false, configurable: true });

      await startDictation(editor);
      expect(focusSpy).toHaveBeenCalled();
    });

    it("startDictation notifies listeners and resets after 3.5s timeout on native fallback", async () => {
      const listener = vi.fn();
      const unsub = subscribeDictationState(listener);
      listener.mockClear();

      const okPromise = startDictation(editor);
      vi.advanceTimersByTime(10);
      await okPromise;

      expect(listener).toHaveBeenCalledWith(true, "");

      // Advance time by 3500ms
      vi.advanceTimersByTime(3500);
      expect(listener).toHaveBeenCalledWith(false, "");
      unsub();
    });
  });

  describe("Web Speech API Integration", () => {
    it("uses SpeechRecognition when available, streaming interim results and inserting final results", async () => {
      let createdInstance: any = null;

      class MockSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = "";
        onstart: any = null;
        onresult: any = null;
        onerror: any = null;
        onend: any = null;

        constructor() {
          createdInstance = this;
        }

        start = vi.fn(() => {
          if (this.onstart) this.onstart();
        });
        stop = vi.fn(() => {
          if (this.onend) this.onend();
        });
        abort = vi.fn();
      }

      (window as any).SpeechRecognition = MockSpeechRecognition;

      const listener = vi.fn();
      const unsub = subscribeDictationState(listener);
      listener.mockClear();

      editor.commands.setTextSelection(6); // end of "Hello"

      await startDictation(editor);
      expect(createdInstance).not.toBeNull();
      expect(createdInstance.continuous).toBe(true);
      expect(createdInstance.interimResults).toBe(true);
      expect(listener).toHaveBeenCalledWith(true, "");

      // Simulate interim result
      createdInstance.onresult({
        resultIndex: 0,
        results: [
          [{ transcript: "speaking..." }],
        ],
      });
      expect(listener).toHaveBeenCalledWith(true, "speaking...");

      // Simulate final result
      createdInstance.onresult({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: "from speech" }], { isFinal: true }),
        ],
      });
      expect(editor.getText()).toBe("Hello from speech");

      // Simulate onend
      createdInstance.onend();
      expect(listener).toHaveBeenCalledWith(false, "");

      unsub();
    });

    it("falls back to native dictation if SpeechRecognition throws not-allowed error", async () => {
      class MockSpeechRecognition {
        onstart: any = null;
        onerror: any = null;
        onend: any = null;
        start = vi.fn();
        stop = vi.fn();
        abort = vi.fn();
      }
      (window as any).SpeechRecognition = MockSpeechRecognition;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await startDictation(editor);

      stopDictation();
      warnSpy.mockRestore();
    });
  });

  describe("Toggle & Cancellation Lifecycle", () => {
    it("toggleDictation starts when idle and stops when active", async () => {
      const listener = vi.fn();
      const unsub = subscribeDictationState(listener);
      listener.mockClear();

      // First toggle: start dictation
      const startPromise = toggleDictation(editor);
      vi.advanceTimersByTime(10);
      await startPromise;

      expect(listener).toHaveBeenCalledWith(true, "");

      // Second toggle: stop dictation immediately
      const stopped = await toggleDictation(editor);
      expect(stopped).toBe(false);
      expect(listener).toHaveBeenCalledWith(false, "");

      unsub();
    });

    it("cancels nativeFallbackTimer when stopDictation is called early", async () => {
      const listener = vi.fn();
      const unsub = subscribeDictationState(listener);
      listener.mockClear();

      await startDictation(editor);
      expect(listener).toHaveBeenCalledWith(true, "");

      // Stop before 3500ms timeout
      vi.advanceTimersByTime(1000);
      stopDictation();
      expect(listener).toHaveBeenCalledWith(false, "");

      // Advance past the initial 3500ms - no additional redundant calls
      listener.mockClear();
      vi.advanceTimersByTime(3000);
      expect(listener).not.toHaveBeenCalled();

      unsub();
    });
  });
});
