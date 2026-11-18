import { describe, it, expect, vi } from "vitest";
import {
  isSafeUrl,
  normalizeUrl,
  isInternalNoteUrl,
  extractNoteIdFromUrl,
  createInternalNoteUrl,
  safeOpenUrl,
  getFriendlyUrlLabel,
} from "../linkUtils";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

describe("linkUtils URL Security & Validation", () => {
  it("allows standard http and https URLs", () => {
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("https://example.com/path?query=1#frag")).toBe(true);
    expect(isSafeUrl("https://sub.domain.org/nested/resource")).toBe(true);
    expect(isSafeUrl("https://tiptap.dev")).toBe(true);
  });

  it("allows bare domains and www prefixes", () => {
    expect(isSafeUrl("www.example.com")).toBe(true);
    expect(isSafeUrl("example.com")).toBe(true);
    expect(isSafeUrl("tiptap.dev/docs")).toBe(true);
  });

  it("allows mailto: and tel: schemes", () => {
    expect(isSafeUrl("mailto:user@example.com")).toBe(true);
    expect(isSafeUrl("tel:+1234567890")).toBe(true);
  });

  it("allows internal raynote:// and notefast:// note URLs", () => {
    expect(isSafeUrl("raynote://note/123-abc")).toBe(true);
    expect(isSafeUrl("notefast://note/456-def")).toBe(true);
  });

  it("strictly rejects dangerous and unsafe URL schemes", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JAVASCRIPT:alert(document.cookie)")).toBe(false);
    expect(isSafeUrl("javascript: void(0)")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeUrl("about:blank")).toBe(false);
    expect(isSafeUrl("blob:https://example.com/uuid")).toBe(false);
  });

  it("rejects control characters, newlines, and null bytes", () => {
    expect(isSafeUrl("https://example.com/\x00evil")).toBe(false);
    expect(isSafeUrl("https://example.com/\nnewline")).toBe(false);
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl("   ")).toBe(false);
  });

  it("normalizes bare URLs by prepending https://", () => {
    expect(normalizeUrl("www.example.com")).toBe("https://www.example.com");
    expect(normalizeUrl("tiptap.dev")).toBe("https://tiptap.dev");
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
    expect(normalizeUrl("raynote://note/abc-123")).toBe("raynote://note/abc-123");
  });

  it("extracts and formats internal note URLs correctly", () => {
    const url = createInternalNoteUrl("note-xyz-789");
    expect(url).toBe("raynote://note/note-xyz-789");
    expect(isInternalNoteUrl(url)).toBe(true);
    expect(extractNoteIdFromUrl(url)).toBe("note-xyz-789");
  });

  it("routes internal note navigation to callback without external launch", async () => {
    const onNavigateNote = vi.fn();
    const result = await safeOpenUrl("raynote://note/target-uuid-123", { onNavigateNote });

    expect(result).toBe(true);
    expect(onNavigateNote).toHaveBeenCalledWith("target-uuid-123");
  });

  it("blocks navigation for unsafe links", async () => {
    const result = await safeOpenUrl("javascript:alert(1)");
    expect(result).toBe(false);
  });

  it("generates friendly labels for URLs", () => {
    expect(getFriendlyUrlLabel("https://github.com/facebook/react")).toBe("github.com/facebook/react");
    expect(getFriendlyUrlLabel("raynote://note/uuid")).toBe("Internal Note");
  });
});
