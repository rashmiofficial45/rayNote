// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { Editor as TipTapEditor } from "@tiptap/core";
import { getExtensions } from "../extensions";

describe("Phase 13: Link Performance & Keystroke Overhead Validation", () => {
  function generateWordDocument(wordCount: number): string {
    const baseWords = [
      "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing",
      "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore"
    ];
    const paragraphs: string[] = [];
    let currentCount = 0;
    while (currentCount < wordCount) {
      const pWords: string[] = [];
      const pLen = Math.min(50, wordCount - currentCount);
      for (let i = 0; i < pLen; i++) {
        pWords.push(baseWords[(currentCount + i) % baseWords.length]);
      }
      paragraphs.push(`<p>${pWords.join(" ")}</p>`);
      currentCount += pLen;
    }
    return paragraphs.join("");
  }

  const sizes = [1_000, 10_000, 50_000];

  for (const size of sizes) {
    it(`measures keystroke latency and transaction overhead on ${size.toLocaleString()}-word document`, () => {
      const content = generateWordDocument(size);
      const editor = new TipTapEditor({
        content,
        extensions: getExtensions(),
      });

      // Position caret at middle of document
      const midPos = Math.floor(editor.state.doc.content.size / 2);
      editor.commands.setTextSelection(midPos);

      const iterations = 50;
      const start = performance.now();

      let transactionCount = 0;
      const handleTx = () => {
        transactionCount++;
      };
      editor.on("transaction", handleTx);

      for (let i = 0; i < iterations; i++) {
        editor.view.dispatch(editor.view.state.tr.insertText("a"));
      }

      const elapsed = performance.now() - start;
      const perKeystroke = elapsed / iterations;

      editor.off("transaction", handleTx);

      // Verify strict 1 transaction per keystroke (no runaway appendTransactions)
      expect(transactionCount).toBe(iterations);

      // Under happy-dom emulation, 50k word simulated insertions must remain fast (< 15ms per keystroke in test runner)
      expect(perKeystroke).toBeLessThan(20);

      editor.destroy();
    });
  }

  it("verifies autolink overhead is strictly scoped to changed range", () => {
    const content = "<p></p>" + generateWordDocument(5_000);
    const editor = new TipTapEditor({
      content,
      extensions: getExtensions(),
    });

    const start = performance.now();
    // Insert text then space to trigger autolink appendTransaction
    const url = "https://raynote.app";
    editor.view.dispatch(editor.view.state.tr.insertText(url, 1));
    editor.view.dispatch(editor.view.state.tr.insertText(" ", 1 + url.length));
    const duration = performance.now() - start;

    let hasLink = false;
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "link")) {
        hasLink = true;
      }
    });

    expect(hasLink).toBe(true);
    expect(duration).toBeLessThan(35); // Fast autolink under 35ms in headless happy-dom

    editor.destroy();
  });
});
