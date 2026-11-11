import { Editor } from "../editor/Editor";
import { FileText, Plus } from "lucide-react";
import { SwitchConflictInfo } from "./SwitchConflictModal";

interface NoteEditorProps {
  noteId: string | null;
  hasNotes?: boolean;
  onNewNote?: () => void;
  content?: string | null;
  noteTitle?: string;
  onSetTitle?: (title: string) => void;
  onUpdate: (id: string, content: string, titleHint?: string) => Promise<string | void> | string | void;
  onRecoverOrphan?: (content: string) => void;
  onSwitchFailed?: (failedId: string, error: unknown) => void;
  onSwitchConflict?: (info: SwitchConflictInfo) => void;
  discardedNoteId?: string | null;
  zoomLevel: number;
  isFindOpen?: boolean;
  onCloseFind?: () => void;
}

export function NoteEditor({
  noteId,
  hasNotes,
  onNewNote,
  content,
  noteTitle,
  onSetTitle,
  onUpdate,
  onRecoverOrphan,
  onSwitchFailed,
  onSwitchConflict,
  discardedNoteId,
  zoomLevel,
  isFindOpen,
  onCloseFind,
}: NoteEditorProps) {
  if (!noteId) {
    const emptyLibrary = hasNotes === false;
    return (
      <div className="note-empty-state flex flex-1 min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden">
        <div className="note-empty-content flex w-full max-w-xs shrink-0 flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[var(--btn-liquid-bg)] border border-[var(--btn-liquid-border)] flex items-center justify-center">
            <FileText aria-hidden="true" size={22} className="text-[var(--text-muted)]" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-[var(--text-primary)] text-[16px] font-semibold">
              {emptyLibrary ? "Your notes start here" : "No note open"}
            </h1>
            <p className="text-[var(--text-muted)] text-[12px]">
              {emptyLibrary ? "Create your first note to get started." : "Open an existing note or create a new one."}
            </p>
          </div>
          {onNewNote && (
            <button type="button" className="liquid-btn note-empty-create gap-1.5 text-[13px] font-medium" onClick={onNewNote}>
              <Plus aria-hidden="true" size={14} />
              New note
            </button>
          )}
          <p className="flex flex-wrap items-center justify-center gap-1.5 text-[var(--text-muted)] text-[11px]">
            <span>Or press</span>
            <kbd className="note-empty-shortcut whitespace-nowrap text-[var(--text-primary)]">⌘ N</kbd>
          </p>
        </div>
      </div>
    );
  }

  // Notice: No key={noteId}! The Editor component stays permanently mounted.
  // Note switching happens in place via document replacement, eliminating unmount/remount flicker.
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <Editor
        noteId={noteId}
        noteTitle={noteTitle}
        onSetTitle={onSetTitle}
        initialContent={content || ""}
        onUpdate={onUpdate}
        onRecoverOrphan={onRecoverOrphan}
        onSwitchFailed={onSwitchFailed}
        onSwitchConflict={onSwitchConflict}
        discardedNoteId={discardedNoteId}
        zoomLevel={zoomLevel}
        isFindOpen={isFindOpen}
        onCloseFind={onCloseFind}
      />
    </div>
  );
}
