// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  lowlight,
  ensureLanguageLoaded,
  scanCodeBlockLanguages,
  preloadLanguagesForContent,
  LANGUAGE_ALIASES,
  getExtensions,
} from "../extensions";
import { Editor } from "@tiptap/core";

describe("Lowlight Dynamic Grammar Loader & First-Render Highlighting", () => {
  it("resolves user aliases correctly (js, ts, py, sh, zsh, yml, md, rs, tsx, jsx)", () => {
    expect(LANGUAGE_ALIASES["js"]).toBe("javascript");
    expect(LANGUAGE_ALIASES["jsx"]).toBe("javascript");
    expect(LANGUAGE_ALIASES["ts"]).toBe("typescript");
    expect(LANGUAGE_ALIASES["tsx"]).toBe("typescript");
    expect(LANGUAGE_ALIASES["py"]).toBe("python");
    expect(LANGUAGE_ALIASES["sh"]).toBe("bash");
    expect(LANGUAGE_ALIASES["zsh"]).toBe("bash");
    expect(LANGUAGE_ALIASES["yml"]).toBe("yaml");
    expect(LANGUAGE_ALIASES["md"]).toBe("markdown");
    expect(LANGUAGE_ALIASES["rs"]).toBe("rust");
  });

  it("silently ignores unknown or unsupported languages without throwing", async () => {
    let threw = false;
    try {
      const result = await ensureLanguageLoaded("nonexistent_language_xyz_123");
      expect(result).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("correctly scans code block languages from both TipTap JSON AST and Markdown fences", () => {
    // 1. Markdown content
    const md = `
# Sample Note
\`\`\`ts
const x: number = 42;
\`\`\`
\`\`\`python
def foo():
    pass
\`\`\`
`;
    const mdLangs = scanCodeBlockLanguages(md);
    expect(mdLangs).toContain("ts");
    expect(mdLangs).toContain("python");

    // 2. TipTap JSON content
    const jsonDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "js" },
          content: [{ type: "text", text: "console.log(1);" }],
        },
        {
          type: "codeBlock",
          attrs: { language: "json" },
          content: [{ type: "text", text: '{"key": "value"}' }],
        },
      ],
    };
    const jsonLangs = scanCodeBlockLanguages(jsonDoc);
    expect(jsonLangs).toContain("js");
    expect(jsonLangs).toContain("json");
  });

  it("preloads languages and highlights ts, js, py, and json blocks on first render", async () => {
    const rawNote = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const a: string = 'hello';" }],
        },
        {
          type: "codeBlock",
          attrs: { language: "js" },
          content: [{ type: "text", text: "function add(x, y) { return x + y; }" }],
        },
        {
          type: "codeBlock",
          attrs: { language: "py" },
          content: [{ type: "text", text: "import os\ndef test():\n    return 42" }],
        },
        {
          type: "codeBlock",
          attrs: { language: "json" },
          content: [{ type: "text", text: '{"status": 200}' }],
        },
      ],
    };

    // Preload languages before setContent (as done in Editor.tsx loadAndApplyDoc)
    await preloadLanguagesForContent(rawNote);

    // Verify all 4 are registered in lowlight
    expect(lowlight.registered("typescript") || lowlight.registered("ts")).toBe(true);
    expect(lowlight.registered("javascript") || lowlight.registered("js")).toBe(true);
    expect(lowlight.registered("python") || lowlight.registered("py")).toBe(true);
    expect(lowlight.registered("json")).toBe(true);

    // Create an editor with getExtensions() which includes CodeBlockLowlight
    const editor = new Editor({
      extensions: getExtensions(),
      content: rawNote,
    });

    // Check decorations created on first render
    const lowlightPlugin = editor.state.plugins.find(plugin =>
      String((plugin.spec.key as { key?: string } | undefined)?.key).startsWith("raynoteCodeHighlight")
    );
    expect(lowlightPlugin).toBeDefined();

    const decos = (lowlightPlugin as any)?.getState(editor.state);
    expect(decos).toBeDefined();

    // Verify decorations exist for code block tokens (hljs-keyword, hljs-string, etc.)
    const foundDecos = decos.find();
    expect(foundDecos.length).toBeGreaterThan(0);

    // Verify classes applied by lowlight
    const classNames = foundDecos
      .map((d: any) => d.type?.attrs?.class || "")
      .join(" ");
    expect(classNames).toContain("hljs-");

    editor.destroy();
  });

  it("renders explicitly plain-text blocks without trial-running grammars", () => {
    const auto = vi.spyOn(lowlight, "highlightAuto");
    const editor = new Editor({
      extensions: getExtensions(),
      content: '<pre><code class="language-text">SELECT * FROM notes</code></pre>',
    });
    try {
      expect(editor.view.dom.querySelector("code")?.textContent).toBe("SELECT * FROM notes");
      expect(auto).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
      auto.mockRestore();
    }
  });

  it("refreshes syntax when the same document is loaded after its grammar becomes available", () => {
    const language = "raynote-test-delayed-grammar";
    const content = '<h1>Test</h1><pre><code class="language-' + language + '">queuedkeyword</code></pre>';
    const editor = new Editor({ extensions: getExtensions(), content });
    try {
      expect(editor.view.dom.querySelector(".hljs-keyword")).toBeNull();
      lowlight.register(language, () => ({ keywords: "queuedkeyword", contains: [] }));
      editor.commands.setContent(editor.getJSON());
      expect(editor.view.dom.querySelector(".hljs-keyword")?.textContent).toBe("queuedkeyword");
    } finally {
      editor.destroy();
    }
  });

  it("rehighlights only the edited block and keeps decorations correct through undo, conversion, and paste", async () => {
    await ensureLanguageLoaded("javascript");
    await ensureLanguageLoaded("json");
    const content = '<h1>Test</h1><pre><code class="language-javascript">const first = 1;</code></pre><p>Between</p>' +
      '<blockquote><pre><code class="language-javascript">const second = 2;</code></pre></blockquote>';
    const editor = new Editor({ extensions: getExtensions(), content });
    const spy = vi.spyOn(lowlight, "highlight");
    const compareWithFreshEditor = () => {
      const fresh = new Editor({ extensions: getExtensions(), content: editor.getJSON() });
      try {
        const spans = (instance: Editor) => [...instance.view.dom.querySelectorAll('pre span')]
          .map(span => [span.textContent, span.className]);
        expect(spans(editor)).toEqual(spans(fresh));
      } finally {
        fresh.destroy();
      }
    };
    try {
      const first = editor.state.doc.firstChild!.nodeSize;
      editor.commands.insertContentAt(first + 1, "// comment\n");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("javascript", expect.stringContaining("const first"));
      compareWithFreshEditor();

      expect(editor.commands.undo()).toBe(true);
      compareWithFreshEditor();
      expect(editor.commands.redo()).toBe(true);
      compareWithFreshEditor();
      editor.view.dispatch(editor.state.tr.setNodeMarkup(first, undefined, { language: "json" }));
      compareWithFreshEditor();
      editor.view.dispatch(editor.state.tr.setNodeMarkup(first, editor.schema.nodes.paragraph));
      compareWithFreshEditor();
      editor.commands.insertContentAt(first, {
        type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "return true;" }],
      });
      compareWithFreshEditor();
    } finally {
      spy.mockRestore();
      editor.destroy();
    }
  });

});
