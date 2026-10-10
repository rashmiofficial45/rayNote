import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { cva } from "../lib/utils";
import { sliceToMarkdown } from "../editor/markdownUtils";

export interface BlockSelectionState {
  anchor: number | null;
  head: number | null;
  selectedPositions: number[];
}

export const blockSelectionPluginKey = new PluginKey<BlockSelectionState>("blockSelection");

export const blockSelectionVariants = cva(
  "raynote-block-selected bg-sky-500/15 transition-colors duration-100",
  {
    variants: {
      position: {
        single: "rounded-lg",
        first: "rounded-lg",
        middle: "rounded-lg",
        last: "rounded-lg",
      },
    },
    defaultVariants: {
      position: "single",
    },
  }
);

export interface BlockInfo {
  pos: number;
  node: ProseMirrorNode;
  nodeSize: number;
}

let lastDragEndTime = 0;
export function setLastDragEndTime(time: number) {
  lastDragEndTime = time;
}
export function getLastDragEndTime(): number {
  return lastDragEndTime;
}

/**
 * Returns all selectable blocks in the document in document order:
 * Headings, paragraphs, code blocks, tables, horizontal rules,
 * bullet list items, ordered list items, and task items.
 */
export function getAllBlocks(doc: ProseMirrorNode): BlockInfo[] {
  const blocks: BlockInfo[] = [];

  function traverse(node: ProseMirrorNode, pos: number) {
    const typeName = node.type.name;

    // List containers: traverse into their items (each listItem / taskItem is an individual block)
    if (typeName === "bulletList" || typeName === "orderedList" || typeName === "taskList") {
      let childPos = pos + 1;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        traverse(child, childPos);
        childPos += child.nodeSize;
      }
      return;
    }

    // List items: individual blocks
    if (typeName === "listItem" || typeName === "taskItem") {
      let hasNestedList = false;
      let firstBlockChild: { pos: number; node: ProseMirrorNode; nodeSize: number } | null = null;
      const nestedLists: { node: ProseMirrorNode; pos: number }[] = [];

      let childPos = pos + 1;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        const childTypeName = child.type.name;
        if (
          childTypeName === "bulletList" ||
          childTypeName === "orderedList" ||
          childTypeName === "taskList"
        ) {
          hasNestedList = true;
          nestedLists.push({ node: child, pos: childPos });
        } else if (!firstBlockChild && child.isBlock) {
          firstBlockChild = { pos: childPos, node: child, nodeSize: child.nodeSize };
        }
        childPos += child.nodeSize;
      }

      if (hasNestedList && firstBlockChild) {
        // Push the item's own text content first, then recurse into nested lists
        blocks.push(firstBlockChild);
        for (const nl of nestedLists) {
          traverse(nl.node, nl.pos);
        }
      } else {
        blocks.push({ pos, node, nodeSize: node.nodeSize });
      }
      return;
    }

    // Top-level blocks
    if (node.isBlock) {
      blocks.push({ pos, node, nodeSize: node.nodeSize });
    }
  }

  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    traverse(child, offset);
    offset += child.nodeSize;
  }

  return blocks;
}

/**
 * Resolves which selectable block contains the given document position.
 */
export function findBlockAtPos(doc: ProseMirrorNode, pos: number): BlockInfo | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(Math.min(pos, doc.content.size));

  // Check from innermost ancestor upward for list items
  for (let d = $pos.depth; d >= 1; d--) {
    const n = $pos.node(d);
    if (n.type.name === "listItem" || n.type.name === "taskItem") {
      return {
        pos: $pos.before(d),
        node: n,
        nodeSize: n.nodeSize,
      };
    }
  }

  // Otherwise, use top-level block (depth 1)
  if ($pos.depth >= 1) {
    const topNode = $pos.node(1);
    return {
      pos: $pos.before(1),
      node: topNode,
      nodeSize: topNode.nodeSize,
    };
  }

  return null;
}

/**
 * Scrolls the DOM element for a block into view with ~24px padding buffer.
 */
