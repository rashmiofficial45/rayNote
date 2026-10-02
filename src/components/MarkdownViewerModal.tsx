import { useState, useMemo } from "react";
import {
  FileText,
  X,
  Plus,
  Copy,
  Check,
  Eye,
  Code2,
  FileCheck,
} from "lucide-react";
import { markdownToTipTapHtml } from "../editor/markdownUtils";

export interface PreviewFileData {
  name: string;
  content: string;
  size?: number;
}

interface MarkdownViewerModalProps {
  fileData: PreviewFileData | null;
  onClose: () => void;
  onImportToNotes: (title: string, markdown: string) => void;
  onShowToast?: (message: string, icon?: React.ReactNode) => void;
}

export function MarkdownViewerModal({
  fileData,
  onClose,
  onImportToNotes,
  onShowToast,
}: MarkdownViewerModalProps) {
  const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
  const [copied, setCopied] = useState(false);

  const stats = useMemo(() => {
    if (!fileData?.content) return { words: 0, chars: 0, lines: 0 };
    const text = fileData.content;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const lines = text.split("\n").length;
    return { words, chars, lines };
  }, [fileData?.content]);

  const renderedHtml = useMemo(() => {
    if (!fileData?.content) return "";
    return markdownToTipTapHtml(fileData.content);
  }, [fileData?.content]);

  if (!fileData) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(fileData.content).then(() => {
      setCopied(true);
      onShowToast?.("Copied Markdown content to clipboard", <Check size={14} />);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleImport = () => {
    // Extract title from first heading or fallback to file name
    const lines = fileData.content.split("\n");
    let title = fileData.name.replace(/\.(md|markdown|txt)$/i, "");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ")) {
        title = trimmed.replace(/^#+\s*/, "").trim();
        break;
      }
    }

    onImportToNotes(title, fileData.content);
    onClose();
  };

  return (
    <div className="command-overlay" onClick={onClose}>
      <div
        className="md-viewer-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="md-viewer-header">
          <div className="md-viewer-title-group">
            <div className="md-viewer-file-icon">
              <FileText size={16} />
            </div>
            <div className="md-viewer-title-info">
              <div className="flex items-center gap-2">
                <span className="md-viewer-filename">{fileData.name}</span>
                <span className="md-viewer-badge">View Only • Not Uploaded</span>
              </div>
              <span className="md-viewer-subtitle">
                {stats.words.toLocaleString()} words • {stats.chars.toLocaleString()} chars • {stats.lines} lines
              </span>
            </div>
          </div>

          <div className="md-viewer-actions">
            {/* View Mode Switcher */}
            <div className="md-viewer-toggle-group">
              <button
                type="button"
                className={`md-viewer-toggle-btn ${viewMode === "rendered" ? "is-active" : ""}`}
                onClick={() => setViewMode("rendered")}
                title="Rendered Markdown Preview"
              >
                <Eye size={12} />
                <span>Preview</span>
              </button>
              <button
                type="button"
                className={`md-viewer-toggle-btn ${viewMode === "raw" ? "is-active" : ""}`}
                onClick={() => setViewMode("raw")}
                title="Raw Markdown Code"
              >
                <Code2 size={12} />
                <span>Raw</span>
              </button>
            </div>

            {/* Copy Button */}
            <button
              type="button"
              className="md-viewer-btn liquid-btn"
              onClick={handleCopy}
              title="Copy Markdown"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>

            {/* Import Button */}
            <button
              type="button"
              className="md-viewer-btn md-viewer-btn-primary liquid-btn"
              onClick={handleImport}
              title="Save this file permanently into your local NoteFast SQLite notes"
            >
              <Plus size={13} />
              <span>Import to Notes</span>
            </button>

            {/* Close Button */}
            <button
              type="button"
              className="md-viewer-close-btn liquid-btn"
              onClick={onClose}
              title="Close Preview (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="md-viewer-body">
          {viewMode === "rendered" ? (
            <div
              className="tiptap md-viewer-rendered"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <pre className="md-viewer-raw">
              <code>{fileData.content}</code>
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="md-viewer-footer">
          <span className="flex items-center gap-1.5 text-[var(--text-muted)] text-[11px]">
            <FileCheck size={12} />
            <span>Viewing local file strictly in-memory. Zero changes made to local SQLite database.</span>
          </span>
          <button
            type="button"
            className="md-viewer-import-link"
            onClick={handleImport}
          >
            Want to keep this? Click to import as an editable note →
          </button>
        </div>
      </div>
    </div>
  );
}
