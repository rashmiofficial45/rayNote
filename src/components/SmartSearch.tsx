import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { SearchResult, searchDocuments } from "../lib/db";
import { formatDate } from "../lib/utils";
import { getHighlightedSegments } from "../lib/searchRanking";
import {
  Search,
  FileText,
  Pin,
  X,
  FileSearch,
} from "lucide-react";

export interface SmartSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (id: string) => void;
  activeNoteId?: string | null;
}

// In-memory module cache for instant (0ms) recent notes presentation
let cachedRecentNotes: SearchResult[] = [];

export const SmartSearch: React.FC<SmartSearchProps> = ({
  isOpen,
  onClose,
  onSelectNote,
  activeNoteId,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>(cachedRecentNotes);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<number>(0);

  // Focus input and reset query on modal open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      if (cachedRecentNotes.length > 0) {
        setResults(cachedRecentNotes);
      }
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isOpen]);

  // Real-time query execution (15ms ultra-low latency debounce)
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();
    const reqId = ++requestIdRef.current;

    // Empty query -> show recent documents immediately
    if (!trimmed) {
      if (cachedRecentNotes.length > 0) {
        setResults(cachedRecentNotes);
        setSelectedIndex(0);
      }
      searchDocuments("")
        .then((recentNotes) => {
          cachedRecentNotes = recentNotes;
          if (requestIdRef.current === reqId) {
            setResults(recentNotes);
            setSelectedIndex(0);
          }
        })
        .catch(console.error);
      return;
    }

    // 15ms frame debounce: blazing fast responsiveness with stale request guard
    const timer = setTimeout(() => {
      searchDocuments(trimmed)
        .then((res) => {
          if (requestIdRef.current === reqId) {
            setResults(res);
            setSelectedIndex(0);
          }
        })
        .catch((err) => {
          console.error("Search error:", err);
          if (requestIdRef.current === reqId) {
            setResults([]);
          }
        });
    }, 15);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  // Keep selected item visible in list
  useEffect(() => {
    if (listRef.current && results.length > 0) {
      const selectedEl = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      ) as HTMLElement | null;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, results]);

  const handleSelectCurrent = useCallback(
    (index: number) => {
      const item = results[index];
      if (item) {
        onSelectNote(item.id);
        onClose();
      }
    },
    [results, onSelectNote, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (results.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % results.length);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (results.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      handleSelectCurrent(selectedIndex);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="smart-search-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Document Search"
    >
      <div
        className="smart-search-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Sleek Search Header */}
        <div className="smart-search-header">
          <Search className="smart-search-icon" size={16} />

          <input
            ref={inputRef}
            type="text"
            className="smart-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes by title or content…"
            autoFocus
            spellCheck={false}
          />

          {query && (
            <button
              type="button"
              className="smart-search-clear-btn"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}

          <div className="smart-search-badge">
            <span>⌘P</span>
          </div>
        </div>

        {/* Minimalist Results List */}
        <div className="smart-search-list" ref={listRef} role="listbox">
          {results.length > 0 ? (
            results.map((item, index) => {
              const isSelected = index === selectedIndex;
              const isActiveNote = item.id === activeNoteId;

              return (
                <div
                  key={item.id}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  className={`smart-search-item ${
                    isSelected ? "is-selected" : ""
                  } ${isActiveNote ? "is-active-note" : ""}`}
                  onClick={() => handleSelectCurrent(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="smart-search-item-icon">
                    {item.is_pinned ? (
                      <Pin size={13} className="text-amber-400" />
                    ) : (
                      <FileText size={13} />
                    )}
                  </div>

                  <div className="smart-search-item-body">
                    <div className="smart-search-item-top">
                      <span className="smart-search-item-title">
                        <HighlightText text={item.title} query={query} />
                      </span>

                      {/* Minimalist match badge */}
                      <MatchBadge matchType={item.match_type} />
                    </div>

                    {/* Clean 1-line snippet */}
                    {item.snippet && (
                      <div className="smart-search-item-snippet">
                        <HighlightText text={item.snippet} query={query} />
                      </div>
                    )}
                  </div>

                  <div className="smart-search-item-meta">
                    <span className="smart-search-item-date">
                      {formatDate(item.updated_at)}
                    </span>
                  </div>
                </div>
              );
            })
          ) : query.trim() !== "" ? (
            <div className="smart-search-empty">
              <FileSearch size={28} className="smart-search-empty-icon" />
              <div className="smart-search-empty-title">
                No notes found
              </div>
              <div className="smart-search-empty-desc">
                No matching documents for &ldquo;{query}&rdquo;
              </div>
            </div>
          ) : null}
        </div>

        {/* Minimal Footer */}
        <div className="smart-search-footer">
          <div className="smart-search-footer-hints">
            <span className="smart-search-kbd-hint">
              <kbd>↑</kbd>
              <kbd>↓</kbd>
              Navigate
            </span>
            <span className="smart-search-kbd-hint">
              <kbd>↵</kbd>
              Open
            </span>
            <span className="smart-search-kbd-hint">
              <kbd>esc</kbd>
              Dismiss
            </span>
          </div>

          <div className="smart-search-footer-count">
            {results.length > 0 && (
              <span>{results.length} {results.length === 1 ? "note" : "notes"}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Fast memoized highlight component
 */
const HighlightText: React.FC<{ text: string; query: string }> = React.memo(
  ({ text, query }) => {
    const segments = useMemo(
      () => getHighlightedSegments(text, query),
      [text, query]
    );

    return (
      <>
        {segments.map((seg, idx) =>
          seg.isMatch ? (
            <mark key={idx} className="smart-search-highlight">
              {seg.text}
            </mark>
          ) : (
            <span key={idx}>{seg.text}</span>
          )
        )}
      </>
    );
  }
);

/**
 * Sleek, minimal match badge
 */
function MatchBadge({ matchType }: { matchType: string }) {
  switch (matchType) {
    case "exact_title":
      return <span className="smart-search-pill pill-exact">Exact</span>;
    case "title_prefix":
    case "title_substring":
      return <span className="smart-search-pill pill-title">Title</span>;
    case "title_words":
      return <span className="smart-search-pill pill-words">Words</span>;
    case "fuzzy_title":
      return <span className="smart-search-pill pill-fuzzy">Typo</span>;
    case "content":
      return <span className="smart-search-pill pill-content">Content</span>;
    default:
      return null;
  }
}
