import { useState, useMemo } from "react";
import {
  FileText,
  X,
  Plus,
  Copy,
  Check,
  Eye,
  Code2,
  HardDriveDownload,
  ShieldCheck,
} from "lucide-react";
import { markdownToTipTapHtml } from "../editor/markdownUtils";
import { extractTitleFromMarkdown } from "../lib/utils";

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
    const lines = text.split(/\r?\n/).length;
    return { words, chars, lines };
  }, [fileData?.content]);

  const renderedHtml = useMemo(() => {
    if (!fileData?.content) return "";
    return markdownToTipTapHtml(fileData.content);
  }, [fileData?.content]);

  const docTitle = useMemo(() => {
    if (!fileData) return "Untitled";
    return extractTitleFromMarkdown(fileData.content, fileData.name);
  }, [fileData]);

  if (!fileData) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(fileData.content).then(() => {
      setCopied(true);
      onShowToast?.("Copied Markdown content to clipboard", <Check size={14} />);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleImport = () => {
    onImportToNotes(docTitle, fileData.content);
    onClose();
  };

  return (
    <div className="command-overlay" onClick={onClose}>
      <div
        className="md-viewer-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="md-viewer-heading"
      >
        {/* Tier 1: Main Header (Document identity, badge, close button) */}
        <div className="md-viewer-topbar">
          <div className="md-viewer-header-left">
            <div className="md-viewer-icon-wrapper">
              <FileText size={18} className="text-[#6C5CE7]" />
            </div>

            <div className="md-viewer-title-box">
              <div className="md-viewer-title-row">
                <h2 id="md-viewer-heading" className="md-viewer-title" title={docTitle}>
                  {docTitle}
                </h2>
                <div className="md-viewer-status-badge">
                  <span className="md-viewer-status-dot" />
                  <span>Preview Only</span>
                </div>
              </div>
              <p className="md-viewer-meta-text" title={fileData.name}>
                <span>{fileData.name}</span>
                <span className="meta-separator">•</span>
                <span>In-Memory</span>
              </p>
            </div>
          </div>

          <div className="md-viewer-header-right">
            <button
              type="button"
              className="md-viewer-close-btn"
              onClick={onClose}
              title="Close Preview (Esc)"
              aria-label="Close Preview"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Tier 2: Action Toolbar (View switch, stats, primary actions) */}
        <div className="md-viewer-toolbar">
          <div className="md-viewer-toolbar-left">
            {/* View Mode Segmented Control */}
            <div className="md-viewer-segmented-control">
              <button
                type="button"
                className={`md-viewer-segment ${viewMode === "rendered" ? "is-active" : ""}`}
                onClick={() => setViewMode("rendered")}
                title="Rendered Markdown Preview"
              >
                <Eye size={13} />
                <span>Preview</span>
              </button>
              <button
                type="button"
                className={`md-viewer-segment ${viewMode === "raw" ? "is-active" : ""}`}
                onClick={() => setViewMode("raw")}
                title="Raw Markdown Code"
              >
                <Code2 size={13} />
                <span>Raw</span>
              </button>
            </div>

            {/* Document Statistics Pill */}
            <div className="md-viewer-stats-pill">
              <span>{stats.words.toLocaleString()} words</span>
              <span className="stats-dot">•</span>
              <span>{stats.lines.toLocaleString()} lines</span>
            </div>
          </div>

          <div className="md-viewer-toolbar-right">
            {/* Copy Button */}
            <button
              type="button"
              className="md-viewer-btn md-viewer-copy-btn"
              onClick={handleCopy}
              title="Copy Markdown content to clipboard"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>

            {/* Import to Notes Button */}
            <button
              type="button"
              className="md-viewer-btn md-viewer-import-btn"
              onClick={handleImport}
              title="Save this document permanently into your NoteFast notes database"
            >
              <Plus size={14} />
              <span>Import to Notes</span>
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
          <div className="md-viewer-footer-info">
            <ShieldCheck size={13} className="text-emerald-400 flex-shrink-0" />
            <span>Viewing strictly in memory. Your SQLite database remains untouched.</span>
          </div>

          <button
            type="button"
            className="md-viewer-footer-cta"
            onClick={handleImport}
            title="Import note"
          >
            <HardDriveDownload size={13} />
            <span>Want to save this note? Click to import →</span>
          </button>
        </div>
      </div>
    </div>
  );
}
