import { Command, Copy, Plus, Trash2, Settings, FileText, Upload, Eye } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { openSettingsWindow } from "../lib/db";

interface TitleBarProps {
  title: string;
  onNewNote: () => void;
  onOpenCommandPalette: () => void;
  onDuplicateNote: () => void;
  onDeleteNote: () => void;
  onCopyMarkdown: () => void;
  onTriggerImportFile?: () => void;
  onTriggerViewFile?: () => void;
}

export function TitleBar({
  title,
  onNewNote,
  onOpenCommandPalette,
  onDuplicateNote,
  onDeleteNote,
  onCopyMarkdown,
  onTriggerImportFile,
  onTriggerViewFile,
}: TitleBarProps) {
  const titleBarRef = useRef<HTMLDivElement>(null);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const commandMenuRef = useRef<HTMLDivElement>(null);

  // Close command menu on outside click
  useEffect(() => {
    if (!commandMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(e.target as Node)
      ) {
        setCommandMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [commandMenuOpen]);

  // Native drag on mousedown (skip if clicking buttons or the command menu)
  useEffect(() => {
    const titleBar = titleBarRef.current;
    if (!titleBar) return;

    const handleMouseDown = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest(".command-popover")
      ) {
        return;
      }

      // Prevent WebKit from initiating text selection on click, double-click or drag
      e.preventDefault();
      window.getSelection()?.removeAllRanges();

      if (e.button === 0) {
        invoke("start_native_drag").catch((err) => {
          console.error("start_native_drag error:", err);
        });
      }
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    const handleDblClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
    };

    titleBar.addEventListener("mousedown", handleMouseDown);
    titleBar.addEventListener("selectstart", handleSelectStart);
    titleBar.addEventListener("dblclick", handleDblClick);
    return () => {
      titleBar.removeEventListener("mousedown", handleMouseDown);
      titleBar.removeEventListener("selectstart", handleSelectStart);
      titleBar.removeEventListener("dblclick", handleDblClick);
    };
  }, []);

  // Hide the panel (Cmd+W behavior — stays alive in background)
  const handleClose = () => {
    invoke("hide_window").catch((err) => {
      console.error("hide_window error:", err);
    });
  };

  const [isCloseHovered, setIsCloseHovered] = useState(false);

  return (
    <div
      ref={titleBarRef}
      className="title-bar"
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest("button") && !target.closest(".command-popover")) {
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
        }
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.getSelection()?.removeAllRanges();
      }}
    >
      {/* Left: Single enlarged red X button */}
      <div
        className="title-bar-left"
        onMouseEnter={() => setIsCloseHovered(true)}
        onMouseLeave={() => setIsCloseHovered(false)}
      >
        <button
          onClick={handleClose}
          onMouseEnter={() => setIsCloseHovered(true)}
          onMouseLeave={() => setIsCloseHovered(false)}
          className={`close-btn-x ${isCloseHovered ? "is-hovered" : ""}`}
          title="Hide (⌘W)"
          aria-label="Hide NoteFast"
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="close-x-icon"
          >
            <path
              d="M1.2 1.2L6.8 6.8M6.8 1.2L1.2 6.8"
              stroke="#000000"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Center: Note title */}
      <div className="title-text">{title || "Untitled"}</div>

      {/* Right: Copy Markdown + Delete + Command (Command opens popover) */}
      <div className="title-bar-right">
        <button
          className="title-bar-btn liquid-btn copy-md-btn"
          onClick={onCopyMarkdown}
          title="Copy Note as Markdown (⇧⌘C)"
          aria-label="Copy Note as Markdown"
        >
          <FileText size={13} />
        </button>
        <button
          className="title-bar-btn liquid-btn delete-btn"
          onClick={onDeleteNote}
          title="Delete Note (⇧⌘⌫)"
        >
          <Trash2 size={13} />
        </button>
        <div style={{ position: "relative" }} ref={commandMenuRef}>
          <button
            className="title-bar-btn liquid-btn"
            onClick={() => setCommandMenuOpen(!commandMenuOpen)}
            title="Actions"
          >
            <Command size={14} />
          </button>
          {commandMenuOpen && (
            <div className="command-popover">
              <button
                className="command-popover-item"
                onClick={() => {
                  onCopyMarkdown();
                  setCommandMenuOpen(false);
                }}
              >
                <FileText size={13} />
                <span>Copy as Markdown</span>
                <kbd className="popover-kbd">⇧⌘C</kbd>
              </button>
              <div className="command-popover-divider" />
              <button
                className="command-popover-item"
                onClick={() => {
                  setCommandMenuOpen(false);
                  onTriggerImportFile?.();
                }}
              >
                <Upload size={13} className="text-sky-400" />
                <span>Import .md File (Upload)</span>
              </button>
              <button
                className="command-popover-item"
                onClick={() => {
                  setCommandMenuOpen(false);
                  onTriggerViewFile?.();
                }}
              >
                <Eye size={13} className="text-violet-400" />
                <span>View .md File (No Upload)</span>
              </button>
              <div className="command-popover-divider" />
              <button
                className="command-popover-item"
                onClick={() => {
                  onDuplicateNote();
                  setCommandMenuOpen(false);
                }}
              >
                <Copy size={13} />
                <span>Duplicate</span>
                <kbd className="popover-kbd">⌘D</kbd>
              </button>
              <button
                className="command-popover-item"
                onClick={() => {
                  onNewNote();
                  setCommandMenuOpen(false);
                }}
              >
                <Plus size={13} />
                <span>New Note</span>
                <kbd className="popover-kbd">⌘N</kbd>
              </button>
              <div className="command-popover-divider" />
              <button
                className="command-popover-item"
                onClick={() => {
                  onOpenCommandPalette();
                  setCommandMenuOpen(false);
                }}
              >
                <Command size={13} />
                <span>Command & Settings Palette</span>
                <kbd className="popover-kbd">⌘K</kbd>
              </button>
              <div className="command-popover-divider" />
              <button
                className="command-popover-item"
                onClick={() => {
                  openSettingsWindow().catch(console.error);
                  setCommandMenuOpen(false);
                }}
              >
                <Settings size={13} />
                <span>Settings…</span>
                <kbd className="popover-kbd">⌘,</kbd>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
