import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Editor } from "@tiptap/react";
import { Copy, Check, ChevronDown, Search } from "lucide-react";
import { POPULAR_LANGUAGES } from "./CodeBlockComponent";

interface FloatingCodeBlockToolbarProps {
  editor: Editor | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  zoomLevel?: number;
}

interface ActiveBlockState {
  dom: HTMLElement;
  language: string;
  top: number;
  right: number;
}

export function FloatingCodeBlockToolbar({
  editor,
  scrollContainerRef,
  zoomLevel = 1,
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
  const hoveredPreRef = useRef<HTMLElement | null>(null);
  const activeBlockRef = useRef<ActiveBlockState | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  activeBlockRef.current = activeBlock;

  // Calculates exact top-right coordinates for a code block element within the zoomed container
  const computePosition = useCallback(
    (preEl: HTMLElement): { top: number; right: number } | null => {
      const container = scrollContainerRef.current;
      if (!container || !preEl || !document.body.contains(preEl)) return null;

      // The toolbar sits inside the zoomed content wrapper (offsetParent)
      const parentEl =
        (toolbarRef.current?.offsetParent as HTMLElement | null) ||
        (container.firstElementChild as HTMLElement | null);
      if (!parentEl) return null;

      const preRect = preEl.getBoundingClientRect();
      const parentRect = parentEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const zoom = zoomLevel > 0 ? zoomLevel : 1;

      // If the code block is completely scrolled outside visible viewport of the scroll container, hide it
      if (preRect.bottom < containerRect.top + 10 || preRect.top > containerRect.bottom - 10) {
        return null;
      }

      // Exact pixel position inside parentEl, normalized for zoom
      const top = (preRect.top - parentRect.top) / zoom + 4;
      const right = (parentRect.right - preRect.right) / zoom + 8;

      return { top, right };
    },
    [scrollContainerRef, zoomLevel]
  );

  // Find the code block enclosing the current cursor selection
  const getCursorCodeBlock = useCallback((): { preEl: HTMLElement; lang: string } | null => {
    if (!editor || editor.isDestroyed) return null;
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      const n = $from.node(d);
      if (n && n.type.name === "codeBlock") {
        const blockPos = $from.before(d);
        try {
          const domNode = editor.view.nodeDOM(blockPos) as HTMLElement | null;
          const preEl = domNode?.tagName === "PRE" ? domNode : domNode?.querySelector("pre");
          if (preEl && document.body.contains(preEl)) {
            return { preEl: preEl as HTMLElement, lang: n.attrs.language || "bash" };
          }
        } catch {}
        break;
      }
    }
    return null;
  }, [editor]);

  // Synchronize toolbar position and visibility
  const syncToolbar = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      if (activeBlockRef.current) setActiveBlock(null);
      return;
    }

    // If text selection is active (range selection or Mod-A), toolbar should not appear
    if (!editor.state.selection.empty) {
      if (activeBlockRef.current) {
        setActiveBlock(null);
      }
      return;
    }

    // 1. If dropdown is open, keep current code block anchored if still valid
    if (isOpen && activeBlockRef.current?.dom) {
      const dom = activeBlockRef.current.dom;
      if (document.body.contains(dom)) {
        const coords = computePosition(dom);
        if (coords) {
          setActiveBlock((prev) =>
            prev ? { ...prev, top: coords.top, right: coords.right } : null
          );
          return;
        }
      }
      // If code block was removed or scrolled out of view, close dropdown & hide
      setIsOpen(false);
      setActiveBlock(null);
      return;
    }

    // 2. Prioritize block under cursor (text caret)
    const cursorBlock = getCursorCodeBlock();
    if (cursorBlock && document.body.contains(cursorBlock.preEl)) {
      const coords = computePosition(cursorBlock.preEl);
      if (coords) {
        setActiveBlock({
          dom: cursorBlock.preEl,
          language: cursorBlock.lang,
          top: coords.top,
          right: coords.right,
        });
        return;
      }
    }

    // If text cursor has moved away, verify if mouse pointer is genuinely still over the block
    if (hoveredPreRef.current && lastMousePosRef.current) {
      const elAtPoint = document.elementFromPoint(
        lastMousePosRef.current.x,
        lastMousePosRef.current.y
      );
      if (
        !elAtPoint ||
        (!hoveredPreRef.current.contains(elAtPoint) &&
          !toolbarRef.current?.contains(elAtPoint))
      ) {
        hoveredPreRef.current = null;
      }
    }

    // 3. Check block hovered by mouse
    const hoveredEl = hoveredPreRef.current;
    if (hoveredEl && document.body.contains(hoveredEl)) {
      let lang = "bash";
      try {
        const nodePos = editor.view.posAtDOM(hoveredEl, 0);
        const resolved = editor.state.doc.resolve(nodePos);
        for (let d = resolved.depth; d >= 0; d--) {
          const n = resolved.node(d);
          if (n?.type.name === "codeBlock") {
            lang = n.attrs.language || "bash";
            break;
          }
        }
      } catch {}

      const coords = computePosition(hoveredEl);
      if (coords) {
        setActiveBlock({
          dom: hoveredEl,
          language: lang,
          top: coords.top,
          right: coords.right,
        });
        return;
      }
    }

    // 4. Neither cursor in code block nor hovering -> HIDE IMMEDIATELY
    if (activeBlockRef.current) {
      setActiveBlock(null);
    }
    if (isOpen) {
      setIsOpen(false);
    }
  }, [editor, isOpen, computePosition, getCursorCodeBlock]);

  // Listen for editor updates (typing, deleting, formatting) and selection updates
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    editor.on("selectionUpdate", syncToolbar);
    editor.on("update", syncToolbar);

    return () => {
      editor.off("selectionUpdate", syncToolbar);
      editor.off("update", syncToolbar);
    };
  }, [editor, syncToolbar]);

  // Listen for scroll & window resize
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const handleScrollOrResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        syncToolbar();
      });
    };

    container.addEventListener("scroll", handleScrollOrResize, { passive: true });
    window.addEventListener("resize", handleScrollOrResize, { passive: true });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener("scroll", handleScrollOrResize);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [scrollContainerRef, syncToolbar]);

  // Track mouse pointer over code blocks and toolbar
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handlePointerMove = (e: PointerEvent) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // If mouse is inside toolbar or dropdown, keep toolbar active
      if (toolbarRef.current?.contains(target)) {
        return;
      }

      const pre = target.closest("pre.notefast-code-block") as HTMLElement | null;
      if (pre !== hoveredPreRef.current) {
        hoveredPreRef.current = pre;
        syncToolbar();
      }
    };

    const handlePointerLeave = () => {
      if (hoveredPreRef.current) {
        hoveredPreRef.current = null;
        syncToolbar();
      }
    };

    const handleWindowMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        hoveredPreRef.current = null;
        syncToolbar();
      }
    };

    const handleWindowBlur = () => {
      hoveredPreRef.current = null;
      syncToolbar();
    };

    container.addEventListener("pointermove", handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    window.addEventListener("mouseout", handleWindowMouseOut);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("mouseout", handleWindowMouseOut);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [scrollContainerRef, syncToolbar]);

  // Re-observe activeBlock DOM mutations / resizing
  useEffect(() => {
    if (!activeBlock?.dom) return;

    const ro = new ResizeObserver(() => {
      syncToolbar();
    });

    ro.observe(activeBlock.dom);
    return () => ro.disconnect();
  }, [activeBlock?.dom, syncToolbar]);

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
      if (!editor || !activeBlock?.dom) return;

      try {
        const pos = editor.view.posAtDOM(activeBlock.dom, 0);
        const resolved = editor.state.doc.resolve(pos);
        let blockPos = pos;
        for (let d = resolved.depth; d >= 0; d--) {
          const n = resolved.node(d);
          if (n && n.type.name === "codeBlock") {
            blockPos = resolved.before(d);
            break;
          }
        }
        const node = editor.state.doc.nodeAt(blockPos);
        if (node && node.type.name === "codeBlock") {
          const tr = editor.state.tr.setNodeMarkup(blockPos, null, {
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
      editor.view.focus();
    },
    [editor, activeBlock]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        requestAnimationFrame(() => {
          syncToolbar();
        });
      }
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [isOpen, syncToolbar]);

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
        editor?.view?.focus();
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
    [isOpen, filteredLanguages, selectedIndex, handleSelectLanguage, editor]
  );

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll(".code-lang-item");
    const activeItem = items[selectedIndex] as HTMLElement | undefined;
    if (activeItem) {
      activeItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  if (!activeBlock || !document.body.contains(activeBlock.dom)) return null;

  return (
    <div
      ref={toolbarRef}
      className="floating-code-block-toolbar"
      style={{
        position: "absolute",
        top: `${activeBlock.top}px`,
        right: `${activeBlock.right}px`,
        zIndex: 35,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="code-block-header-right">
        <div className="code-block-lang-dropdown" ref={dropdownRef}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onClick={toggleDropdown}
            className={`code-block-lang-btn ${isOpen ? "is-active" : ""}`}
            aria-label="Select code block language"
            aria-expanded={isOpen}
          >
            <span>{displayLabel}</span>
            <ChevronDown
              size={9}
              strokeWidth={2.2}
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
                <Search size={9} className="code-lang-search-icon" />
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
                            <Check size={8.5} strokeWidth={2.8} />
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
            e.stopPropagation();
          }}
          onClick={handleCopy}
          className={`code-block-copy-btn ${copied ? "is-copied" : ""}`}
          aria-label={copied ? "Copied code" : "Copy code"}
        >
          {copied ? (
            <Check size={11} strokeWidth={2.2} className="text-emerald-400" />
          ) : (
            <Copy size={11} strokeWidth={1.8} />
          )}
        </button>
      </div>
    </div>
  );
}
