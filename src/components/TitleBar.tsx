import { Command, Trash2, Copy, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { listenToSettingsSync } from "../lib/settingsSync";
import { getStoredCommandsConfig, getCommandHotkey, CommandRow } from "../lib/commandsConfig";
import { useNoteTitle } from "../lib/titleStore";
import { useSaveStatus } from "../lib/saveStatusStore";

interface TitleBarProps {
  title: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onNewNote: () => void;
  onOpenCommandPalette: () => void;
  onOpenSmartSearch?: () => void;
  onDuplicateNote: () => void;
  onDeleteNote: () => void;
  onCopyMarkdown: () => void;
  onTriggerImportFile?: () => void;
  onTriggerViewFile?: () => void;
  onOpenSaveConflict?: () => void;
}

export function TitleBar({
  title,
  isFullscreen = false,
  onToggleFullscreen,
  onOpenCommandPalette,
  onOpenSmartSearch: _onOpenSmartSearch,
  onDeleteNote,
  onCopyMarkdown,
  onOpenSaveConflict,
}: TitleBarProps) {
  const titleBarRef = useRef<HTMLDivElement>(null);
  // On macOS the expanded panel is still a regular, movable window.
  const canDragWindow = !isFullscreen || /Macintosh/.test(navigator.userAgent);
  const [commandsConfig, setCommandsConfig] = useState<CommandRow[]>(getStoredCommandsConfig);
  const storeTitle = useNoteTitle();
  const saveStatus = useSaveStatus();
  const rawTitle = storeTitle !== null ? storeTitle : title;
  const displayTitle =
    rawTitle !== undefined && rawTitle.trim() !== ""
      ? rawTitle
      : rawTitle === ""
        ? "Untitled"
        : "rayNote";

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
        target.closest("button, .title-bar-right") ||
        target.closest(".command-popover")
      ) {
        return;
      }

      // Prevent WebKit from initiating text selection on click, double-click or drag
      e.preventDefault();
      window.getSelection()?.removeAllRanges();

      if (e.button === 0 && canDragWindow) {
        setIsTitleBarHovered(false);
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
  }, [canDragWindow]);

  // Hide the panel (Cmd+W behavior — stays alive in background)
  const handleClose = () => {
    invoke("hide_window").catch((err) => {
      console.error("hide_window error:", err);
    });
  };

  const [isTitleBarHovered, setIsTitleBarHovered] = useState(false);
  const isHoveredRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlistenFocus: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) {
          isHoveredRef.current = false;
          setIsTitleBarHovered(false);
        }
      })
      .then((fn) => {
        if (disposed) fn(); else unlistenFocus = fn;
      })
      .catch(() => { });

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
      }
    };

    const handleReset = () => {
      if (isHoveredRef.current) {
        isHoveredRef.current = false;
        setIsTitleBarHovered(false);
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
      disposed = true;
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
      data-window-draggable={canDragWindow ? "" : undefined}
      onMouseEnter={() => setIsTitleBarHovered(true)}
      onMouseLeave={() => setIsTitleBarHovered(false)}
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
      {/* Left: Window controls */}
      <div className="title-bar-left">
        <button
          onClick={handleClose}
          className="close-btn-x"
          title={`Hide (${hideHotkey})`}
          aria-label="Hide rayNote"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 10 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="close-x-icon"
            aria-hidden="true"
          >
            <path
              d="M2 2L8 8M8 2L2 8"
              stroke="#000000"
              strokeWidth="2.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {onToggleFullscreen && (
          <button
            type="button"
            className="fullscreen-btn"
            onClick={onToggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13.5 2.5 9.5 6.5m0-3.5v3.5H13M2.5 13.5l4-4m-3.5 0h3.5V13" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M11 1 5 2l5 5ZM1 11l6-1-5-5Z" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Center: Note title */}
      <div className="title-text flex items-center justify-center gap-2 min-w-0">
        <span className="title-text-content">{displayTitle || "Untitled"}</span>
        {saveStatus.isSaveBlocked && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenSaveConflict?.();
            }}
            className="not-saved-pill flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors cursor-pointer"
            title="Autosave paused due to save errors. Click to resolve."
            aria-label="Autosave paused - Not saved"
          >
            <AlertTriangle size={11} className="text-amber-400" />
            <span>Not saved</span>
          </button>
        )}
      </div>

      {/* Right: Copy Markdown + Delete + Command Palette (Direct Action) */}
      <div className="title-bar-right" role="group" aria-label="Note actions">
        <button
          className="title-bar-btn copy-md-btn"
          onClick={onCopyMarkdown}
          title={`Copy Note as Markdown (${copyMarkdownHotkey})`}
          aria-label="Copy Note as Markdown"
        >
          <Copy size={20} strokeWidth={2.35} aria-hidden="true" />
        </button>
        <button
          className="title-bar-btn delete-btn"
          onClick={onDeleteNote}
          title={`Delete Note (${deleteHotkey})`}
          aria-label="Delete Note"
        >
          <Trash2 size={20} strokeWidth={2.35} aria-hidden="true" />
        </button>
        <button
          className="title-bar-btn command-palette-btn"
          onClick={onOpenCommandPalette}
          title={`Command Palette (${commandPaletteHotkey})`}
          aria-label="Command Palette"
        >
          <Command size={20} strokeWidth={2.35} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