export function scrollBlockIntoView(
  domNode: HTMLElement | null,
  scrollContainer: HTMLElement | null,
  buffer = 24
) {
  if (!domNode || !scrollContainer) return;
  const nodeRect = domNode.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();

  if (nodeRect.top - buffer < containerRect.top) {
    // Hidden or partially cut off at top
    scrollContainer.scrollTop -= containerRect.top - (nodeRect.top - buffer);
  } else if (nodeRect.bottom + buffer > containerRect.bottom) {
    // Hidden or partially cut off at bottom
    scrollContainer.scrollTop += nodeRect.bottom + buffer - containerRect.bottom;
  }
}

/**
 * Gets the DOM element corresponding to a block at pos in the ProseMirror view.
 */
export function getBlockDom(view: EditorView, pos: number): HTMLElement | null {
  try {
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) return dom;
    const resolved = view.domAtPos(pos + 1);
    let el = resolved.node instanceof HTMLElement ? resolved.node : resolved.node.parentElement;
    while (el && el.parentElement && el.parentElement !== view.dom) {
      if (el.tagName === "LI" || el.classList.contains("notefast-code-block")) {
        return el;
      }
      el = el.parentElement;
    }
    return el || null;
  } catch {
    return null;
  }
}

export function deleteSelectedBlocks(view: EditorView): boolean {
  const state = view.state;
  const pluginState = blockSelectionPluginKey.getState(state);
  if (!pluginState || pluginState.selectedPositions.length === 0) return false;

  const sortedPositions = [...pluginState.selectedPositions].sort((a, b) => b - a); // delete descending
  const minPos = Math.min(...pluginState.selectedPositions);
  let tr = state.tr;

  for (const pos of sortedPositions) {
    const node = tr.doc.nodeAt(pos);
    if (node) {
      tr = tr.delete(pos, pos + node.nodeSize);
    }
  }

  if (tr.doc.childCount === 0 || tr.doc.content.size <= 2) {
    const defaultBlock = state.schema.nodes.paragraph.create();
    tr = tr.insert(0, defaultBlock);
    tr = tr.setSelection(TextSelection.create(tr.doc, 1));
  } else {
    const targetPos = Math.min(minPos, tr.doc.content.size - 1);
    try {
      const $pos = tr.doc.resolve(Math.max(1, targetPos));
      tr = tr.setSelection(Selection.near($pos));
    } catch {
      tr = tr.setSelection(TextSelection.create(tr.doc, Math.max(1, targetPos)));
    }
  }

  tr = tr.setMeta(blockSelectionPluginKey, {
    anchor: null,
    head: null,
    selectedPositions: [],
  });

  view.dispatch(tr);
  view.focus();
  return true;
}

export function duplicateSelectedBlocks(view: EditorView): boolean {
  const state = view.state;
  const pluginState = blockSelectionPluginKey.getState(state);
  if (!pluginState || pluginState.selectedPositions.length === 0) return false;

  const doc = state.doc;
  const sortedPositions = [...pluginState.selectedPositions].sort((a, b) => a - b);
  const nodesToInsert: ProseMirrorNode[] = [];
  let insertPos = 0;

  for (const pos of sortedPositions) {
    const node = doc.nodeAt(pos);
    if (node) {
      nodesToInsert.push(node);
      insertPos = Math.max(insertPos, pos + node.nodeSize);
    }
  }

  if (nodesToInsert.length === 0) return false;

  let tr = state.tr;
  let curPos = insertPos;
  const newPositions: number[] = [];

  for (const node of nodesToInsert) {
    tr = tr.insert(curPos, node);
    newPositions.push(curPos);
    curPos += node.nodeSize;
  }

  tr = tr.setMeta(blockSelectionPluginKey, {
    anchor: newPositions[0],
    head: newPositions[newPositions.length - 1],
    selectedPositions: newPositions,
  });

  view.dispatch(tr);
  return true;
}

