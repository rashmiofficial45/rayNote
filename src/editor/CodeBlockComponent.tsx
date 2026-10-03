import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { Copy, Check, ChevronDown, Search } from "lucide-react";

export const POPULAR_LANGUAGES = [
  { label: "Bash", value: "bash", ext: "sh" },
  { label: "JavaScript", value: "javascript", ext: "js" },
  { label: "TypeScript", value: "typescript", ext: "ts" },
  { label: "Python", value: "python", ext: "py" },
  { label: "Rust", value: "rust", ext: "rs" },
  { label: "JSON", value: "json", ext: "json" },
  { label: "HTML", value: "xml", ext: "html" },
  { label: "CSS", value: "css", ext: "css" },
  { label: "SQL", value: "sql", ext: "sql" },
  { label: "Go", value: "go", ext: "go" },
  { label: "C++", value: "cpp", ext: "cpp" },
  { label: "C", value: "c", ext: "c" },
  { label: "C#", value: "csharp", ext: "cs" },
  { label: "Java", value: "java", ext: "java" },
  { label: "Swift", value: "swift", ext: "swift" },
  { label: "Kotlin", value: "kotlin", ext: "kt" },
  { label: "PHP", value: "php", ext: "php" },
  { label: "Ruby", value: "ruby", ext: "rb" },
  { label: "YAML", value: "yaml", ext: "yml" },
  { label: "Markdown", value: "markdown", ext: "md" },
  { label: "Diff", value: "diff", ext: "diff" },
  { label: "Plain Text", value: "plaintext", ext: "txt" },
];

export function CodeBlockComponent({
  node,
  updateAttributes,
}: any) {
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentLang = (node?.attrs?.language || "bash").toLowerCase();

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = node?.textContent || "";
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [node?.textContent]);

  const currentOption = useMemo(() => {
    return POPULAR_LANGUAGES.find(
      (l) => l.value.toLowerCase() === currentLang
    );
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

  const toggleDropdown = useCallback((e: React.MouseEvent) => {
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
        // Highlight ONLY the currently active language initially (not index 0)
        const activeIdx = POPULAR_LANGUAGES.findIndex(
          (l) => l.value.toLowerCase() === currentLang
        );
        setSelectedIndex(activeIdx >= 0 ? activeIdx : 0);
      }
      return willOpen;
    });
  }, [currentLang]);

  const handleSelectLanguage = useCallback(
    (langValue: string, e?: React.MouseEvent | React.KeyboardEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      updateAttributes({ language: langValue });
      setIsOpen(false);
    },
    [updateAttributes]
  );

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [isOpen]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keyboard navigation inside dropdown
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
      setSelectedIndex((prev) =>
        Math.min(filteredLanguages.length - 1, prev + 1)
      );
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
  }, [isOpen, filteredLanguages, selectedIndex, handleSelectLanguage]);

  // Scroll active item into view when selectedIndex changes
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll(".code-lang-item");
    const activeItem = items[selectedIndex] as HTMLElement | undefined;
    if (activeItem) {
      activeItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  return (
    <NodeViewWrapper className="code-block-wrapper">
      <div
        className="code-block-header"
        contentEditable={false}
        onMouseDown={(e) => {
          // Prevent ProseMirror from taking focus or creating a range selection on header clicks
          if ((e.target as HTMLElement).tagName !== "INPUT") {
            e.stopPropagation();
          }
        }}
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
                <div
                  className="code-lang-search-box"
                  onMouseDown={(e) => e.stopPropagation()}
                >
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
                          <span className="slash-command-item-title">
                            {lang.label}
                          </span>
                          <span className="slash-command-item-badge">
                            .{lang.ext}
                          </span>
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

      <pre className="code-block-pre">
        <NodeViewContent as={"code" as any} className={`hljs language-${currentLang}`} />
      </pre>
    </NodeViewWrapper>
  );
}
