import { invoke } from "@tauri-apps/api/core";

/**
 * Copies text to clipboard with a 3-layer robust fallback chain for macOS Tauri WebView:
 * Layer 1: navigator.clipboard.writeText (Modern async clipboard API)
 * Layer 2: Tauri native invoke("write_to_clipboard", { text }) (pbcopy process on macOS)
 * Layer 3: document.execCommand('copy') (legacy synchronous clipboard fallback)
 *
 * Returns true if copied successfully via any layer, false otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Layer 1: Modern async clipboard API
  if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn("[clipboard] navigator.clipboard.writeText failed, trying Tauri pbcopy fallback:", err);
    }
  }

  // Layer 2: Native Tauri backend command (macOS pbcopy)
  try {
    await invoke("write_to_clipboard", { text });
    return true;
  } catch (err) {
    console.warn("[clipboard] invoke('write_to_clipboard') failed, trying execCommand fallback:", err);
  }

  // Layer 3: document.execCommand fallback
  if (typeof document !== "undefined") {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // Prevent scrolling to bottom of screen in iOS / Safari / WebKit
      textArea.style.position = "fixed";
      textArea.style.top = "-9999px";
      textArea.style.left = "-9999px";
      textArea.setAttribute("aria-hidden", "true");
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (successful) return true;
    } catch (err) {
      console.error("[clipboard] document.execCommand('copy') failed:", err);
    }
  }

  return false;
}
