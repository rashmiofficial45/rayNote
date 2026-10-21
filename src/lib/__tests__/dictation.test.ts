// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  insertDictatedText,
  subscribeDictationState,
  isSpeechRecognitionAvailable,
  stopDictation,
} from "../dictation";

describe("Voice Dictation System", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Hello</p>",
    });
  });

  it("checks speech recognition availability", () => {
    expect(typeof isSpeechRecognitionAvailable()).toBe("boolean");
  });

  it("subscribes to dictation state changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDictationState(listener);

    expect(listener).toHaveBeenCalledWith(false, "");
    unsubscribe();
  });

  it("inserts dictated text with automatic spacing after existing text", () => {
    // Place cursor at the end of "Hello" (pos 6)
    editor.commands.setTextSelection(6);

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

  it("stops dictation cleanly", () => {
    const listener = vi.fn();
    const unsub = subscribeDictationState(listener);

    stopDictation();
    expect(listener).toHaveBeenCalledWith(false, "");
    unsub();
  });
});
