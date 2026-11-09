// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SwitchConflictModal } from "../SwitchConflictModal";
import fs from "node:fs";
import path from "node:path";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Visual Bugs & Theme Consistency Regressions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("SwitchConflictModal uses rayNote modal design tokens and no undefined variables", async () => {
    await act(async () => {
      root.render(
        <SwitchConflictModal
          conflict={{ failedNoteId: "test-note", content: "some text", text: "some text" }}
          onSaveAsNewNote={() => {}}
          onCopyText={() => {}}
          onDiscardAndSwitch={() => {}}
          onClose={() => {}}
        />
      );
    });

    const html = host.innerHTML;
    expect(html).not.toContain("--bg-secondary");
    expect(html).not.toContain("--border-color");
    expect(html).not.toContain("--accent-color");
    expect(html).toContain("command-overlay");
    expect(html).toContain("var(--modal-bg)");
    expect(html).toContain("var(--color-accent)");
  });

  it("Settings window header styles ensure close button is visible and non-draggable", () => {
    const cssPath = path.resolve(__dirname, "../../index.css");
    const css = fs.readFileSync(cssPath, "utf8");

    // Must ensure settings header overrides base title-bar-left opacity
    expect(css).toMatch(/\.settings-header-left\s+\.title-bar-left\s*\{[^}]*opacity:\s*1\s*!important/);
    expect(css).toMatch(/\.settings-header-left\s+\.close-btn-x\s*\{[^}]*-webkit-app-region:\s*no-drag\s*!important/);
  });

  it("Box shadow declarations in index.css contain no malformed duplicate insets", () => {
    const cssPath = path.resolve(__dirname, "../../index.css");
    const css = fs.readFileSync(cssPath, "utf8");

    expect(css).not.toContain("inset 0 1px 1px 0 var(--app-inner-highlight)");
    expect(css).not.toContain("inset 0 1px 0.5px 0 var(--app-inner-highlight)");
  });

  it("Code block language dropdown dot supports light mode contrast", () => {
    const cssPath = path.resolve(__dirname, "../../index.css");
    const css = fs.readFileSync(cssPath, "utf8");

    expect(css).toContain(".light .code-lang-item.is-selected .code-lang-dot");
  });

  it("No hardcoded violet #6C5CE7 in App.tsx loading or drop modals", () => {
    const appPath = path.resolve(__dirname, "../../App.tsx");
    const appTsx = fs.readFileSync(appPath, "utf8");

    expect(appTsx).not.toContain("text-[#6C5CE7]");
    expect(appTsx).not.toContain("border-[#6C5CE7]");
  });
});
