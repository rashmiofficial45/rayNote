// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
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
    const plugins = editor.state.plugins;
    const lowlightPlugin = plugins.find((p: any) =>
      p.key?.includes("lowlight") ||
      p.spec?.key?.key?.includes("lowlight") ||
      p.spec?.key === "lowlight"
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
});
