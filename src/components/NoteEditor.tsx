import { Editor } from "../editor/Editor";
import { FileText } from "lucide-react";

interface NoteEditorProps {
  noteId: string | null;
  content: string | null;
  onUpdate: (content: string, titleHint?: string) => void;
  zoomLevel: number;
  isFindOpen?: boolean;
  onCloseFind?: () => void;
}

export function NoteEditor({
  noteId,
  content,
  onUpdate,
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
        initialContent={content || ""}
        onUpdate={onUpdate}
        zoomLevel={zoomLevel}
        isFindOpen={isFindOpen}
        onCloseFind={onCloseFind}
      />
    </div>
  );
}
