import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, RotateCcw, Search, Trash2, X } from "lucide-react";
import { nextMenuIndex, revealMenuItem } from "../lib/menuNavigation";
import { normalizeQuery } from "../lib/searchRanking";
import { TrashConfirmation } from "./MoveToTrashDialog";
import { Toast, type ToastData } from "./Toast";
import {
  listTrashedNotes,
  purgeTrashedNote,
  purgeTrashedNotes,
  restoreAllTrashedNotes,
  restoreTrashedNote,
  type TrashedNoteSummary,
} from "../lib/db";

type TrashTarget = TrashedNoteSummary | { ids: string[] };

interface TrashDialogProps {
  onClose: () => void;
  onRestored: () => Promise<void>;
  onShowToast: (message: string, icon: React.ReactNode) => void;
  toast: ToastData | null;
}

export function TrashDialog({ onClose, onRestored, onShowToast, toast }: TrashDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<TrashedNoteSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<TrashTarget | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    searchRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const titles = useMemo(() => notes?.map((note) => ({
    note,
    words: normalizeQuery(note.title || "Untitled Note").split(" "),
  })), [notes]);
  const searchQuery = query.trim();
  const terms = normalizeQuery(searchQuery).split(" ").filter(Boolean);
  const results = searchQuery
    ? (titles ?? []).filter(({ words }) => terms.length > 0 && terms.every((term) => words.some((word) => word.startsWith(term)))).map(({ note }) => note)
    : notes ?? [];
  const selectedIndex = Math.max(0, results.findIndex((note) => note.id === selectedId));

  useEffect(() => {
    let canceled = false;
    listTrashedNotes().then(
      (items) => { if (!canceled) setNotes(items); },
      (cause) => {
        console.error("Could not load Trash:", cause);
        if (!canceled) setLoadFailed(true);
      },
    );
    return () => { canceled = true; };
  }, [loadAttempt]);

  const cancelConfirmation = () => {
    setConfirmation(null);
    setError("");
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const handleEscape = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (working) return;
    if (confirmation) cancelConfirmation();
    else onClose();
  };

  const changeTrash = async (target: TrashTarget, operation: "restore" | "purge") => {
    if (working) return;
    setWorking(true);
    setError("");
    const restoring = operation === "restore";
    const bulk = "ids" in target;
    try {
      let message: string;
      if (bulk) {
        const count = restoring
          ? await restoreAllTrashedNotes()
          : await purgeTrashedNotes(target.ids);
        message = count > 0
          ? `${count} ${count === 1 ? "note" : "notes"} ${restoring ? "restored" : "permanently deleted"}`
          : restoring ? "No notes to restore" : "No notes to delete";
        setQuery("");
        setSelectedId(null);
        setNotes(null);
        // Refresh from SQLite so notes moved to Trash during confirmation still appear.
        setLoadAttempt((attempt) => attempt + 1);
      } else {
        if (restoring) await restoreTrashedNote(target.id);
        else await purgeTrashedNote(target.id);
        setNotes((items) => items?.filter((item) => item.id !== target.id) ?? null);
        message = restoring ? "Note restored" : "Note permanently deleted";
      }
      setConfirmation(null);
      onShowToast(message, restoring ? <Check size={14} /> : <Trash2 size={14} />);
      if (restoring) {
        await onRestored().catch((cause) => {
          console.error("Could not refresh notes after restoring:", cause);
          setError("Restored notes saved. Reopen the note switcher to refresh the list.");
        });
      }
    } catch (cause) {
      console.error("Could not update Trash:", cause);
      if (bulk) setError(restoring ? "Could not restore all notes." : "Could not empty Trash.");
      else setError(restoring ? "Could not restore this note." : "Could not permanently delete this note.");
    } finally {
      setWorking(false);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  };

  const noteActions = (note: TrashedNoteSummary) => {
    const title = note.title || "Untitled Note";
    return (
      <div className="trash-actions">
        <button type="button" disabled={working} aria-label={`Restore ${title}`}
          onClick={() => void changeTrash(note, "restore")}>
          <RotateCcw size={13} aria-hidden="true" /> Restore
        </button>
        <button type="button" disabled={working} className="trash-destructive"
          title="Delete Permanently" aria-label={`Permanently delete ${title}`}
          onClick={() => {
            setError("");
            setConfirmation(note);
          }}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className={confirmation ? "trash-dialog move-trash-dialog" : "trash-dialog"}
      role={confirmation ? "alertdialog" : undefined}
      aria-labelledby={confirmation ? "trash-confirm-title" : "trash-title"}
      aria-describedby={confirmation ? "trash-confirm-description" : undefined}
      onCancel={handleEscape}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          handleEscape(event);
          return;
        }
        if (confirmation || working || !results.length || event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const next = nextMenuIndex(selectedIndex, results.length, event.key === "ArrowDown" ? 1 : -1, event.repeat);
          setSelectedId(results[next].id);
          searchRef.current?.focus();
          if (listRef.current) revealMenuItem(listRef.current, listRef.current.querySelectorAll("li")[next]);
        } else if (event.key === "Enter" && event.target === searchRef.current) {
          event.preventDefault();
          listRef.current?.querySelectorAll("li")[selectedIndex]?.querySelector("button")?.focus();
        }
      }}
      onClick={(event) => {
        if (working || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      {!confirmation && <header className="trash-header">
        <div className="trash-heading">
          <h2 id="trash-title"><Trash2 size={17} aria-hidden="true" />Trash</h2>
          {notes && notes.length > 0 && <span className="trash-count">
            {searchQuery ? `${results.length} of ` : ""}{notes.length} {notes.length === 1 ? "note" : "notes"}
          </span>}
        </div>
        <button type="button" disabled={working} className="trash-close" aria-label="Close Trash" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>}

      {!confirmation && (
        <div className="smart-search-header trash-search">
          <Search className="smart-search-icon" size={15} aria-hidden="true" />
          <input ref={searchRef} className="smart-search-input" type="search" value={query}
            aria-label="Search Trash" disabled={working} placeholder="Search note titles…" spellCheck={false}
            onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }} />
          {query && <button type="button" className="trash-clear-search" disabled={working} aria-label="Clear search"
            onClick={() => { setQuery(""); setSelectedId(null); searchRef.current?.focus(); }}><X size={12} /></button>}
        </div>
      )}

      {confirmation ? (
        <TrashConfirmation
          {...("ids" in confirmation ? { count: confirmation.ids.length } : { title: confirmation.title || "Untitled Note", permanent: true })}
          busy={working} onCancel={cancelConfirmation} onConfirm={() => void changeTrash(confirmation, "purge")} />
      ) : loadFailed ? (
        <div className="trash-empty" role="alert">
          <p>Could not load Trash.</p>
          <button type="button" onClick={() => {
            setLoadFailed(false);
            setLoadAttempt((attempt) => attempt + 1);
          }}>Try Again</button>
        </div>
      ) : !notes ? (
        <div className="trash-initial-placeholder" role="status">
          <span className="sr-only">Loading Trash…</span>
        </div>
      ) : results.length === 0 && searchQuery ? (
        <p className="trash-empty trash-no-results" role="status">No notes match your search.</p>
      ) : results.length === 0 ? (
        <div className="trash-empty-state" role="status">
          <span className="trash-empty-icon" aria-hidden="true"><Trash2 size={32} strokeWidth={1.45} /></span>
          <p>No notes in Trash</p>
        </div>
      ) : (
        <ul ref={listRef} className="trash-list" aria-label="Trashed notes">
          {results.map((note, index) => {
            const title = note.title || "Untitled Note";
            return (
              <li key={note.id} aria-current={index === selectedIndex ? "true" : undefined}
                className={`trash-row smart-search-item${index === selectedIndex ? " is-selected" : ""}`}
                onFocus={() => setSelectedId(note.id)}>
                <div className="trash-note-heading">
                  <span className="smart-search-item-icon"><FileText size={14} aria-hidden="true" /></span>
                  <strong className="smart-search-item-title" title={title}>{title}</strong>
                </div>
                {noteActions(note)}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="trash-feedback trash-error" role="alert">{error}</p>}
      {!confirmation && notes && notes.length > 0 && (
        <footer className="trash-bulk-footer">
          {searchQuery && <span className="trash-count">Applies to all notes</span>}
          <div className="trash-actions trash-bulk-actions">
            <button type="button" disabled={working}
              onClick={() => void changeTrash({ ids: notes.map((note) => note.id) }, "restore")}>
              <RotateCcw size={14} aria-hidden="true" /> Restore All
            </button>
            <button type="button" disabled={working} className="trash-destructive"
              onClick={() => { setError(""); setConfirmation({ ids: notes.map((note) => note.id) }); }}>
              <Trash2 size={14} aria-hidden="true" /> Empty Trash
            </button>
          </div>
        </footer>
      )}
      <Toast toast={toast} aboveModal />
    </dialog>
  );
}
