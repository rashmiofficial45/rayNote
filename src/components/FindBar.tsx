import { useState, useEffect, useRef } from "react";
import { Editor, useEditorState } from "@tiptap/react";
import { Search, ChevronUp, ChevronDown, X, Replace, ArrowRight } from "lucide-react";
import type { SearchStorage } from "../editor/searchExtension";

interface FindBarProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
}

export function FindBar({ isOpen, onClose, editor }: FindBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const findBarRef = useRef<HTMLDivElement>(null);

  // Subscribed via useEditorState so match count and current index update automatically on doc edits & rescans
  const searchState = useEditorState({
    editor,
    selector: (ctx) => {
      const ed = ctx.editor;
      const searchStorage = (ed?.storage as { search?: SearchStorage })?.search;
      return {
        matchCount: searchStorage?.results?.length || 0,
        currentIndex: searchStorage?.currentIndex || 0,
      };
    },
  });

  const matchCount = searchState?.matchCount ?? 0;
  const currentIndex = searchState?.currentIndex ?? 0;

  // Handle opening
  useEffect(() => {
    if (isOpen && editor) {
      const { from, to } = editor.state.selection;
      let effectiveQuery = query;
      if (from !== to) {
        const text = editor.state.doc.textBetween(from, to).trim();
        if (text && text.length < 60 && !text.includes("\n")) {
          setQuery(text);
          effectiveQuery = text;
        }
      }
      editor.commands.setSearchTerm(effectiveQuery);
      const focusTimer = setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);
      return () => clearTimeout(focusTimer);
    } else if (!isOpen && editor) {
      editor.commands.clearSearch();
    }
  }, [isOpen, editor]);

  const handleSearchChange = (val: string) => {
    setQuery(val);
    if (!editor) return;
    editor.commands.setSearchTerm(val);
  };

  const navigateMatch = (direction: "next" | "previous") => {
    if (!editor || matchCount === 0) return;
    const moved = direction === "next"
      ? editor.commands.nextSearchResult()
      : editor.commands.previousSearchResult();
    if (!moved) return;

    // ProseMirror ignores scrollIntoView while the search input owns DOM focus.
    const search = (editor.storage as { search?: SearchStorage }).search;
    const match = search?.results[search.currentIndex];
    const bar = findBarRef.current;
    const viewport = editor.view.dom.closest<HTMLElement>("[data-scroll-container]");
    if (!match || !bar || !viewport) return;

    const bounds = viewport.getBoundingClientRect();
    const top = Math.max(bounds.top, bar.getBoundingClientRect().bottom) + 8;
    const scrim = viewport.parentElement?.querySelector(":scope > .app-bottom-blend");
    const bottom = Math.min(bounds.bottom, scrim?.getBoundingClientRect().top ?? bounds.bottom) - 8;
    if (bottom <= top) return;

    const target = editor.view.coordsAtPos(match.from);
    if (target.top < top || target.bottom > bottom) {
      viewport.scrollTop += (target.top + target.bottom - top - bottom) / 2;
    }
  };
  const handleNext = () => navigateMatch("next");
  const handlePrevious = () => navigateMatch("previous");

  const handleReplaceCurrent = () => {
    if (!editor || matchCount === 0) return;
    editor.commands.replaceCurrentResult(replacement);
  };

  const handleReplaceAll = () => {
    if (!editor || matchCount === 0) return;
    editor.commands.replaceAllResults(replacement);
  };

  const handleClose = () => {
    if (editor) {
      (editor.commands as any).clearSearch();
      editor.commands.focus();
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevious();
      } else {
        handleNext();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div ref={findBarRef} className="find-bar-container" onKeyDown={handleKeyDown}>
      {/* Search row */}
      <div className="find-bar-row">
        <Search size={14} className="find-bar-icon" />
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Find in note…"
          className="find-bar-input"
        />

        {query.trim() && (
          <span className="find-bar-counter text-[10.5px] [font-weight:500] text-[color:var(--text-muted)]">
            {matchCount > 0 ? `${currentIndex + 1} of ${matchCount}` : "0 matches"}
          </span>
        )}

        <div className="find-bar-actions">
          <button
            type="button"
            className="find-bar-btn"
            onClick={handlePrevious}
            disabled={matchCount === 0}
            title="Previous Match (Shift+Enter)"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            className="find-bar-btn"
            onClick={handleNext}
            disabled={matchCount === 0}
            title="Next Match (Enter)"
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            className={`find-bar-btn ${showReplace ? "is-active" : ""}`}
            onClick={() => setShowReplace((prev) => !prev)}
            title="Toggle Replace"
          >
            <Replace size={13} />
          </button>
          <button
            type="button"
            className="find-bar-btn close"
            onClick={handleClose}
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="find-bar-row replace-row">
          <ArrowRight size={13} className="find-bar-icon" />
          <input
            ref={replaceInputRef}
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                handleReplaceCurrent();
              }
            }}
            placeholder="Replace with…"
            className="find-bar-input"
          />
          <div className="find-bar-actions">
            <button
              type="button"
              className="find-replace-action-btn"
              onClick={handleReplaceCurrent}
              disabled={matchCount === 0}
            >
              Replace
            </button>
            <button
              type="button"
              className="find-replace-action-btn"
              onClick={handleReplaceAll}
              disabled={matchCount === 0}
            >
              All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
