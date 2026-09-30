import { Note } from "../lib/db";
import { formatDate, getNoteTitle, getPreviewText } from "../lib/utils";
import { Pin, Trash2, Search } from "lucide-react";
import { useState } from "react";

interface NoteListProps {
  notes: Note[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onTogglePin: (id: string) => void;
}

export function NoteList({
  notes,
  activeNoteId,
  onSelectNote,
  onDeleteNote,
  onTogglePin,
}: NoteListProps) {
  const [search, setSearch] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filteredNotes = notes.filter((note) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const title = getNoteTitle(note.title, note.content).toLowerCase();
    const preview = getPreviewText(note.content).toLowerCase();
    return title.includes(q) || preview.includes(q);
  });

  return (
    <div className="flex flex-col h-full bg-[rgba(22,22,22,0.98)]">
      {/* Search */}
      <div className="px-3 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.04] rounded-lg border border-white/[0.06] focus-within:border-[#6C5CE7]/40 transition-colors">
          <Search size={13} className="text-white/25 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-[13px] text-white/80 placeholder:text-white/20 w-full"
          />
        </div>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {filteredNotes.length === 0 && (
          <div className="text-center py-8">
            <p className="text-white/20 text-xs">
              {search ? "No notes found" : "No notes yet"}
            </p>
          </div>
        )}

        {filteredNotes.map((note) => (
          <div
            key={note.id}
            className={`group relative px-3 py-2.5 rounded-lg mb-0.5 cursor-pointer transition-all duration-100
              ${
                activeNoteId === note.id
                  ? "bg-[#6C5CE7]/15 border border-[#6C5CE7]/20"
                  : "border border-transparent hover:bg-white/[0.04]"
              }`}
            onClick={() => onSelectNote(note.id)}
            onMouseEnter={() => setHoveredId(note.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {note.is_pinned && (
                    <Pin
                      size={10}
                      className="text-[#6C5CE7] flex-shrink-0 fill-current"
                    />
                  )}
                  <h3 className="text-[13px] font-medium text-white/80 truncate leading-tight">
                    {getNoteTitle(note.title, note.content)}
                  </h3>
                </div>
                <p className="text-[11px] text-white/25 mt-1 truncate leading-tight">
                  {getPreviewText(note.content)}
                </p>
                <span className="text-[10px] text-white/15 mt-1 block">
                  {formatDate(note.updated_at)}
                </span>
              </div>

              {/* Actions */}
              {hoveredId === note.id && (
                <div className="flex items-center gap-0.5 flex-shrink-0 animate-fade-in">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(note.id);
                    }}
                    className={`w-6 h-6 flex items-center justify-center rounded hover:bg-white/[0.08] transition-colors
                      ${
                        note.is_pinned
                          ? "text-[#6C5CE7]"
                          : "text-white/30 hover:text-white/60"
                      }`}
                    title={note.is_pinned ? "Unpin" : "Pin"}
                  >
                    <Pin size={11} className={note.is_pinned ? "fill-current" : ""} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteNote(note.id);
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
