import React, { useState, useRef, useEffect, useCallback } from "react";
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

  const currentLang = node?.attrs?.language || "bash";

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = node?.textContent || "";
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const currentOption = POPULAR_LANGUAGES.find(
    (l) => l.value.toLowerCase() === currentLang.toLowerCase()
  );
  const displayLabel = currentOption
    ? currentOption.label
    : currentLang
    ? currentLang.charAt(0).toUpperCase() + currentLang.slice(1)
    : "Bash";

  const filteredLanguages = POPULAR_LANGUAGES.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      item.label.toLowerCase().includes(q) ||
      item.value.toLowerCase().includes(q) ||
      item.ext.toLowerCase().includes(q)
    );
  });

  const toggleDropdown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen) {
      // Check if code block header is near the bottom of viewport
      if (dropdownRef.current) {
        const rect = dropdownRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setOpenUpward(spaceBelow < 260 && rect.top > 260);
      }
      setSearchQuery("");
      setSelectedIndex(0);
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  const handleSelectLanguage = useCallback(
    (langValue: string) => {
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

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keyboard navigation inside dropdown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev >= filteredLanguages.length - 1 ? 0 : prev + 1
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? filteredLanguages.length - 1 : prev - 1
      );
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const target = filteredLanguages[selectedIndex];
      if (target) {
        handleSelectLanguage(target.value);
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll(".slash-command-item");
    const activeItem = items[selectedIndex] as HTMLElement | undefined;
    if (activeItem) {
      activeItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  return (
    <NodeViewWrapper className="code-block-wrapper">
      <div className="code-block-header" contentEditable={false}>
        <div className="code-block-header-right">
          <div className="code-block-lang-dropdown" ref={dropdownRef}>
            <button
              type="button"
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
                onKeyDown={handleKeyDown}
                role="listbox"
              >
                <div className="code-lang-search-box">
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

                <div className="code-lang-items-container" ref={menuRef}>
                  {filteredLanguages.length === 0 ? (
                    <div className="slash-command-empty">No languages found</div>
                  ) : (
                    filteredLanguages.map((lang, idx) => {
                      const isCurrent =
                        lang.value.toLowerCase() === currentLang.toLowerCase();
                      const isHighlighted = idx === selectedIndex;
                      return (
                        <button
                          key={lang.value}
                          type="button"
                          className={`slash-command-item code-lang-item ${
                            isHighlighted ? "is-selected" : ""
                          } ${isCurrent ? "is-current-active" : ""}`}
                          onClick={() => handleSelectLanguage(lang.value)}
                          onMouseEnter={() => setSelectedIndex(idx)}
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
