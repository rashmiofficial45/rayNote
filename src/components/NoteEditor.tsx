import { Editor } from "../editor/Editor";
import { FileText } from "lucide-react";
import { SwitchConflictInfo } from "./SwitchConflictModal";

interface NoteEditorProps {
  noteId: string | null;
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
  // Only render placeholder when no note is selected at all (e.g. 0 notes in library)
  if (!noteId) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-[var(--btn-liquid-bg)] border border-[var(--btn-liquid-border)] flex items-center justify-center">
          <FileText size={22} className="text-[var(--text-muted)]" />
        </div>
        <div className="text-center">
          <p className="text-[var(--text-secondary)] text-[13px] font-medium">
            No note selected
          </p>
          <p className="text-[var(--text-muted)] text-[11px] mt-1">
            Press <kbd className="px-1.5 py-0.5 rounded-full bg-[var(--btn-liquid-bg)] border border-[var(--btn-liquid-border)] text-[var(--text-primary)] text-[10px]">⌘N</kbd> to create a new note
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