export async function copySelectedBlocks(view: EditorView, isCut = false): Promise<boolean> {
  const state = view.state;
  const pluginState = blockSelectionPluginKey.getState(state);
  if (!pluginState || pluginState.selectedPositions.length === 0) return false;

  const doc = state.doc;
  const sortedPositions = [...pluginState.selectedPositions].sort((a, b) => a - b);
  const nodes: ProseMirrorNode[] = [];

  for (const pos of sortedPositions) {
    const node = doc.nodeAt(pos);
    if (node) {
      nodes.push(node);
    }
  }

  if (nodes.length === 0) return false;

  const fragment = Fragment.fromArray(nodes);
  const slice = new Slice(fragment, 0, 0);

  // Serialize to Markdown
  const markdownText = sliceToMarkdown(slice);

  // Serialize to HTML
  let htmlText = "";
  try {
    const dom = DOMSerializer.fromSchema(state.schema).serializeFragment(fragment);
    const div = document.createElement("div");
    div.appendChild(dom);
    htmlText = div.innerHTML;
  } catch {
    htmlText = markdownText;
  }

  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const items: Record<string, Blob> = {
        "text/plain": new Blob([markdownText], { type: "text/plain" }),
      };
      if (htmlText) {
        items["text/html"] = new Blob([htmlText], { type: "text/html" });
      }
      await navigator.clipboard.write([new ClipboardItem(items)]);
    } else {
      await navigator.clipboard.writeText(markdownText);
    }
  } catch (err) {
    console.warn("Failed to write to clipboard:", err);
  }

  if (isCut) {
    deleteSelectedBlocks(view);
  }

  return true;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockSelection: {
      selectBlock: (pos: number) => ReturnType;
      setBlockSelection: (anchor: number | null, head: number | null, positions: number[]) => ReturnType;
      clearBlockSelection: () => ReturnType;
      selectAllBlocks: () => ReturnType;
      deleteSelectedBlocks: () => ReturnType;
      duplicateSelectedBlocks: () => ReturnType;
    };
  }
}

