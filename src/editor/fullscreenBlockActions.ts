import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { blockSelectionPluginKey, type BlockInfo } from "../extensions/BlockSelection";

export function isNoteTitle(block: BlockInfo): boolean {
  return block.pos === 0 && block.node.type.name === "heading" && block.node.attrs.level === 1;
}

export function getBlockSiblings(doc: ProseMirrorNode, pos: number): BlockInfo[] {
  const resolved = doc.resolve(pos);
  const siblings: BlockInfo[] = [];
  resolved.parent.forEach((node, offset) => {
    siblings.push({ pos: resolved.start() + offset, node, nodeSize: node.nodeSize });
  });
  return siblings;
}

export function insertAdjacentBlock(editor: Editor, block: BlockInfo, above: boolean): void {
  const { state, view } = editor;
  if (!editor.isEditable || state.doc.nodeAt(block.pos) !== block.node) return;
  const pos = above && !isNoteTitle(block) ? block.pos : block.pos + block.nodeSize;
  const isItem = block.node.type.name === "listItem" || block.node.type.name === "taskItem";
  const node = (isItem ? block.node.type : state.schema.nodes.paragraph).createAndFill();
  const resolved = state.doc.resolve(pos);
  if (!node || !resolved.parent.canReplaceWith(resolved.index(), resolved.index(), node.type)) return;

  const tr = closeHistory(state.tr).insert(pos, node);
  tr.setSelection(Selection.near(tr.doc.resolve(pos + 1), 1));
  tr.setMeta(blockSelectionPluginKey, { anchor: null, head: null, selectedPositions: [] });
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export function moveBlockToBoundary(editor: Editor, block: BlockInfo, boundary: number): boolean {
  const { state, view } = editor;
  const end = block.pos + block.nodeSize;
  if (!editor.isEditable || isNoteTitle(block) || state.doc.nodeAt(block.pos) !== block.node ||
      boundary === block.pos || boundary === end) return false;

  const source = state.doc.resolve(block.pos);
  const target = state.doc.resolve(boundary);
  if (source.parent !== target.parent || source.start() !== target.start() || target.textOffset ||
      (boundary === 0 && state.doc.firstChild?.type.name === "heading" && state.doc.firstChild.attrs.level === 1) ||
      !source.parent.canReplace(source.index(), source.index() + 1) ||
      !target.parent.canReplaceWith(target.index(), target.index(), block.node.type)) return false;

  const tr = closeHistory(state.tr).delete(block.pos, end);
  const destination = tr.mapping.map(boundary);
  tr.insert(destination, block.node);
  tr.setSelection(Selection.near(tr.doc.resolve(destination + 1), 1));
  tr.setMeta(blockSelectionPluginKey, { anchor: null, head: null, selectedPositions: [] });
  view.dispatch(tr);
  view.focus();
  return true;
}
