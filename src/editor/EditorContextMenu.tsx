import { nextMenuIndex } from "../lib/menuNavigation";
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Editor } from "@tiptap/react";
import {
  Scissors,
  Copy,
  ClipboardPaste,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  CheckSquare,
  Undo2,
  Redo2,
  Check,
  ExternalLink,
  Trash2,
  Scan,
  PencilOff,
  Pencil,
} from "lucide-react";
import {
  ContextMenuState,
  executeContextMenuAction,
} from "./contextMenuUtils";
import { useCommandsConfig, getCommandHotkey } from "../lib/commandsConfig";

export interface EditorContextMenuProps {
  editor: Editor | null;
  menuState: ContextMenuState | null;
  onClose: () => void;
  readOnly?: boolean;
  onToggleReadOnly?: () => void;
}

interface MenuItemDef {
  id: string;
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  action?: string;
}

export function EditorContextMenu({
  editor,
  menuState,
  onClose,
  readOnly = false,
  onToggleReadOnly,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const ignorePointerRef = useRef<boolean>(false);

  const commandsConfig = useCommandsConfig();
  const getShortcut = useCallback(
    (id: string, defaultHotkey = ""): string | undefined => {
      const { hotkey, enabled } = getCommandHotkey(commandsConfig, id, defaultHotkey);
      return enabled ? hotkey : undefined;
    },
    [commandsConfig]
  );

  // Close when editor is missing or destroyed
  useEffect(() => {
    if (!editor || editor.isDestroyed || !menuState) {
      setHighlightedIndex(-1);
    }
  }, [editor, menuState]);

  // Build items based on menuState type
  const contextItems: (MenuItemDef | "separator")[] = React.useMemo(() => {
    if (!menuState || !editor) return [];

    const isEditable = editor.isEditable;
    const canUndo = menuState.canUndo;
    const canRedo = menuState.canRedo;
    const selectAll: MenuItemDef = {
      id: "selectAll",
      label: "Select All",
      shortcut: getShortcut("select_all", "⌘A"),
      icon: <Scan size={13} />,
      action: "selectAll",
    };

    // ── Context: Block Selection ──────────────────────────────
    if (menuState.type === "block-selection") {
      return [
        {
          id: "copy",
          label: "Copy Block(s)",
          shortcut: "⌘C",
          icon: <Copy size={13} />,
          action: "copy",
        },
        {
          id: "cut",
          label: "Cut Block(s)",
          shortcut: "⌘X",
          icon: <Scissors size={13} />,
          action: "cut",
          disabled: !isEditable,
        },
        {
          id: "delete",
          label: "Delete Block(s)",
          shortcut: "⌫",
          icon: <Trash2 size={13} />,
          action: "deleteBlocks",
          disabled: !isEditable,
        },
        "separator",
        {
          id: "clearSelection",
          label: "Clear Selection",
          shortcut: "Esc",
          action: "clearBlockSelection",
        },
      ];
    }

    // ── Context: Link (clicked on link mark) ─────────────────
    if (menuState.type === "link") {
      const linkItems: (MenuItemDef | "separator")[] = [
        {
          id: "openLink",
          label: "Open Link",
          icon: <ExternalLink size={13} />,
          action: "openLink",
        },
        {
          id: "copyLink",
          label: "Copy Link",
          icon: <Copy size={13} />,
          action: "copyLink",
        },
        {
          id: "editLink",
          label: "Edit Link",
          shortcut: "⌘L",
          icon: <Link2 size={13} />,
          action: "link",
          disabled: !isEditable,
        },
        {
          id: "removeLink",
          label: "Remove Link",
          icon: <Trash2 size={13} />,
          action: "removeLink",
          disabled: !isEditable,
        },
      ];

      // If text inside link is selected, include formatting / editing
      if (menuState.savedSelection && menuState.savedSelection.from !== menuState.savedSelection.to) {
        linkItems.push("separator");
        linkItems.push({
          id: "copy",
          label: "Copy",
          shortcut: "⌘C",
          icon: <Copy size={13} />,
          action: "copy",
        });
        linkItems.push({
          id: "cut",
          label: "Cut",
          shortcut: "⌘X",
          icon: <Scissors size={13} />,
          action: "cut",
          disabled: !isEditable,
        });
        linkItems.push({
          id: "bold",
          label: "Bold",
          shortcut: "⌘B",
          icon: <Bold size={13} />,
          active: menuState.isBold,
          action: "bold",
          disabled: !isEditable,
        });
        linkItems.push({
          id: "italic",
          label: "Italic",
          shortcut: "⌘I",
          icon: <Italic size={13} />,
          active: menuState.isItalic,
          action: "italic",
          disabled: !isEditable,
        });
      }

      if (menuState.savedSelection.from === menuState.savedSelection.to) linkItems.push(selectAll);
      return linkItems;
    }

    // ── Context: Code Block ──────────────────────────────────
    if (menuState.type === "code-block") {
      return [
        {
          id: "copyCode",
          label: "Copy Code",
          icon: <Copy size={13} />,
          action: "copyCode",
        },
        {
          id: "selectCode",
          label: "Select Code",
          action: "selectCode",
        },
        "separator",
        {
          id: "paste",
          label: "Paste",
          shortcut: getShortcut("paste", "⌘V"),
          icon: <ClipboardPaste size={13} />,
          action: "paste",
          disabled: !isEditable,
        },
        selectAll,
        "separator",
        {
          id: "undo",
          label: "Undo",
          shortcut: getShortcut("undo", "⌘Z"),
          icon: <Undo2 size={13} />,
          action: "undo",
          disabled: !canUndo,
        },
        {
          id: "redo",
          label: "Redo",
          shortcut: getShortcut("redo", "⇧⌘Z"),
          icon: <Redo2 size={13} />,
          action: "redo",
          disabled: !canRedo,
        },
      ];
    }

    // ── Context: Checklist Item ──────────────────────────────
    if (menuState.type === "checklist") {
      return [
        {
          id: "toggleTaskItem",
          label: menuState.taskItemChecked ? "Mark Incomplete" : "Mark Completed",
          icon: <CheckSquare size={13} />,
          active: menuState.taskItemChecked,
          action: "toggleTaskItem",
          disabled: !isEditable,
        },
        "separator",
        {
          id: "paste",
          label: "Paste",
          shortcut: getShortcut("paste", "⌘V"),
          icon: <ClipboardPaste size={13} />,
          action: "paste",
          disabled: !isEditable,
        },
        selectAll,
        "separator",
        {
          id: "undo",
          label: "Undo",
          shortcut: getShortcut("undo", "⌘Z"),
          icon: <Undo2 size={13} />,
          action: "undo",
          disabled: !canUndo,
        },
        {
          id: "redo",
          label: "Redo",
          shortcut: getShortcut("redo", "⇧⌘Z"),
          icon: <Redo2 size={13} />,
          action: "redo",
          disabled: !canRedo,
        },
      ];
    }

    // ── Context: Text Selected (Menu A) ──────────────────────
    if (menuState.type === "text-selected") {
      const items: (MenuItemDef | "separator")[] = [
        {
          id: "cut",
          label: "Cut",
          shortcut: getShortcut("cut", "⌘X"),
          icon: <Scissors size={13} />,
          action: "cut",
          disabled: !isEditable,
        },
        {
          id: "copy",
          label: "Copy",
          shortcut: getShortcut("copy", "⌘C"),
          icon: <Copy size={13} />,
          action: "copy",
        },
        {
          id: "paste",
          label: "Paste",
          shortcut: getShortcut("paste", "⌘V"),
          icon: <ClipboardPaste size={13} />,
          action: "paste",
          disabled: !isEditable,
        },
        "separator",
        {
          id: "link",
          label: menuState.hasLinkInSelection ? "Edit Link" : "Add Link",
          shortcut: "⌘L",
          icon: <Link2 size={13} />,
          action: "link",
          disabled: !isEditable,
        },
      ];

      if (menuState.hasLinkInSelection) {
        items.push({
          id: "removeLink",
          label: "Remove Link",
          icon: <Trash2 size={13} />,
          action: "removeLink",
          disabled: !isEditable,
        });
      }

      items.push(
        "separator",
        {
          id: "bold",
          label: "Bold",
          shortcut: getShortcut("bold", "⌘B"),
          icon: <Bold size={13} />,
          active: menuState.isBold,
          action: "bold",
          disabled: !isEditable,
        },
        {
          id: "italic",
          label: "Italic",
          shortcut: getShortcut("italic", "⌘I"),
          icon: <Italic size={13} />,
          active: menuState.isItalic,
          action: "italic",
          disabled: !isEditable,
        },
        "separator",
        {
          id: "bulletList",
          label: "Bullet List",
          icon: <List size={13} />,
          active: menuState.isBulletList,
          action: "bulletList",
          disabled: !isEditable,
        },
        {
          id: "orderedList",
          label: "Numbered List",
          icon: <ListOrdered size={13} />,
          active: menuState.isOrderedList,
          action: "orderedList",
          disabled: !isEditable,
        },
        {
          id: "taskList",
          label: "Task List",
          icon: <CheckSquare size={13} />,
          active: menuState.isTaskList,
          action: "taskList",
          disabled: !isEditable,
        }
      );

      return items;
    }

    // ── Context: No Selection (Menu B - Compact) ─────────────
    return [
      {
        id: "paste",
        label: "Paste",
        shortcut: getShortcut("paste", "⌘V"),
        icon: <ClipboardPaste size={13} />,
        action: "paste",
        disabled: !isEditable,
      },
      selectAll,
      "separator",
      {
        id: "undo",
        label: "Undo",
        shortcut: getShortcut("undo", "⌘Z"),
        icon: <Undo2 size={13} />,
        action: "undo",
        disabled: !canUndo,
      },
      {
        id: "redo",
        label: "Redo",
        shortcut: getShortcut("redo", "⇧⌘Z"),
        icon: <Redo2 size={13} />,
        action: "redo",
        disabled: !canRedo,
      },
    ];
  }, [menuState, editor, getShortcut]);

  const items = React.useMemo(() => {
    const available = readOnly
      ? contextItems.filter(item => item !== "separator" &&
          ["copy", "copyLink", "copyCode", "openLink", "clearBlockSelection", "selectAll"].includes(item.action ?? ""))
      : contextItems;
    if (!onToggleReadOnly || !menuState || menuState.type === "block-selection" ||
        menuState.savedSelection.from !== menuState.savedSelection.to) return available;

    const toggle: MenuItemDef = {
      id: "toggleReadOnly",
      label: readOnly ? "Enable Editing" : "Make Read-Only",
      icon: readOnly
        ? <Pencil size={13} strokeWidth={2.75} className="text-green-500" aria-hidden="true" />
        : <PencilOff size={13} strokeWidth={2.75} className="text-red-500" aria-hidden="true" />,
      action: "toggleReadOnly",
    };
    return available.length ? [...available, "separator" as const, toggle] : [toggle];
  }, [contextItems, menuState, onToggleReadOnly, readOnly]);

  // Compute constrained screen position using layout measurements
  useLayoutEffect(() => {
    if (!menuState) return;

    const windowWidth = typeof window !== "undefined" ? window.innerWidth : 800;
    const windowHeight = typeof window !== "undefined" ? window.innerHeight : 600;
    const padding = 10;

    const rect = menuRef.current?.getBoundingClientRect();
    const menuWidth = rect && rect.width > 0 ? rect.width : 180;
    const menuHeight = rect && rect.height > 0 ? rect.height : (items.length * 28 + 12);

    let posX = menuState.x;
    let posY = menuState.y;

    // Constrain horizontally within viewport
    if (posX + menuWidth > windowWidth - padding) {
      posX = Math.max(padding, windowWidth - menuWidth - padding);
    }
    if (posX < padding) {
      posX = padding;
    }

    // Constrain vertically within viewport
    if (posY + menuHeight > windowHeight - padding) {
      posY = Math.max(padding, windowHeight - menuHeight - padding);
    }
    if (posY < padding) {
      posY = padding;
    }

    setMenuPosition({ x: posX, y: posY });
    setHighlightedIndex(-1);
  }, [menuState, items.length]);

  // Action dispatcher
  const handleItemClick = useCallback(
    async (item: MenuItemDef) => {
      if (item.disabled) return;
      if (!item.action || !editor || !menuState) return;

      onClose();
      if (item.action === "toggleReadOnly") {
        onToggleReadOnly?.();
        return;
      }
      await executeContextMenuAction(editor, item.action, menuState);
    },
    [editor, menuState, onClose, onToggleReadOnly]
  );

  // Outside click & window dismissal listeners
  useEffect(() => {
    if (!menuState) return;

    const handlePointerDownOutside = (e: MouseEvent | PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (menuRef.current && menuRef.current.contains(target)) return;
      onClose();
    };

    const handleWindowBlur = () => {
      onClose();
    };

    const handleWindowResize = () => {
      onClose();
    };

    const handleScroll = () => {
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDownOutside, { capture: true });
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside, { capture: true });
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [menuState, onClose]);

  // Keyboard navigation
  const selectableItems = React.useMemo(() => {
    return items.filter((item): item is MenuItemDef => item !== "separator" && !item.disabled);
  }, [items]);

  useEffect(() => {
    if (!menuState) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Navigation in primary menu
      if (e.key === "ArrowDown") {
        e.preventDefault();
        ignorePointerRef.current = true;
        setHighlightedIndex((prev) => nextMenuIndex(prev, selectableItems.length, 1, e.repeat));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        ignorePointerRef.current = true;
        setHighlightedIndex((prev) => nextMenuIndex(prev, selectableItems.length, -1, e.repeat));
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (highlightedIndex >= 0 && highlightedIndex < selectableItems.length) {
          e.preventDefault();
          handleItemClick(selectableItems[highlightedIndex]);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [
    menuState,
    highlightedIndex,
    selectableItems,
    handleItemClick,
    onClose,
  ]);

  if (!menuState) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="editor-context-menu"
      style={{
        left: `${menuPosition.x}px`,
        top: `${menuPosition.y}px`,
      }}
      role="menu"
      aria-label="Editor Context Menu"
      onContextMenu={(e) => {
        // Prevent recursive context menus on the context menu itself
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        // Essential: prevent blur on editor and keep selection intact!
        e.preventDefault();
      }}
    >
      {items.map((item, index) => {
        if (item === "separator") {
          return (
            <div
              key={`sep-${index}`}
              className="editor-context-menu-separator"
              role="separator"
            />
          );
        }

        const isHighlighted = selectableItems[highlightedIndex]?.id === item.id;

        const handleItemPointer = (e: React.MouseEvent) => {
          if (ignorePointerRef.current) {
            if (!lastMousePosRef.current) {
              lastMousePosRef.current = { x: e.clientX, y: e.clientY };
              return;
            }
            const dx = Math.abs(e.clientX - lastMousePosRef.current.x);
            const dy = Math.abs(e.clientY - lastMousePosRef.current.y);
            if (dx <= 2 && dy <= 2) {
              return;
            }
            ignorePointerRef.current = false;
          }

          lastMousePosRef.current = { x: e.clientX, y: e.clientY };
          const selIdx = selectableItems.findIndex((s) => s.id === item.id);
          if (selIdx !== -1) setHighlightedIndex(selIdx);
        };

        const commonProps = {
          "data-menu-item-id": item.id,
          role: "menuitem",
          className: `editor-context-menu-item ${isHighlighted ? "is-highlighted" : ""}`,
          onMouseMove: handleItemPointer,
          onMouseEnter: handleItemPointer,
          onMouseOver: handleItemPointer,
          onClick: () => handleItemClick(item),
          onMouseDown: (e: React.MouseEvent) => {
            e.preventDefault();
          },
        };

        const content = (
          <>
            <div className="editor-context-menu-item-left">
              {item.icon && <span className="editor-context-menu-icon">{item.icon}</span>}
              <span className="editor-context-menu-label">{item.label}</span>
            </div>

            <div className="editor-context-menu-item-right">
              {item.active && (
                <span className="editor-context-menu-active-check" title="Active">
                  <Check size={11} strokeWidth={2.8} />
                </span>
              )}
              {item.shortcut && (
                <span className="editor-context-menu-shortcut">{item.shortcut}</span>
              )}
            </div>
          </>
        );

        return (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            {...commonProps}
          >
            {content}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