export const BlockSelection = Extension.create({
  name: "blockSelection",

  addCommands() {
    return {
      selectBlock:
        (pos: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(blockSelectionPluginKey, {
              anchor: pos,
              head: pos,
              selectedPositions: [pos],
            });
          }
          return true;
        },

      setBlockSelection:
        (anchor: number | null, head: number | null, positions: number[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(blockSelectionPluginKey, {
              anchor,
              head,
              selectedPositions: [...positions].sort((a, b) => a - b),
            });
          }
          return true;
        },

      clearBlockSelection:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(blockSelectionPluginKey, {
              anchor: null,
              head: null,
              selectedPositions: [],
            });
          }
          return true;
        },

      selectAllBlocks:
        () =>
        ({ tr, state, dispatch }) => {
          const all = getAllBlocks(state.doc);
          if (all.length === 0) return false;
          if (dispatch) {
            tr.setMeta(blockSelectionPluginKey, {
              anchor: all[0].pos,
              head: all[all.length - 1].pos,
              selectedPositions: all.map((b) => b.pos),
            });
          }
          return true;
        },

      deleteSelectedBlocks:
        () =>
        ({ editor }) => {
          return deleteSelectedBlocks(editor.view);
        },

      duplicateSelectedBlocks:
        () =>
        ({ editor }) => {
          return duplicateSelectedBlocks(editor.view);
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin<BlockSelectionState>({
        key: blockSelectionPluginKey,

        state: {
          init(): BlockSelectionState {
            return {
              anchor: null,
              head: null,
              selectedPositions: [],
            };
          },

          apply(tr, prev): BlockSelectionState {
            const meta = tr.getMeta(blockSelectionPluginKey);
            if (meta !== undefined) {
              return meta;
            }

            // If document changed, map selected positions
            if (tr.docChanged && prev.selectedPositions.length > 0) {
              const mapped: number[] = [];
              for (const pos of prev.selectedPositions) {
                const newPos = tr.mapping.map(pos, 1);
                const node = tr.doc.nodeAt(newPos);
                if (node) {
                  mapped.push(newPos);
                }
              }
              const newAnchor = prev.anchor !== null ? tr.mapping.map(prev.anchor, 1) : null;
              const newHead = prev.head !== null ? tr.mapping.map(prev.head, 1) : null;

              return {
                anchor: newAnchor,
                head: newHead,
                selectedPositions: mapped.sort((a, b) => a - b),
              };
            }

            return prev;
          },
        },

        props: {
          decorations(state) {
            const pluginState = blockSelectionPluginKey.getState(state);
            if (!pluginState || pluginState.selectedPositions.length === 0) {
              return DecorationSet.empty;
            }

            const doc = state.doc;
            const allBlocks = getAllBlocks(doc);
            const blockIndexMap = new Map<number, number>();
            allBlocks.forEach((b, idx) => blockIndexMap.set(b.pos, idx));

            const selectedSet = new Set(pluginState.selectedPositions);
            const decorations: Decoration[] = [];

            for (let i = 0; i < pluginState.selectedPositions.length; i++) {
              const pos = pluginState.selectedPositions[i];
              const node = doc.nodeAt(pos);
              if (!node) continue;

              const idx = blockIndexMap.get(pos);
              let hasPrev = false;
              let hasNext = false;

              if (idx !== undefined) {
                if (idx > 0) {
                  hasPrev = selectedSet.has(allBlocks[idx - 1].pos);
                }
                if (idx < allBlocks.length - 1) {
                  hasNext = selectedSet.has(allBlocks[idx + 1].pos);
                }
              }

              let positionVariant: "single" | "first" | "middle" | "last" = "single";
              if (hasPrev && hasNext) {
                positionVariant = "middle";
              } else if (hasNext) {
                positionVariant = "first";
              } else if (hasPrev) {
                positionVariant = "last";
              }

              const className = blockSelectionVariants({ position: positionVariant });

              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: className,
                  "data-block-selected": "true",
                  "data-selection-edge": positionVariant,
                })
              );
            }

            return DecorationSet.create(doc, decorations);
          },

          handleDOMEvents: {
            click(view, event) {
              const target = event.target as HTMLElement | null;
              if (!target) return false;

              // Ignore clicks on task item checkboxes
              if (
                target.tagName === "INPUT" ||
                target.closest('input[type="checkbox"]') ||
                target.closest("label")
              ) {
                return false;
              }

              const pluginState = blockSelectionPluginKey.getState(view.state);
              const isBlockMode = pluginState && pluginState.selectedPositions.length > 0;

              // Shift+Click: extend block selection
              if (event.shiftKey) {
                const clickPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (clickPos) {
                  const block = findBlockAtPos(view.state.doc, clickPos.pos);
                  if (block) {
                    event.preventDefault();
                    event.stopPropagation();
                    const allBlocks = getAllBlocks(view.state.doc);
                    const targetIdx = allBlocks.findIndex((b) => b.pos === block.pos);
                    const anchorPos = pluginState?.anchor ?? block.pos;
                    const anchorIdx = Math.max(
                      0,
                      allBlocks.findIndex((b) => b.pos === anchorPos)
                    );

                    const minIdx = Math.min(anchorIdx, targetIdx);
                    const maxIdx = Math.max(anchorIdx, targetIdx);
                    const rangePositions = allBlocks
                      .slice(minIdx, maxIdx + 1)
                      .map((b) => b.pos);

                    const tr = view.state.tr.setMeta(blockSelectionPluginKey, {
                      anchor: anchorPos,
                      head: block.pos,
                      selectedPositions: rangePositions,
                    });
                    view.dispatch(tr);
                    return true;
                  }
                }
              }

              // ⌘+Click (or Ctrl+Click): toggle single block selection
              if (event.metaKey || event.ctrlKey) {
                const clickPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (clickPos) {
                  const block = findBlockAtPos(view.state.doc, clickPos.pos);
                  if (block) {
                    event.preventDefault();
                    event.stopPropagation();
                    const currentPositions = pluginState?.selectedPositions ?? [];
                    const exists = currentPositions.includes(block.pos);
                    const newPositions = exists
                      ? currentPositions.filter((p) => p !== block.pos)
                      : [...currentPositions, block.pos].sort((a, b) => a - b);

                    const tr = view.state.tr.setMeta(blockSelectionPluginKey, {
                      anchor: newPositions[0] ?? null,
                      head: block.pos,
                      selectedPositions: newPositions,
                    });
                    view.dispatch(tr);
                    return true;
                  }
                }
              }

              // Regular click while in block mode: exit block mode and let normal cursor place
              if (isBlockMode) {
                // If this click is triggered immediately by releasing mouse after dragging, ignore it!
                if (Date.now() - getLastDragEndTime() < 350) {
                  return false;
                }
                const tr = view.state.tr.setMeta(blockSelectionPluginKey, {
                  anchor: null,
                  head: null,
                  selectedPositions: [],
                });
                view.dispatch(tr);
              }

              return false;
            },

            beforeinput(view, event) {
              const pluginState = blockSelectionPluginKey.getState(view.state);
              if (pluginState && pluginState.selectedPositions.length > 0) {
                const inputType = event.inputType;
                if (inputType === "insertText" && event.data) {
                  // Typing printable character exits block mode and starts editing
                  const firstPos = pluginState.selectedPositions[0];
                  let tr = view.state.tr.setMeta(blockSelectionPluginKey, {
                    anchor: null,
                    head: null,
                    selectedPositions: [],
                  });
                  try {
                    const $pos = tr.doc.resolve(Math.min(firstPos + 1, tr.doc.content.size));
                    tr = tr.setSelection(Selection.near($pos));
                  } catch {
                    tr = tr.setSelection(TextSelection.create(tr.doc, firstPos + 1));
                  }
                  tr = tr.insertText(event.data);
                  view.dispatch(tr);
                  event.preventDefault();
                  return true;
                }
                event.preventDefault();
                return true;
              }
              return false;
            },
          },

          handleKeyDown(view, event) {
            const { state, dispatch } = view;
            const pluginState = blockSelectionPluginKey.getState(state);
            const isBlockMode = Boolean(
              pluginState && pluginState.selectedPositions.length > 0
            );

            const scrollContainer = (view.dom.closest("[data-scroll-container]") ||
              view.dom.parentElement) as HTMLElement | null;

            // ── Esc ─────────────────────────────────────────────────────────
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();

              if (isBlockMode) {
                // Esc again -> exit block mode
                const tr = state.tr.setMeta(blockSelectionPluginKey, {
                  anchor: null,
                  head: null,
                  selectedPositions: [],
                });
                dispatch(tr);
                view.focus();
                return true;
              }

              // Esc while cursor in a block -> select that block
              const block = findBlockAtPos(state.doc, state.selection.from);
              if (block) {
                const tr = state.tr.setMeta(blockSelectionPluginKey, {
                  anchor: block.pos,
                  head: block.pos,
                  selectedPositions: [block.pos],
                });
                dispatch(tr);
                return true;
              }
              return false;
            }

            // ── Progressive ⌘A ──────────────────────────────────────────────
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
              const allBlocks = getAllBlocks(state.doc);
              if (allBlocks.length === 0) return false;

              // Step 3: if in block mode and 1 block or subset selected -> select ALL blocks
              if (isBlockMode && pluginState) {
                if (pluginState.selectedPositions.length < allBlocks.length) {
                  event.preventDefault();
                  event.stopPropagation();
                  const tr = state.tr.setMeta(blockSelectionPluginKey, {
                    anchor: allBlocks[0].pos,
                    head: allBlocks[allBlocks.length - 1].pos,
                    selectedPositions: allBlocks.map((b) => b.pos),
                  });
                  dispatch(tr);
                  return true;
                }
                // Already all selected
                event.preventDefault();
                return true;
              }

              // Step 1 or Step 2: cursor in text
              const currentBlock = findBlockAtPos(state.doc, state.selection.from);
              if (currentBlock) {
                const textStart = currentBlock.pos + 1;
                const textEnd = currentBlock.pos + currentBlock.nodeSize - 1;

                const isAllTextInBlockSelected =
                  state.selection.from === textStart && state.selection.to === textEnd;

                if (!isAllTextInBlockSelected && textEnd > textStart) {
                  // Step 1: select text inside the block
                  event.preventDefault();
                  event.stopPropagation();
                  const tr = state.tr.setSelection(
                    TextSelection.create(state.doc, textStart, textEnd)
                  );
                  dispatch(tr);
                  return true;
                }

                // Step 2: select the block itself
                event.preventDefault();
                event.stopPropagation();
                const tr = state.tr.setMeta(blockSelectionPluginKey, {
                  anchor: currentBlock.pos,
                  head: currentBlock.pos,
                  selectedPositions: [currentBlock.pos],
                });
                dispatch(tr);
                return true;
              }
            }

            // If NOT in block mode, let standard shortcuts handle
            if (!isBlockMode || !pluginState) return false;

            // ── In Block Selection Mode ────────────────────────────────────

            // ── Backspace / Delete ─────────────────────────────────────────
            if (event.key === "Backspace" || event.key === "Delete") {
              event.preventDefault();
              event.stopPropagation();
              return deleteSelectedBlocks(view);
            }

            // ── ⌘D: Duplicate ──────────────────────────────────────────────
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
              event.preventDefault();
              event.stopPropagation();
              return duplicateSelectedBlocks(view);
            }

            // ── ⌘C: Copy ───────────────────────────────────────────────────
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
              event.preventDefault();
              event.stopPropagation();
              copySelectedBlocks(view, false);
              return true;
            }

            // ── ⌘X: Cut ────────────────────────────────────────────────────
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "x") {
              event.preventDefault();
              event.stopPropagation();
              copySelectedBlocks(view, true);
              return true;
            }

            // ── Tab / Shift+Tab (Indent / Outdent list items) ──────────────
            if (event.key === "Tab") {
              event.preventDefault();
              event.stopPropagation();
              if (event.shiftKey) {
                editor.commands.liftListItem("listItem") ||
                  editor.commands.liftListItem("taskItem");
              } else {
                editor.commands.sinkListItem("listItem") ||
                  editor.commands.sinkListItem("taskItem");
              }
              return true;
            }

            // ── Arrow Keys (Shift+↑/↓, ↑/↓) ────────────────────────────────
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              event.stopPropagation();

              const allBlocks = getAllBlocks(state.doc);
              if (allBlocks.length === 0) return true;

              const headPos = pluginState.head ?? allBlocks[0].pos;
              const anchorPos = pluginState.anchor ?? allBlocks[0].pos;

              let headIdx = allBlocks.findIndex((b) => b.pos === headPos);
              if (headIdx === -1) headIdx = 0;
              let anchorIdx = allBlocks.findIndex((b) => b.pos === anchorPos);
              if (anchorIdx === -1) anchorIdx = 0;

              const isDown = event.key === "ArrowDown";

              if (event.shiftKey) {
                // Extend / shrink selection range
                const nextHeadIdx = isDown
                  ? Math.min(allBlocks.length - 1, headIdx + 1)
                  : Math.max(0, headIdx - 1);

                const minIdx = Math.min(anchorIdx, nextHeadIdx);
                const maxIdx = Math.max(anchorIdx, nextHeadIdx);
                const range = allBlocks.slice(minIdx, maxIdx + 1).map((b) => b.pos);
                const nextHeadPos = allBlocks[nextHeadIdx].pos;

                const tr = state.tr.setMeta(blockSelectionPluginKey, {
                  anchor: anchorPos,
                  head: nextHeadPos,
                  selectedPositions: range,
                });
                dispatch(tr);

                const headDom = getBlockDom(view, nextHeadPos);
                scrollBlockIntoView(headDom, scrollContainer, 24);
                return true;
              } else {
                // Move selection to previous / next block
                const nextIdx = isDown
                  ? Math.min(allBlocks.length - 1, headIdx + 1)
                  : Math.max(0, headIdx - 1);

                const nextPos = allBlocks[nextIdx].pos;
                const tr = state.tr.setMeta(blockSelectionPluginKey, {
                  anchor: nextPos,
                  head: nextPos,
                  selectedPositions: [nextPos],
                });
                dispatch(tr);

                const dom = getBlockDom(view, nextPos);
                scrollBlockIntoView(dom, scrollContainer, 24);
                return true;
              }
            }

            // ── Printable character typed in block mode ─────────────────────
            if (
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              event.key.length === 1
            ) {
              event.preventDefault();
              event.stopPropagation();

              const firstPos = pluginState.selectedPositions[0];
              let tr = state.tr.setMeta(blockSelectionPluginKey, {
                anchor: null,
                head: null,
                selectedPositions: [],
              });

              try {
                const $pos = tr.doc.resolve(Math.min(firstPos + 1, tr.doc.content.size));
                tr = tr.setSelection(Selection.near($pos));
              } catch {
                tr = tr.setSelection(TextSelection.create(tr.doc, firstPos + 1));
              }

              tr = tr.insertText(event.key);
              dispatch(tr);
              view.focus();
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
