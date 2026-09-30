import { Editor } from "../editor/Editor";
import { Note } from "../lib/db";
import { FileText } from "lucide-react";

interface NoteEditorProps {
  note: Note | null;
  onUpdate: (content: string, titleHint?: string) => void;
  zoomLevel: number;
  isFindOpen?: boolean;
  onCloseFind?: () => void;
}

export function NoteEditor({
  note,
  onUpdate,
  zoomLevel,
  isFindOpen,
  onCloseFind,
}: NoteEditorProps) {
  if (!note) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center">
          <FileText size={22} className="text-white/15" />
        </div>
        <div className="text-center">
          <p className="text-white/20 text-[13px]">No note selected</p>
          <p className="text-white/10 text-[11px] mt-1">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/40 text-[10px]">⌘N</kbd> to create a new note
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <Editor
        key={note.id}
        noteId={note.id}
        content={note.content}
        onUpdate={onUpdate}
        zoomLevel={zoomLevel}
        isFindOpen={isFindOpen}
        onCloseFind={onCloseFind}
      />
    </div>
  );
}
