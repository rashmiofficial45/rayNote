// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { getExtensions } from '../extensions';
it('repairs a margin-click text selection between Library and its divider', () => {
  const editor = new Editor({ extensions: getExtensions(), content: '<h1>Library</h1><hr><p>Body</p>' });
  const gap = editor.state.doc.firstChild!.nodeSize;
  const before = editor.getJSON();
  editor.commands.setTextSelection(gap);
  expect(editor.state.selection).toBeInstanceOf(TextSelection);
  expect(editor.state.selection.$from.parent.inlineContent).toBe(true);
  expect(editor.state.selection.from).toBe(gap - 1);
  expect(editor.getJSON()).toEqual(before);
  editor.destroy();
});
