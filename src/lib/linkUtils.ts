/**
 * linkUtils.ts - Safe URL Validation, Sanitization, and Link Dispatching for rayNote
 *
 * Responsibilities:
 * - Scheme whitelist validation (http, https, mailto, tel, raynote, notefast).
 * - Reject unsafe schemes: javascript:, data:, file:, vbscript:, etc.
 * - Normalization of raw URLs (e.g. www.example.com -> https://www.example.com).
 * - Identification and generation of internal note links (raynote://note/<id>).
 * - Safe opening via @tauri-apps/plugin-opener with browser fallback.
 * - Zero network calls or external overhead during validation.
 */

import { openUrl } from "@tauri-apps/plugin-opener";

/** Allowed URI schemes for external links */
export const ALLOWED_EXTERNAL_SCHEMES = ["http:", "https:", "mailto:", "tel:"] as const;

/** Allowed internal URI schemes for inter-note navigation */
export const ALLOWED_INTERNAL_SCHEMES = ["raynote:", "notefast:"] as const;

/** Unsafe or dangerous schemes that MUST be strictly blocked */
export const BLOCKED_SCHEMES = [
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "about:",
  "blob:",
] as const;

/**
 * Validates if the given string represents a safe, permissible URL.
 * Rejects control characters, forbidden schemes, and malformed structures.
 */
export function isSafeUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;

  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > 4096) return false;

  // Disallow ASCII control characters, newlines, null bytes
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();

  // Explicit check against dangerous schemes
  for (const blocked of BLOCKED_SCHEMES) {
    if (lower.startsWith(blocked)) return false;
  }

  // Internal note links are safe
  if (isInternalNoteUrl(trimmed)) return true;

  // If protocol-relative (//example.com), treat as valid web target
  if (trimmed.startsWith("//")) return true;

  // Try parsing with URL constructor
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    return ALLOWED_EXTERNAL_SCHEMES.includes(protocol as any);
  } catch {
    // If URL parsing fails, check if it's a domain-like string (e.g. "www.example.com" or "example.com/path")
    if (/^(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:\/.*)?$/i.test(trimmed)) {
      return true;
    }
    return false;
  }
}

/**
 * Normalizes an external or internal URL string for storage and navigation.
 * Prepend https:// to bare domains or www. prefixes if no valid protocol is specified.
 */
export function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  if (isInternalNoteUrl(trimmed)) {
    return trimmed;
  }

  // Handle mailto: and tel:
  if (/^(mailto|tel):/i.test(trimmed)) {
    return trimmed;
  }

  // Handle http:// and https://
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Protocol-relative
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  // Default to https:// for bare web URLs
  return `https://${trimmed}`;
}

/**
 * Checks whether a URL points to an internal rayNote note.
 */
export function isInternalNoteUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const lower = url.trim().toLowerCase();
  return lower.startsWith("raynote://note/") || lower.startsWith("notefast://note/");
}

/**
 * Extracts the note ID from an internal note link.
 * Returns null if not an internal note URL or if ID is missing.
 */
export function extractNoteIdFromUrl(url: string | null | undefined): string | null {
  if (!url || !isInternalNoteUrl(url)) return null;
  const trimmed = url.trim();
  const match = trimmed.match(/^(?:raynote|notefast):\/\/note\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

/**
 * Creates an internal note URL from a note ID.
 */
export function createInternalNoteUrl(noteId: string): string {
  return `raynote://note/${encodeURIComponent(noteId.trim())}`;
}

export interface OpenUrlOptions {
  onNavigateNote?: (noteId: string) => void;
}

/**
 * Safely opens a link:
 * - If internal note: routes to onNavigateNote or dispatches a custom event.
 * - If external URL: validates scheme, then invokes Tauri opener plugin (or browser fallback).
 * - Never interpolates into shell or executes script.
 */
export async function safeOpenUrl(
  url: string,
  options?: OpenUrlOptions
): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) return false;

  // 1. Internal Note Navigation
  if (isInternalNoteUrl(trimmed)) {
    const noteId = extractNoteIdFromUrl(trimmed);
    if (!noteId) return false;

    if (options?.onNavigateNote) {
      options.onNavigateNote(noteId);
      return true;
    }

    // Custom event fallback for global subscribers
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("raynote:navigate-note", {
          detail: { noteId },
          bubbles: true,
        })
      );
      return true;
    }
    return false;
  }

  // 2. Validate Safety
  if (!isSafeUrl(trimmed)) {
    console.warn("[linkUtils] Blocked navigation to unsafe URL:", trimmed);
    return false;
  }

  const normalized = normalizeUrl(trimmed);

  // 3. Open External URL via Tauri Opener Plugin
  try {
    await openUrl(normalized);
    return true;
  } catch (tauriError) {
    console.warn(
      "[linkUtils] Tauri openUrl failed, falling back to window.open:",
      tauriError
    );
    if (typeof window !== "undefined") {
      const opened = window.open(normalized, "_blank", "noopener,noreferrer");
      return opened !== null;
    }
    return false;
  }
}

/**
 * Extracts a friendly display label for a URL if none was provided by the user.
 */
export function getFriendlyUrlLabel(url: string): string {
  const trimmed = url.trim();
  if (isInternalNoteUrl(trimmed)) {
    return "Internal Note";
  }
  try {
    const normalized = normalizeUrl(trimmed);
    const parsed = new URL(normalized);
    let label = parsed.hostname;
    if (parsed.pathname && parsed.pathname !== "/") {
      label += parsed.pathname.length > 20 ? parsed.pathname.slice(0, 20) + "…" : parsed.pathname;
    }
    return label;
  } catch {
    return trimmed.length > 30 ? trimmed.slice(0, 30) + "…" : trimmed;
  }
}
