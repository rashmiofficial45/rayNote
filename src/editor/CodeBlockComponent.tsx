import React, { useState } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { Copy, Check, ChevronDown } from "lucide-react";

export const POPULAR_LANGUAGES = [
  { label: "Bash", value: "bash" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "Rust", value: "rust" },
  { label: "JSON", value: "json" },
  { label: "HTML", value: "xml" },
  { label: "CSS", value: "css" },
  { label: "SQL", value: "sql" },
  { label: "Go", value: "go" },
  { label: "C++", value: "cpp" },
  { label: "C", value: "c" },
  { label: "C#", value: "csharp" },
  { label: "Java", value: "java" },
  { label: "Swift", value: "swift" },
  { label: "Kotlin", value: "kotlin" },
  { label: "PHP", value: "php" },
  { label: "Ruby", value: "ruby" },
  { label: "YAML", value: "yaml" },
  { label: "Markdown", value: "markdown" },
  { label: "Diff", value: "diff" },
  { label: "Plain Text", value: "plaintext" },
];

export function CodeBlockComponent({
  node,
  updateAttributes,
}: any) {
  const [copied, setCopied] = useState(false);
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

  return (
    <NodeViewWrapper className="code-block-wrapper">
      <div className="code-block-header" contentEditable={false}>
        <div className="code-block-header-right">
          <div className="code-block-lang-dropdown">
            <span className="code-block-lang-text">
              {displayLabel}
              <ChevronDown size={12} className="code-block-chevron" />
            </span>
            <select
              value={currentLang}
              onChange={(e) => updateAttributes({ language: e.target.value })}
              className="code-block-lang-select"
              title="Change programming language"
              aria-label="Select code block language"
            >
              {POPULAR_LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
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
