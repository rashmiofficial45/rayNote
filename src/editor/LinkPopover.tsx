import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Editor } from "@tiptap/core";
import {
  ExternalLink,
  Copy,
  Check,
  Pencil,
  Trash2,
  X,
  FileText,
  Link2,
  ArrowUpRight,
} from "lucide-react";
import {
  isSafeUrl,
  normalizeUrl,
  isInternalNoteUrl,
  safeOpenUrl,
  getFriendlyUrlLabel,
} from "../lib/linkUtils";
import { copyToClipboard } from "../lib/clipboard";

export interface LinkPopoverData {
  text: string;
  href: string;
  from: number;
  to: number;
  anchorEl?: HTMLElement | null;
  clientRect?: DOMRect | null;
  isNew?: boolean;
}

export interface LinkPopoverProps {
  editor: Editor | null;
  isOpen: boolean;
  mode: "preview" | "edit";
  linkData: LinkPopoverData | null;
  onClose: () => void;
  onNavigateNote?: (noteId: string) => void;
  onSwitchToEdit?: () => void;
}

export function LinkPopover({
  editor,
  isOpen,
  mode,
  linkData,
  onClose,
  onNavigateNote,
  onSwitchToEdit,
}: LinkPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const [displayText, setDisplayText] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Synchronize internal form state when linkData or mode changes
  useEffect(() => {
    if (isOpen && linkData) {
      setDisplayText(linkData.text || "");
      setUrl(linkData.href || "");
      setValidationError(null);
      setCopied(false);
    }
  }, [isOpen, linkData, mode]);

  // Focus appropriate input field in edit mode
  useEffect(() => {
    if (isOpen && mode === "edit") {
      const timer = setTimeout(() => {
        if (!linkData?.text && textInputRef.current) {
          textInputRef.current.focus();
          textInputRef.current.select();
        } else if (urlInputRef.current) {
          urlInputRef.current.focus();
          urlInputRef.current.select();
        }
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen, mode, linkData?.text]);

  // Calculate anchored viewport coordinates with screen edge clamping
  useLayoutEffect(() => {
    if (!isOpen || !linkData) return;

    const popover = popoverRef.current;
    if (!popover) return;

    const updatePosition = () => {
      let targetRect = linkData.anchorEl?.getBoundingClientRect() ?? linkData.clientRect;

      if (!targetRect && editor && !editor.isDestroyed) {
        try {
          const from = editor.view.coordsAtPos(linkData.from);
          const to = editor.view.coordsAtPos(linkData.to);
          const left = Math.min(from.left, to.left);
          const top = Math.min(from.top, to.top);
          targetRect = new DOMRect(
            left,
            top,
            Math.max(Math.max(from.right, to.right) - left, 1),
            Math.max(Math.max(from.bottom, to.bottom) - top, 20),
          );
        } catch {
          // The document may have changed since the popover opened.
        }
      }

      const gutter = 12;
      const gap = 8;
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const maxLeft = Math.max(gutter, window.innerWidth - width - gutter);
      const maxTop = Math.max(gutter, window.innerHeight - height - gutter);
      const centeredLeft = targetRect
        ? targetRect.left + (targetRect.width - width) / 2
        : (window.innerWidth - width) / 2;
      const below = targetRect ? targetRect.bottom + gap : (window.innerHeight - height) / 2;
      const above = targetRect ? targetRect.top - height - gap : below;
      const preferredTop = below > maxTop && above >= gutter ? above : below;
      const top = Math.round(Math.max(gutter, Math.min(preferredTop, maxTop)));
      const left = Math.round(Math.max(gutter, Math.min(centeredLeft, maxLeft)));

      setPosition((previous) => previous.top === top && previous.left === left
        ? previous
        : { top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    const observer = new ResizeObserver(updatePosition);
    observer.observe(popover);
    return () => {
      window.removeEventListener("resize", updatePosition);
      observer.disconnect();
    };
  }, [isOpen, mode, linkData, editor]);

  // Dismiss on click outside or window blur
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (e: MouseEvent | TouchEvent) => {
      const popoverEl = popoverRef.current;
      if (popoverEl && !popoverEl.contains(e.target as Node)) {
        // If clicking on the anchor link itself in preview mode, don't double toggle
        if (linkData?.anchorEl && linkData.anchorEl.contains(e.target as Node)) {
          return;
        }
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        editor?.commands.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDownOutside, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", onClose);

    return () => {
      document.removeEventListener("mousedown", handlePointerDownOutside, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [isOpen, onClose, editor, linkData?.anchorEl]);

  // Actions
  const handleOpen = useCallback(async () => {
    if (!linkData?.href) return;
    await safeOpenUrl(linkData.href, { onNavigateNote });
    onClose();
  }, [linkData?.href, onNavigateNote, onClose]);

  const handleCopy = useCallback(async () => {
    if (!linkData?.href) return;
    await copyToClipboard(linkData.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [linkData?.href]);

  const handleRemove = useCallback(() => {
    if (!editor || editor.isDestroyed || !linkData) return;
    // Unset link on the target range
    editor
      .chain()
      .focus()
      .setTextSelection({ from: linkData.from, to: linkData.to })
      .unsetLink()
      .run();
    onClose();
  }, [editor, linkData, onClose]);

  const handleSave = useCallback(() => {
    if (!editor || editor.isDestroyed || !linkData) return;

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      // Empty URL means remove link
      handleRemove();
      return;
    }

    if (!isSafeUrl(trimmedUrl)) {
      setValidationError("Please enter a safe http(s) URL or note link");
      return;
    }

    const normalizedHref = normalizeUrl(trimmedUrl);
    const finalLabel = displayText.trim() || getFriendlyUrlLabel(normalizedHref);

    const { from, to, isNew } = linkData;

    if (isNew || from === to) {
      // Case C: Insert new link text at position
      editor
        .chain()
        .focus()
        .insertContentAt(from, [
          {
            type: "text",
            text: finalLabel,
            marks: [{ type: "link", attrs: { href: normalizedHref } }],
          },
        ])
        .run();
    } else {
      // Case A or B: Updating existing selection or link
      const currentText = editor.state.doc.textBetween(from, to, " ");
      if (finalLabel !== currentText) {
        // Both text and href changed
        editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, [
            {
              type: "text",
              text: finalLabel,
              marks: [{ type: "link", attrs: { href: normalizedHref } }],
            },
          ])
          .run();
      } else {
        // Label unchanged, update only mark href without replacing text nodes
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .setLink({ href: normalizedHref })
          .run();
      }
    }

    onClose();
  }, [editor, linkData, url, displayText, handleRemove, onClose]);

  const handleKeyDownInEdit = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  if (!isOpen || !linkData) return null;

  const isInternal = isInternalNoteUrl(linkData.href);

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={mode === "preview" ? "Link preview" : "Edit link"}
      className="raynote-link-popover absolute z-[10005] select-none"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {mode === "preview" ? (
        /* ── PREVIEW MODE ── */
        <div className="link-preview-glass">
          <div className="link-preview-label">
            {isInternal ? (
              <FileText size={14} className="text-[var(--color-accent)] shrink-0" />
            ) : (
              <ExternalLink size={14} className="text-[var(--text-muted)] shrink-0" />
            )}
            <span
              className="truncate font-medium text-[var(--text-primary)] cursor-pointer hover:underline"
              title={linkData.href}
              onClick={handleOpen}
            >
              {isInternal ? linkData.text || getFriendlyUrlLabel(linkData.href) : linkData.href}
            </span>
          </div>

          <div className="link-preview-actions">
            <button
              type="button"
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg-hover)] transition-colors"
              title={isInternal ? "Go to note" : "Open in browser (Cmd+Click)"}
              onClick={handleOpen}
            >
              <ArrowUpRight size={14} />
            </button>
            <button
              type="button"
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg-hover)] transition-colors"
              title={copied ? "Copied!" : "Copy link URL"}
              onClick={handleCopy}
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
            {onSwitchToEdit && (
              <button
                type="button"
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg-hover)] transition-colors"
                title="Edit link (⌘L)"
                onClick={onSwitchToEdit}
              >
                <Pencil size={14} />
              </button>
            )}
            <button
              type="button"
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--btn-liquid-bg-hover)] transition-colors"
              title="Remove link"
              onClick={handleRemove}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ) : (
        /* ── EDIT / INSERT MODE (Cmd+L) ── */
        <div className="link-editor-glass">
          <div className="link-editor-header">
            <div className="link-editor-title">
              <Link2 size={13} className="text-[var(--color-accent)]" />
              <span>{linkData.isNew ? "Insert Link" : "Edit Link"}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg-hover)]"
              title="Close (Esc)"
            >
              <X size={13} />
            </button>
          </div>

          <div className="link-editor-fields">
            <div className="link-editor-field">
              <label htmlFor="link-display-text" className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Display Text
              </label>
              <input
                ref={textInputRef}
                id="link-display-text"
                type="text"
                value={displayText}
                onChange={(e) => setDisplayText(e.target.value)}
                onKeyDown={handleKeyDownInEdit}
                placeholder="Link text..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--btn-liquid-bg)] border border-[var(--btn-liquid-border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--color-accent)] text-[12px] transition-colors"
              />
            </div>

            <div className="link-editor-field">
              <label htmlFor="link-destination" className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Destination (URL or Note)
              </label>
              <input
                ref={urlInputRef}
                id="link-destination"
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                onKeyDown={handleKeyDownInEdit}
                placeholder="https://example.com"
                className={`w-full px-2.5 py-1.5 rounded-lg bg-[var(--btn-liquid-bg)] border ${
                  validationError ? "border-red-500/70" : "border-[var(--btn-liquid-border)]"
                } text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--color-accent)] text-[12px] transition-colors`}
              />
              {validationError && (
                <span className="text-[10px] text-red-500 mt-0.5">{validationError}</span>
              )}
            </div>
          </div>

          <div className="link-editor-footer">
            {!linkData.isNew ? (
              <button
                type="button"
                onClick={handleRemove}
                data-action="unlink"
                className="px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
              >
                Unlink
              </button>
            ) : (
              <span className="text-[10px] text-[var(--text-muted)]">↵ to apply</span>
            )}

            <div className="link-editor-footer-actions">
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg-hover)] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                data-action="apply"
                className="px-3 py-1 text-[11px] font-medium text-white bg-[var(--color-accent)] hover:opacity-95 rounded-md shadow-sm transition-opacity"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
