import { NoteSummary } from "../lib/db";
import { formatDate, getNoteTitle } from "../lib/utils";
import { Pin, Trash2, Search } from "lucide-react";
import { useState } from "react";

interface NoteListProps {
  notes: NoteSummary[];
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
    const title = getNoteTitle(note.title, note.preview).toLowerCase();
    const preview = (note.preview || "").toLowerCase();
    return title.includes(q) || preview.includes(q);
  });

  return (
    <div className="flex flex-col h-full bg-[var(--app-bg-glass)]">
      {/* Search */}
      <div className="px-3 py-2.5 border-b border-[var(--separator)]">
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--btn-liquid-bg)] rounded-xl border border-[var(--btn-liquid-border)] focus-within:border-[var(--color-accent)] transition-colors">
          <Search size={13} className="text-[var(--text-muted)] flex-shrink-0" />
          <input
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-[13px] text-[var(--text-primary)] placeholder:text-[var(--placeholder)] w-full"
          />
        </div>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {filteredNotes.length === 0 && (
          <div className="text-center py-8">
            <p className="text-[var(--text-muted)] text-xs">
              {search ? "No notes found" : "No notes yet"}
            </p>
          </div>
        )}

        {filteredNotes.map((note) => (
          <div
            key={note.id}
            className={`group relative px-3 py-2.5 rounded-xl mb-0.5 cursor-pointer transition-all duration-100
              ${
                activeNoteId === note.id
                  ? "bg-[var(--color-accent-muted)] border border-[var(--color-accent)]"
                  : "border border-transparent hover:bg-[var(--btn-liquid-bg-hover)]"
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
                      className="text-[var(--color-accent)] flex-shrink-0 fill-current"
                    />
                  )}
                  <h3 className="text-[13px] font-medium text-[var(--text-primary)] truncate leading-tight">
                    {getNoteTitle(note.title, note.preview)}
                  </h3>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate leading-tight">
                  {note.preview || "New note"}
                </p>
                <span className="text-[10px] text-[var(--text-subtle)] mt-1 block">
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
                    className={`w-6 h-6 flex items-center justify-center rounded-full hover:bg-[var(--btn-liquid-bg)] transition-colors
                      ${
                        note.is_pinned
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
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
                    className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
