import { useState } from "react";
import { Copy, FilePlus, Trash2, X, Check } from "lucide-react";

export interface SwitchConflictInfo {
  failedNoteId: string;
  targetNoteId?: string | null;
  content: string;
  text: string;
}

interface SwitchConflictModalProps {
  conflict: SwitchConflictInfo | null;
  onSaveAsNewNote: () => Promise<void> | void;
  onCopyText: () => boolean | void | Promise<boolean | void>;
  onDiscardAndSwitch: () => void;
  onClose: () => void;
}

export function SwitchConflictModal({
  conflict,
  onSaveAsNewNote,
  onCopyText,
  onDiscardAndSwitch,
  onClose,
}: SwitchConflictModalProps) {
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  if (!conflict) return null;

  const handleCopy = async () => {
    try {
      const success = await onCopyText();
      setCopied(success === true);
      if (success === true) setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };

  const handleSaveAsNew = async () => {
    setIsSaving(true);
    try {
      await onSaveAsNewNote();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="command-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
    >
      <div
        className="max-w-md w-full p-6 rounded-2xl bg-[var(--modal-bg)] border border-[var(--modal-border)] shadow-[var(--modal-shadow)] text-[var(--text-primary)] flex flex-col gap-5 overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] border border-[var(--color-accent-border)] flex-shrink-0">
              <FilePlus size={18} />
            </div>
            <div>
              <h2 id="conflict-dialog-title" className="text-sm font-semibold">
                Unable to Save Note
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Saving failed or autosave was paused. Choose an option to prevent text loss.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-liquid-bg-hover)] transition-colors"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5">
          <button
            onClick={handleSaveAsNew}
            disabled={isSaving}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-full bg-[var(--color-accent)] text-white text-xs font-semibold hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <div className="flex items-center gap-2">
              <FilePlus size={15} />
              <span>{isSaving ? "Saving..." : "Save as new note"}</span>
            </div>
            <span className="text-[10px] opacity-80">Creates new document</span>
          </button>

          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-full bg-[var(--btn-liquid-bg)] hover:bg-[var(--btn-liquid-bg-hover)] text-xs font-medium text-[var(--text-primary)] border border-[var(--btn-liquid-border)] shadow-[var(--btn-liquid-shadow)] transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
              <span>{copied ? "Copied to clipboard!" : "Copy text"}</span>
            </div>
            <span className="text-[10px] text-[var(--text-muted)]">Copy markdown</span>
          </button>

          <button
            onClick={onDiscardAndSwitch}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-xs font-medium text-red-500 border border-red-500/25 transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Trash2 size={15} />
              <span>Discard and switch</span>
            </div>
            <span className="text-[10px] opacity-75">Abandon unsaved edits</span>
          </button>
        </div>
      </div>
    </div>
  );
}
