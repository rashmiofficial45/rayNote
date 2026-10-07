import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Editor } from "@tiptap/react";
import { Copy, Check, ChevronDown, Search } from "lucide-react";
import { POPULAR_LANGUAGES } from "./CodeBlockComponent";

interface FloatingCodeBlockToolbarProps {
  editor: Editor | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

interface ActiveBlockState {
  pos: number;
  dom: HTMLElement;
  language: string;
  top: number;
  right: number;
}

export function FloatingCodeBlockToolbar({
  editor,
  scrollContainerRef,
}: FloatingCodeBlockToolbarProps) {
  const [activeBlock, setActiveBlock] = useState<ActiveBlockState | null>(null);
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isHoveringRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Updates toolbar position relative to scroll container
  const updatePositionForBlock = useCallback(
    (preEl: HTMLElement, nodePos: number, lang: string) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const preRect = preEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Top-right aligned within the code block
      const top = preRect.top - containerRect.top + container.scrollTop + 8;
      const right = containerRect.right - preRect.right + 12;

      setActiveBlock({
        pos: nodePos,
        dom: preEl,
        language: lang,
        top,
        right,
      });
    },
    [scrollContainerRef]
  );

  // Find code block at DOM element or position
  const findCodeBlockAtElement = useCallback(
    (target: HTMLElement | null): { preEl: HTMLElement; pos: number; lang: string } | null => {
      if (!editor || !target) return null;
      const preEl = target.closest("pre.notefast-code-block") as HTMLElement | null;
      if (!preEl) return null;

      try {
        const pos = editor.view.posAtDOM(preEl, 0);
        const resolved = editor.state.doc.resolve(pos);
        // Find enclosing codeBlock node
        let codeBlockNode = null;
        let blockPos = pos;
        for (let d = resolved.depth; d >= 0; d--) {
          const n = resolved.node(d);
          if (n && n.type.name === "codeBlock") {
            codeBlockNode = n;
            blockPos = resolved.before(d);
            break;
          }
        }
        if (!codeBlockNode) {
          const atPos = editor.state.doc.nodeAt(pos);
          if (atPos && atPos.type.name === "codeBlock") {
            codeBlockNode = atPos;
            blockPos = pos;
          }
        }

        const lang = codeBlockNode?.attrs?.language || "bash";
        return { preEl, pos: blockPos, lang };
      } catch {
        return null;
      }
    },
    [editor]
  );

  // Listen for cursor selection updates
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const handleSelection = () => {
      if (isHoveringRef.current || isOpen) return;

      const { $from } = editor.state.selection;
      let found = false;
      for (let d = $from.depth; d >= 0; d--) {
        const n = $from.node(d);
        if (n && n.type.name === "codeBlock") {
          const blockPos = $from.before(d);
          try {
            const domNode = editor.view.nodeDOM(blockPos) as HTMLElement | null;
            const preEl = domNode?.tagName === "PRE" ? domNode : domNode?.querySelector("pre");
            if (preEl && scrollContainerRef.current) {
              updatePositionForBlock(preEl as HTMLElement, blockPos, n.attrs.language || "bash");
              found = true;
            }
          } catch {}
          break;
        }
      }

      if (!found && !isHoveringRef.current && !isOpen) {
        setActiveBlock(null);
      }
    };

