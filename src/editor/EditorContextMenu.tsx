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
  Code2,
  Minus,
  Undo2,
  Redo2,
  Check,
  ExternalLink,
  Trash2,
  Heading1,
  Heading2,
  ChevronRight,
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
}

interface MenuItemDef {
  id: string;
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  action?: string;
  hasSubmenu?: boolean;
  submenuItems?: MenuItemDef[];
}

export function EditorContextMenu({
  editor,
  menuState,
  onClose,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [submenuHighlightedIndex, setSubmenuHighlightedIndex] = useState<number>(-1);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [submenuPosition, setSubmenuPosition] = useState<{
    x: number;
    y: number;
    side: "left" | "right";
  } | null>(null);
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
      setActiveSubmenuId(null);
      setHighlightedIndex(-1);
    }
  }, [editor, menuState]);

  // Build items based on menuState type
  const items: (MenuItemDef | "separator")[] = React.useMemo(() => {
    if (!menuState || !editor) return [];

    const isEditable = editor.isEditable;
    const canUndo = menuState.canUndo;
    const canRedo = menuState.canRedo;

    const insertSubmenu: MenuItemDef = {
      id: "insert",
      label: "Insert",
      hasSubmenu: true,
      submenuItems: [
        {
          id: "insertHeading1",
          label: "Heading 1",
          shortcut: getShortcut("heading1", "⌘⌥1"),
          icon: <Heading1 size={13} />,
          action: "insertHeading1",
        },
        {
          id: "insertHeading2",
          label: "Heading 2",
          shortcut: getShortcut("heading2", "⌘⌥2"),
          icon: <Heading2 size={13} />,
          action: "insertHeading2",
        },
        {
          id: "insertBulletList",
          label: "Bullet List",
          shortcut: getShortcut("bullet_list", "⇧⌘8"),
          icon: <List size={13} />,
          action: "insertBulletList",
        },
        {
          id: "insertOrderedList",
          label: "Numbered List",
          shortcut: getShortcut("ordered_list", "⇧⌘7"),
          icon: <ListOrdered size={13} />,
          action: "insertOrderedList",
        },
        {
          id: "insertChecklist",
          label: "Checklist",
          shortcut: getShortcut("checklist", "⇧⌘9"),
          icon: <CheckSquare size={13} />,
          action: "insertChecklist",
        },
        {
          id: "insertCodeBlock",
          label: "Code Block",
          shortcut: getShortcut("code_block", "⌘⌥C"),
          icon: <Code2 size={13} />,
          action: "insertCodeBlock",
        },
        {
          id: "insertDivider",
          label: "Divider",
          shortcut: getShortcut("divider", "---"),
          icon: <Minus size={13} />,
          action: "insertDivider",
        },
      ],
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
          shortcut: "⌘K",
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
        {
          id: "selectAll",
          label: "Select All",
          shortcut: getShortcut("select_all", "⌘A"),
          action: "selectAll",
        },
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
        {
          id: "insertTaskItem",
          label: "Insert Checklist Item",
          shortcut: "Enter",
          action: "insertTaskItem",
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
        {
          id: "selectAll",
          label: "Select All",
          shortcut: getShortcut("select_all", "⌘A"),
          action: "selectAll",
        },
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
        "separator",
        insertSubmenu,
      ];
    }

    // ── Context: Text Selected (Menu A) ──────────────────────
    if (menuState.type === "text-selected") {
      return [
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
        },
      ];
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
      "separator",
      insertSubmenu,
    ];
  }, [menuState, editor, getShortcut]);

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
    setActiveSubmenuId(null);
  }, [menuState, items.length]);

  // Dynamically compute submenu horizontal side and vertical coordinates
  useLayoutEffect(() => {
    if (!activeSubmenuId || !menuRef.current) {
      setSubmenuPosition(null);
      return;
    }

    const parentItemEl = menuRef.current.querySelector(
      `[data-menu-item-id="${activeSubmenuId}"]`
    ) as HTMLElement | null;
    if (!parentItemEl) {
      setSubmenuPosition(null);
      return;
    }

    const windowWidth = typeof window !== "undefined" ? window.innerWidth : 800;
    const windowHeight = typeof window !== "undefined" ? window.innerHeight : 600;
    const padding = 10;

    const parentRect = parentItemEl.getBoundingClientRect();
    const subRect = submenuRef.current?.getBoundingClientRect();
    const subWidth = subRect && subRect.width > 0 ? subRect.width : 188;
    const subHeight = subRect && subRect.height > 0 ? subRect.height : 240;

    // Determine horizontal side: flip to left if insufficient room on right
    const rightEdge = parentRect.right > 0 ? parentRect.right : menuPosition.x + 180;
    const leftEdge = parentRect.left > 0 ? parentRect.left : menuPosition.x;
    const spaceOnRight = windowWidth - rightEdge - padding;
    const spaceOnLeft = leftEdge - padding;

    let side: "left" | "right" = "right";
    let posX: number;
    if (spaceOnRight >= subWidth || spaceOnRight >= spaceOnLeft) {
      side = "right";
      posX = rightEdge + 4;
    } else {
      side = "left";
      posX = Math.max(padding, leftEdge - subWidth - 4);
    }

    // Determine vertical offset: shift upwards if overflowing viewport bottom
    const topEdge = parentRect.top > 0 ? parentRect.top : menuPosition.y + 60;
    let posY = topEdge - 6;
    if (posY + subHeight > windowHeight - padding) {
      posY = Math.max(padding, windowHeight - subHeight - padding);
    }
    if (posY < padding) {
      posY = padding;
    }

    setSubmenuPosition({ x: posX, y: posY, side });
  }, [activeSubmenuId, menuPosition]);

  // Action dispatcher
  const handleItemClick = useCallback(
    async (item: MenuItemDef) => {
      if (item.disabled) return;
      if (item.hasSubmenu) {
        setActiveSubmenuId((prev) => (prev === item.id ? null : item.id));
        return;
      }
      if (!item.action || !editor || !menuState) return;

      onClose();
      await executeContextMenuAction(editor, item.action, menuState);
    },
    [editor, menuState, onClose]
  );

  // Outside click & window dismissal listeners
  useEffect(() => {
    if (!menuState) return;

    const handlePointerDownOutside = (e: MouseEvent | PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (submenuRef.current && submenuRef.current.contains(target)) return;
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

      // If active in submenu
      if (activeSubmenuId) {
        const parentItem = items.find(
          (i): i is MenuItemDef => i !== "separator" && i.id === activeSubmenuId
        );
        const subItems = parentItem?.submenuItems?.filter((s) => !s.disabled) || [];

        if (e.key === "ArrowDown") {
          e.preventDefault();
          ignorePointerRef.current = true;
          setSubmenuHighlightedIndex((prev) => (prev + 1) % subItems.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          ignorePointerRef.current = true;
          setSubmenuHighlightedIndex((prev) => (prev - 1 + subItems.length) % subItems.length);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          ignorePointerRef.current = true;
          setActiveSubmenuId(null);
          setSubmenuHighlightedIndex(-1);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (submenuHighlightedIndex >= 0 && submenuHighlightedIndex < subItems.length) {
            handleItemClick(subItems[submenuHighlightedIndex]);
          }
          return;
        }
      }

      // Navigation in primary menu
      if (e.key === "ArrowDown") {
        e.preventDefault();
        ignorePointerRef.current = true;
        setHighlightedIndex((prev) => (prev + 1) % selectableItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        ignorePointerRef.current = true;
        setHighlightedIndex((prev) => (prev - 1 + selectableItems.length) % selectableItems.length);
        return;
      }
      if (e.key === "ArrowRight") {
        if (highlightedIndex >= 0 && highlightedIndex < selectableItems.length) {
          const item = selectableItems[highlightedIndex];
          if (item.hasSubmenu) {
            e.preventDefault();
            ignorePointerRef.current = true;
            setActiveSubmenuId(item.id);
            setSubmenuHighlightedIndex(0);
          }
        }
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
    activeSubmenuId,
    highlightedIndex,
    submenuHighlightedIndex,
    selectableItems,
    items,
    handleItemClick,
    onClose,
  ]);

  const activeSubmenuDef = React.useMemo(() => {
    return items.find(
      (i): i is MenuItemDef => i !== "separator" && i.id === activeSubmenuId && Boolean(i.hasSubmenu)
    );
  }, [items, activeSubmenuId]);

  if (!menuState) return null;

  return (
    <>
      {createPortal(
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

            const isSelectedInPrimary = selectableItems[highlightedIndex]?.id === item.id;
            const isSubmenuOpenForThis = activeSubmenuId === item.id;
            // If submenu is actively being navigated by keyboard (submenuHighlightedIndex >= 0),
            // the primary item retains only the subtle open-submenu indicator (.is-submenu-open),
            // NEVER the active navigation highlight (.is-highlighted)!
            const isHighlighted =
              isSelectedInPrimary && (!isSubmenuOpenForThis || submenuHighlightedIndex === -1);
            const isSubmenuOpen = isSubmenuOpenForThis;

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
              if (item.hasSubmenu) {
                setActiveSubmenuId(item.id);
                setSubmenuHighlightedIndex(-1);
              } else {
                setActiveSubmenuId(null);
                setSubmenuHighlightedIndex(-1);
              }
            };

            const commonProps = {
              "data-menu-item-id": item.id,
              role: "menuitem",
              className: `editor-context-menu-item ${isHighlighted ? "is-highlighted" : ""} ${isSubmenuOpen ? "is-submenu-open" : ""}`,
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
                  {item.hasSubmenu && (
                    <span className="editor-context-menu-submenu-arrow">
                      <ChevronRight size={12} strokeWidth={2} />
                    </span>
                  )}
                </div>
              </>
            );

            if (item.hasSubmenu) {
              return (
                <div
                  key={item.id}
                  tabIndex={-1}
                  aria-haspopup="true"
                  aria-expanded={activeSubmenuId === item.id}
                  {...commonProps}
                >
                  {content}
                </div>
              );
            }

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
      )}

      {/* Submenu popout portal rendered into document.body to prevent nesting, transform, or stacking clipping */}
      {activeSubmenuDef && submenuPosition && createPortal(
        <div
          ref={submenuRef}
          className={`editor-context-submenu ${submenuPosition.side === "left" ? "align-left" : "align-right"}`}
          style={{
            position: "fixed",
            left: `${submenuPosition.x}px`,
            top: `${submenuPosition.y}px`,
            zIndex: 10002,
          }}
          role="menu"
          aria-label={`${activeSubmenuDef.label} Submenu`}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {activeSubmenuDef.submenuItems?.map((subItem) => {
            const isSubHighlighted =
              activeSubmenuDef.submenuItems?.filter((s) => !s.disabled)[submenuHighlightedIndex]?.id ===
              subItem.id;

            const handleSubmenuPointer = (e: React.MouseEvent) => {
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
              const sIdx =
                activeSubmenuDef.submenuItems
                  ?.filter((s) => !s.disabled)
                  .findIndex((s) => s.id === subItem.id) ?? -1;
              setSubmenuHighlightedIndex(sIdx);
            };

            return (
              <button
                key={subItem.id}
                type="button"
                role="menuitem"
                disabled={subItem.disabled}
                className={`editor-context-menu-item ${isSubHighlighted ? "is-highlighted" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleItemClick(subItem);
                }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={handleSubmenuPointer}
                onMouseEnter={handleSubmenuPointer}
              >
                <div className="editor-context-menu-item-left">
                  {subItem.icon && (
                    <span className="editor-context-menu-icon">{subItem.icon}</span>
                  )}
                  <span className="editor-context-menu-label">{subItem.label}</span>
                </div>
                <div className="editor-context-menu-item-right">
                  {subItem.shortcut && (
                    <span className="editor-context-menu-shortcut">{subItem.shortcut}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
