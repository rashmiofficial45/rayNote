// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { blockSelectionPluginKey } from "../../extensions/BlockSelection";
import { copyToClipboard } from "../../lib/clipboard";
import { getBlockContentRects } from "../../extensions/useBlockDrag";
import { describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { mountMermaidPreview } from "../mermaidPreview";
import { MarkdownViewerModal } from "../../components/MarkdownViewerModal";
import { getExtensions } from "../extensions";
import { isMarkdownContent, markdownToTipTapHtml } from "../markdownUtils";

vi.mock("../../lib/clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 100"><title>Deployment</title></svg>',
    })),
  },
}));
vi.mock("../../components/DocumentTickSlider", () => ({ DocumentTickSlider: () => null }));

const source = "flowchart LR\nA[Build] --> B[Deploy]";
const markdown = "# Diagrams\n\n~~~MERMAID\n" + source + "\n~~~\n\n```javascript\nlet n = 1;\n```";

describe("Mermaid fences", () => {
  it("shows the diagram by default and retains editable, exportable source", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({ element: host, extensions: getExtensions(), content: markdownToTipTapHtml(markdown) });
    try {
      const block = host.querySelector(".mermaid-block")!;
      const pre = block.querySelector("pre")!;
      expect(isMarkdownContent("~~~mermaid\n" + source + "\n~~~")).toBe(true);
      expect(pre.hidden).toBe(true);
      expect(host.querySelector(".language-javascript")?.textContent?.trim()).toBe("let n = 1;");
      expect(editor.getMarkdown()).toContain(source);
      block.querySelector("button")!.click();
      expect(pre.hidden).toBe(false);
      expect(pre.textContent?.trim()).toBe(source);
      block.querySelector("button")!.click();
      expect(pre.hidden).toBe(true);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("selects the whole preview and gives the block a visible drag target", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({ element: host, extensions: getExtensions(), content: markdownToTipTapHtml(markdown) });
    try {
      const block = host.querySelector<HTMLElement>(".mermaid-block")!;
      block.querySelector(".mermaid-preview")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const { selection } = editor.state;
      expect(selection).toBeInstanceOf(NodeSelection);
      expect((selection as NodeSelection).node.textContent.trim()).toBe(source);
      expect(block.draggable).toBe(true);

      block.querySelector(".mermaid-preview")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
      expect(blockSelectionPluginKey.getState(editor.state)?.selectedPositions).toEqual([selection.from]);

      vi.spyOn(block, "getBoundingClientRect").mockReturnValue(new DOMRect(12, 30, 100, 60));
      expect(getBlockContentRects(block, new DOMRect(), 0)).toEqual([
        { left: 12, right: 112, top: 30, bottom: 90 },
      ]);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("allows editing, copying and removing a diagram loaded during a read-only note switch", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({ element: host, extensions: getExtensions(), editable: false, content: markdownToTipTapHtml(markdown), editorProps: { handleScrollToSelection: () => true } });
    try {
      editor.setEditable(true, false);
      const block = host.querySelector(".mermaid-block")!;
      const edit = block.querySelector<HTMLButtonElement>('[aria-label="Edit Mermaid code"]')!;
      expect(edit.parentElement!.hidden).toBe(false);
      edit.click();
      expect(block.querySelector("pre")!.hidden).toBe(false);
      expect(edit.getAttribute("aria-label")).toBe("Show diagram");
      block.querySelector<HTMLButtonElement>('[aria-label="Copy Mermaid code"]')!.click();
      await vi.waitFor(() => expect(block.textContent).toContain("Mermaid code copied"));
      expect(copyToClipboard).toHaveBeenCalledWith(block.querySelector("pre")!.textContent);
      edit.click();
      expect(block.querySelector("pre")!.hidden).toBe(true);
      block.querySelector<HTMLButtonElement>('[aria-label="Delete Mermaid diagram"]')!.click();
      expect(editor.getMarkdown()).not.toContain(source);
      expect(editor.getMarkdown()).toContain("let n = 1;");
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getMarkdown()).toContain(source);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("does not bubble a delete click after the toolbar is removed from the editor", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({
      element: host,
      extensions: getExtensions(),
      content: markdownToTipTapHtml(markdown),
      editorProps: { attributes: { class: "tiptap" } },
    });
    const outsideClick = vi.fn();
    host.addEventListener("click", (event) => {
      if (event.target instanceof Element && !event.target.closest(".tiptap")) outsideClick();
    });
    try {
      host.querySelector<HTMLButtonElement>('[aria-label="Delete Mermaid diagram"]')!.click();
      expect(host.querySelector(".mermaid-block")).toBeNull();
      expect(outsideClick).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("shares layout work between duplicate diagrams and reuses the completed result on reopen", async () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const code = "flowchart LR\nCache --> Reopen";
    const dispose = [mountMermaidPreview(first, code), mountMermaidPreview(second, code)];
    try {
      await vi.waitFor(() => expect(second.querySelector('[role="img"]')).not.toBeNull());
      expect(first.querySelector('[role="img"]')).not.toBeNull();
      const reopened = document.createElement("div");
      dispose.push(mountMermaidPreview(reopened, code));
      expect(reopened.querySelector('[role="img"]')).not.toBeNull();
      expect(vi.mocked(mermaid.render).mock.calls.filter(([, source]) => source === code)).toHaveLength(1);
    } finally {
      dispose.forEach(close => close());
    }
  });

  it("shows only the diagram for a Mermaid fence in the Markdown file preview", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(
        <MarkdownViewerModal fileData={{ name: "diagram.md", content: markdown }} onClose={() => {}} onImportToNotes={() => {}} />
      ));
      const rendered = host.querySelector(".md-viewer-rendered")!;
      await vi.waitFor(() => expect(rendered.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Deployment"));
      expect(rendered.textContent).not.toContain(source);
      expect(rendered.querySelector("code")?.textContent?.trim()).toBe("let n = 1;");
      await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Raw")!.click());
      expect(host.querySelector(".md-viewer-raw")?.textContent).toBe(markdown);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
