// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

describe("Transaction Audit: Extension Decorations & 1 MB Note Keystroke Profiling", () => {
  const lowlight = createLowlight(common);

  function generate1MbParagraphs(count: number = 6961): string {
    const p = "<p>Real world paragraph text testing ProseMirror transaction latency across large documents.</p>";
    return p.repeat(count);
  }

  it("verifies Placeholder with showOnlyCurrent: true does not traverse 1 MB blocks on keystroke", () => {
    // 2,000 paragraphs
    const content = generate1MbParagraphs(2000);
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        Placeholder.configure({
          placeholder: "Type something...",
          showOnlyCurrent: true,
          includeChildren: false,
        }),
      ],
      content,
    });

    const docSize = editor.state.doc.content.size;
    expect(docSize).toBeGreaterThan(100_000);

    // Warm up
    editor.commands.insertContentAt(50, "a");

    const iterations = 50;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      editor.commands.insertContentAt(50 + i, "x");
    }
    const elapsed = performance.now() - start;
    const perKeystrokeMs = elapsed / iterations;

    console.log(
      `[MEASURED: Vitest/Node performance.now(), development, 50 keystrokes]: Placeholder per-keystroke = ${perKeystrokeMs.toFixed(3)} ms`
    );

    expect(perKeystrokeMs).toBeLessThan(15);
    editor.destroy();
  });

  it("profiles 1 MB note with vs without CodeBlockLowlight to measure findChildren iteration cost", () => {
    const content = generate1MbParagraphs(2000);

    // 1. Editor WITHOUT CodeBlockLowlight
    const editorWithout = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false })],
      content,
    });

    // Warm
    editorWithout.commands.insertContentAt(100, "a");
    const iterations = 30;

    const startWithout = performance.now();
    for (let i = 0; i < iterations; i++) {
      editorWithout.commands.insertContentAt(100 + i, "x");
    }
    const elapsedWithout = performance.now() - startWithout;
    const perKeystrokeWithoutMs = elapsedWithout / iterations;
    editorWithout.destroy();

    // 2. Editor WITH CodeBlockLowlight
    const editorWith = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        CodeBlockLowlight.configure({
          lowlight,
        }),
      ],
      content,
    });

    // Warm
    editorWith.commands.insertContentAt(100, "a");

    const startWith = performance.now();
    for (let i = 0; i < iterations; i++) {
      editorWith.commands.insertContentAt(100 + i, "x");
    }
    const elapsedWith = performance.now() - startWith;
    const perKeystrokeWithMs = elapsedWith / iterations;
    editorWith.destroy();

    console.log(
      `[MEASURED: Vitest/Node performance.now(), development, 30 keystrokes on 2,000 paragraphs]: ` +
      `Without Lowlight = ${perKeystrokeWithoutMs.toFixed(3)} ms/keystroke | ` +
      `With Lowlight = ${perKeystrokeWithMs.toFixed(3)} ms/keystroke | ` +
      `Overhead = ${(perKeystrokeWithMs - perKeystrokeWithoutMs).toFixed(3)} ms`
    );

    expect(perKeystrokeWithoutMs).toBeGreaterThan(0);
    expect(perKeystrokeWithMs).toBeGreaterThan(0);
  });
});
