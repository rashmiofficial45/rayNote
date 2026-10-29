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
  onCopyText: () => void;
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

  const handleCopy = () => {
    onCopyText();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
    >
      <div className="bg-[var(--bg-secondary,#1e1e1e)] border border-[var(--border-color,#333)] rounded-xl shadow-2xl max-w-md w-full overflow-hidden p-6 text-[var(--text-primary,#eee)]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/25 flex-shrink-0">
              <FilePlus size={18} />
            </div>
            <div>
              <h2 id="conflict-dialog-title" className="text-sm font-semibold">
                Unable to Save Note
              </h2>
              <p className="text-xs text-[var(--text-muted,#888)] mt-0.5">
                Saving failed or autosave was paused. Choose an option to prevent text loss.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted,#888)] hover:text-[var(--text-primary,#fff)] hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={handleSaveAsNew}
            disabled={isSaving}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-[var(--accent-color,#3b82f6)] text-white text-xs font-medium hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <div className="flex items-center gap-2">
              <FilePlus size={15} />
              <span>{isSaving ? "Saving..." : "Save as new note"}</span>
            </div>
            <span className="text-[10px] opacity-75">Creates new document</span>
          </button>

          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-[var(--text-primary,#eee)] border border-white/10 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
              <span>{copied ? "Copied to clipboard!" : "Copy text"}</span>
            </div>
            <span className="text-[10px] text-[var(--text-muted,#888)]">Copy markdown</span>
          </button>

          <button
            onClick={onDiscardAndSwitch}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-xs font-medium text-red-400 border border-red-500/20 transition-colors cursor-pointer"
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