    editor.on("selectionUpdate", handleSelection);
    return () => {
      editor.off("selectionUpdate", handleSelection);
    };
  }, [editor, isOpen, scrollContainerRef, updatePositionForBlock]);

  // Listen for mousemove over scroll container to detect hovered code block
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handlePointerMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // If mouse is inside toolbar or dropdown is open, keep toolbar active
      if (toolbarRef.current?.contains(target) || isOpen) {
        isHoveringRef.current = true;
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        return;
      }

      const match = findCodeBlockAtElement(target);
      if (match) {
        isHoveringRef.current = true;
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        updatePositionForBlock(match.preEl, match.pos, match.lang);
      } else {
        isHoveringRef.current = false;
        if (!isOpen && !hideTimerRef.current) {
          hideTimerRef.current = setTimeout(() => {
            // Check if cursor is still in a code block
            if (editor && !editor.isDestroyed) {
              const { $from } = editor.state.selection;
              if ($from.parent.type.name === "codeBlock") return;
            }
            setActiveBlock(null);
            hideTimerRef.current = null;
          }, 300);
        }
      }
    };

    const handleScroll = () => {
      if (activeBlock?.dom && scrollContainerRef.current) {
        const preRect = activeBlock.dom.getBoundingClientRect();
        const containerRect = scrollContainerRef.current.getBoundingClientRect();
        const top = preRect.top - containerRect.top + scrollContainerRef.current.scrollTop + 8;
        const right = containerRect.right - preRect.right + 12;
        setActiveBlock((prev) => (prev ? { ...prev, top, right } : null));
      }
    };

    container.addEventListener("pointermove", handlePointerMove, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("scroll", handleScroll);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [findCodeBlockAtElement, updatePositionForBlock, isOpen, activeBlock?.dom, editor, scrollContainerRef]);

  // Copy code handler
  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!activeBlock?.dom) return;

      const codeEl = activeBlock.dom.querySelector("code");
      const text = codeEl?.textContent || activeBlock.dom.textContent || "";
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }
    },
    [activeBlock]
  );

  const currentLang = (activeBlock?.language || "bash").toLowerCase();

  const currentOption = useMemo(() => {
    return POPULAR_LANGUAGES.find((l) => l.value.toLowerCase() === currentLang);
  }, [currentLang]);

  const displayLabel = currentOption
    ? currentOption.label
    : currentLang
    ? currentLang.charAt(0).toUpperCase() + currentLang.slice(1)
    : "Bash";

  const filteredLanguages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return POPULAR_LANGUAGES;
    return POPULAR_LANGUAGES.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q) ||
        item.ext.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const toggleDropdown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsOpen((prev) => {
        const willOpen = !prev;
        if (willOpen) {
          if (dropdownRef.current) {
            const rect = dropdownRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            setOpenUpward(spaceBelow < 260 && rect.top > 260);
          }
          setSearchQuery("");
          const activeIdx = POPULAR_LANGUAGES.findIndex(
            (l) => l.value.toLowerCase() === currentLang
          );
          setSelectedIndex(activeIdx >= 0 ? activeIdx : 0);
        }
        return willOpen;
      });
    },
    [currentLang]
  );

  const handleSelectLanguage = useCallback(
    (langValue: string, e?: React.MouseEvent | React.KeyboardEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!editor || !activeBlock) return;

      try {
        const tr = editor.state.tr;
        const node = editor.state.doc.nodeAt(activeBlock.pos);
        if (node && node.type.name === "codeBlock") {
          tr.setNodeMarkup(activeBlock.pos, null, {
            ...node.attrs,
            language: langValue,
          });
          editor.view.dispatch(tr);
        }
      } catch (err) {
        console.error("Failed to update code block language:", err);
      }

      setActiveBlock((prev) => (prev ? { ...prev, language: langValue } : null));
      setIsOpen(false);
    },
    [editor, activeBlock]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keyboard navigation inside dropdown
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.min(filteredLanguages.length - 1, prev + 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const target = filteredLanguages[selectedIndex];
        if (target) {
          handleSelectLanguage(target.value, e);
        }
      }
    },
    [isOpen, filteredLanguages, selectedIndex, handleSelectLanguage]
  );

  if (!activeBlock) return null;

  return (
    <div
      ref={toolbarRef}
      className="floating-code-block-toolbar"
      style={{
        position: "absolute",
        top: `${activeBlock.top}px`,
        right: `${activeBlock.right}px`,
        zIndex: 30,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="code-block-header-right">
        <div className="code-block-lang-dropdown" ref={dropdownRef}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={toggleDropdown}
            className={`code-block-lang-btn ${isOpen ? "is-active" : ""}`}
            title="Select programming language"
            aria-label="Select code block language"
            aria-expanded={isOpen}
          >
            <span>{displayLabel}</span>
            <ChevronDown
              size={12}
              className={`code-block-chevron transition-transform duration-150 ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {isOpen && (
            <div
              className={`slash-command-menu code-lang-liquid-menu ${
                openUpward ? "is-upward" : ""
              }`}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={handleKeyDown}
              role="listbox"
            >
              <div className="code-lang-search-box" onMouseDown={(e) => e.stopPropagation()}>
                <Search size={11} className="code-lang-search-icon" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedIndex(0);
                  }}
                  placeholder="Search language..."
                  className="code-lang-search-input"
                  onKeyDown={handleKeyDown}
                />
              </div>

              <div
                className="code-lang-items-container"
                ref={menuRef}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {filteredLanguages.length === 0 ? (
                  <div className="slash-command-empty">No languages found</div>
                ) : (
                  filteredLanguages.map((lang, idx) => {
                    const isCurrent = lang.value.toLowerCase() === currentLang;
                    const isHighlighted = idx === selectedIndex;
                    return (
                      <button
                        key={lang.value}
                        type="button"
                        className={`slash-command-item code-lang-item ${
                          isHighlighted ? "is-selected" : ""
                        } ${isCurrent ? "is-current-active" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => handleSelectLanguage(lang.value, e)}
                        onMouseMove={() => {
                          if (selectedIndex !== idx) {
                            setSelectedIndex(idx);
                          }
                        }}
                      >
                        <div className="slash-command-item-icon code-lang-icon-cell">
                          {isCurrent ? (
                            <Check size={11} strokeWidth={2.5} />
                          ) : (
                            <span className="code-lang-dot" />
                          )}
                        </div>
                        <span className="slash-command-item-title">{lang.label}</span>
                        <span className="slash-command-item-badge">.{lang.ext}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={handleCopy}
          className={`code-block-copy-btn ${copied ? "is-copied" : ""}`}
          title={copied ? "Copied!" : "Copy code"}
          aria-label="Copy code block"
        >
          {copied ? (
            <Check size={14} className="text-emerald-400" />
          ) : (
            <Copy size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
