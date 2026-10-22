import { Command, Trash2, FileText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { listenToSettingsSync } from "../lib/settingsSync";
import { getStoredCommandsConfig, getCommandHotkey, CommandRow } from "../lib/commandsConfig";

interface TitleBarProps {
  title: string;
  onNewNote: () => void;
  onOpenCommandPalette: () => void;
  onOpenSmartSearch?: () => void;
  onDuplicateNote: () => void;
  onDeleteNote: () => void;
  onCopyMarkdown: () => void;
  onTriggerImportFile?: () => void;
  onTriggerViewFile?: () => void;
}

export function TitleBar({
  title,
  onOpenCommandPalette,
  onDeleteNote,
  onCopyMarkdown,
}: TitleBarProps) {
  const titleBarRef = useRef<HTMLDivElement>(null);
  const [commandsConfig, setCommandsConfig] = useState<CommandRow[]>(getStoredCommandsConfig);

  // Auto-reflect shortcut updates across the entire app
  useEffect(() => {
    return listenToSettingsSync({
      onCommandsConfigChange: (newConfig) => {
        if (newConfig) setCommandsConfig(newConfig);
      },
    });
  }, []);

  const copyMarkdownHotkey = getCommandHotkey(commandsConfig, "copy_markdown", "⇧⌘C").hotkey;
  const deleteHotkey = getCommandHotkey(commandsConfig, "delete", "⇧⌘⌫").hotkey;
  const commandPaletteHotkey = getCommandHotkey(commandsConfig, "search", "⌘K").hotkey;
  const hideHotkey = getCommandHotkey(commandsConfig, "hide", "⌘W").hotkey;

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
        setIsTitleBarHovered(false);
        setIsCloseHovered(false);
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

    const handleWheel = (e: WheelEvent) => {
      const scrollEl = document.querySelector<HTMLElement>("[data-scroll-container]");
      if (scrollEl) {
        scrollEl.scrollBy({
          top: e.deltaY,
          left: e.deltaX,
          behavior: "auto",
        });
      }
    };

    titleBar.addEventListener("mousedown", handleMouseDown);
    titleBar.addEventListener("selectstart", handleSelectStart);
    titleBar.addEventListener("dblclick", handleDblClick);
    titleBar.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      titleBar.removeEventListener("mousedown", handleMouseDown);
      titleBar.removeEventListener("selectstart", handleSelectStart);
      titleBar.removeEventListener("dblclick", handleDblClick);
      titleBar.removeEventListener("wheel", handleWheel);
    };
  }, []);

  // Hide the panel (Cmd+W behavior — stays alive in background)
  const handleClose = () => {
    invoke("hide_window").catch((err) => {
      console.error("hide_window error:", err);
    });
  };

  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const [isTitleBarHovered, setIsTitleBarHovered] = useState(false);
  const isHoveredRef = useRef(false);

  useEffect(() => {
    let unlistenFocus: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) {
          isHoveredRef.current = false;
          setIsTitleBarHovered(false);
          setIsCloseHovered(false);
        }
      })
      .then((fn) => {
        unlistenFocus = fn;
      })
      .catch(() => {});

    // Active pointer tracking: only dispatches state when crossing window boundaries
    const handlePointerMove = (e: PointerEvent) => {
      const inPage =
        e.clientY >= 0 &&
        e.clientY <= window.innerHeight &&
        e.clientX >= 0 &&
        e.clientX <= window.innerWidth;

      if (isHoveredRef.current !== inPage) {
        isHoveredRef.current = inPage;
        setIsTitleBarHovered(inPage);
        if (!inPage) {
          setIsCloseHovered(false);
        }
      }
    };

    const handleReset = () => {
      if (isHoveredRef.current) {
        isHoveredRef.current = false;
        setIsTitleBarHovered(false);
        setIsCloseHovered(false);
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        handleReset();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("mouseout", handleMouseOut);
    window.addEventListener("blur", handleReset);
    document.addEventListener("mouseleave", handleReset);

    return () => {
      if (unlistenFocus) unlistenFocus();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("blur", handleReset);
      document.removeEventListener("mouseleave", handleReset);
    };
  }, []);


  return (
    <div
      ref={titleBarRef}
      className={`title-bar ${isTitleBarHovered ? "is-hovered" : ""}`}
      onMouseEnter={() => setIsTitleBarHovered(true)}
      onMouseLeave={() => {
        setIsTitleBarHovered(false);
        setIsCloseHovered(false);
      }}
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
          title={`Hide (${hideHotkey})`}
          aria-label="Hide rayNote"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="close-x-icon"
          >
            <path
              d="M2 2L8 8M8 2L2 8"
              stroke="#000000"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Center: Note title */}
      <div className="title-text">{title || "Untitled"}</div>

      {/* Right: Copy Markdown + Delete + Command Palette (Direct Action) */}
      <div className="title-bar-right">
        <button
          className="title-bar-btn liquid-btn copy-md-btn"
          onClick={onCopyMarkdown}
          title={`Copy Note as Markdown (${copyMarkdownHotkey})`}
          aria-label="Copy Note as Markdown"
        >
          <FileText size={15} />
        </button>
        <button
          className="title-bar-btn liquid-btn delete-btn"
          onClick={onDeleteNote}
          title={`Delete Note (${deleteHotkey})`}
          aria-label="Delete Note"
        >
          <Trash2 size={15} />
        </button>
        <button
          className="title-bar-btn liquid-btn command-palette-btn"
          onClick={onOpenCommandPalette}
          title={`Command Palette (${commandPaletteHotkey})`}
          aria-label="Command Palette"
        >
          <Command size={16} />
        </button>
      </div>
    </div>
  );
}
