import { useState, useEffect, useRef, useCallback } from "react";
import { Editor } from "@tiptap/react";
import { Search, ChevronUp, ChevronDown, X, Replace, ArrowRight } from "lucide-react";

interface FindBarProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
}

export function FindBar({ isOpen, onClose, editor }: FindBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const updateStats = useCallback(() => {
    if (!editor) return;
    const searchStorage = (editor.storage as any).search;
    if (searchStorage) {
      setMatchCount(searchStorage.results?.length || 0);
      setCurrentIndex(searchStorage.currentIndex || 0);
    }
  }, [editor]);

  // Handle opening
  useEffect(() => {
    if (isOpen && editor) {
      const { from, to } = editor.state.selection;
      if (from !== to) {
        const text = editor.state.doc.textBetween(from, to).trim();
        if (text && text.length < 60 && !text.includes("\n")) {
          setQuery(text);
          (editor.commands as any).setSearchTerm(text);
          setTimeout(() => updateStats(), 20);
        }
      }
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);
    } else if (!isOpen && editor) {
      (editor.commands as any).clearSearch();
    }
  }, [isOpen, editor, updateStats]);

  const handleSearchChange = (val: string) => {
    setQuery(val);
    if (!editor) return;
    (editor.commands as any).setSearchTerm(val);
    updateStats();
  };

  const handleNext = () => {
    if (!editor || matchCount === 0) return;
    (editor.commands as any).nextSearchResult();
    updateStats();
  };

  const handlePrevious = () => {
    if (!editor || matchCount === 0) return;
    (editor.commands as any).previousSearchResult();
    updateStats();
  };

  const handleReplaceCurrent = () => {
    if (!editor || matchCount === 0) return;
    (editor.commands as any).replaceCurrentResult(replacement);
    updateStats();
  };

  const handleReplaceAll = () => {
    if (!editor || matchCount === 0) return;
    (editor.commands as any).replaceAllResults(replacement);
    updateStats();
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
    <div className="find-bar-container" onKeyDown={handleKeyDown}>
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
          <span className="find-bar-counter">
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
