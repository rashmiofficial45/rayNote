import { describe, it, expect, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { findBlockAtPos, deleteSelectedBlocks } from '../../extensions/BlockSelection';
import { handleDeleteLineOrBlock } from '../shortcutsExtension';

describe('Command + Backspace (Line & Formatting Deletion) Tests', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'text*' },
      heading: { group: 'block', content: 'text*', attrs: { level: { default: 1 } } },
      taskList: { group: 'block', content: 'taskItem+' },
      taskItem: { content: 'paragraph', attrs: { checked: { default: false } } },
      bulletList: { group: 'block', content: 'listItem+' },
      listItem: { content: 'paragraph' },
      blockquote: { group: 'block', content: 'paragraph+' },
      codeBlock: { group: 'block', content: 'text*' },
      text: { inline: true },
    },
  });

  function createMockView(state: EditorState): EditorView {
    let currentState = state;
    return {
      get state() {
        return currentState;
      },
      dispatch: vi.fn((tr) => {
        currentState = currentState.apply(tr);
      }),
      focus: vi.fn(),
    } as unknown as EditorView;
  }

  describe('findBlockAtPos resolution', () => {
    it('resolves heading block at position', () => {
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.heading.create({ level: 1 }, [schema.text('Hello Heading')]),
      ]);
      const block = findBlockAtPos(doc, 3);
      expect(block).not.toBeNull();
      expect(block?.pos).toBe(0);
      expect(block?.node.type.name).toBe('heading');
    });

    it('resolves taskItem block at position within taskList', () => {
      const item1 = schema.nodes.taskItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Task 1')]),
      ]);
      const item2 = schema.nodes.taskItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Task 2')]),
      ]);
      const taskList = schema.nodes.taskList.create(null, [item1, item2]);
      const doc = schema.nodes.doc.create(null, [taskList]);

      const item2Pos = 1 + item1.nodeSize;
      const block = findBlockAtPos(doc, item2Pos + 2);
      expect(block).not.toBeNull();
      expect(block?.pos).toBe(item2Pos);
      expect(block?.node.type.name).toBe('taskItem');
    });

    it('resolves doc depth 0 to the first block', () => {
      const heading = schema.nodes.heading.create(null, [schema.text('First')]);
      const doc = schema.nodes.doc.create(null, [heading]);
      const block = findBlockAtPos(doc, 0);
      expect(block).not.toBeNull();
      expect(block?.pos).toBe(0);
      expect(block?.node.type.name).toBe('heading');
    });
  });

  describe('deleteSelectedBlocks with explicitPositions', () => {
    it('deletes heading and preserves following paragraph', () => {
      const heading = schema.nodes.heading.create(null, [schema.text('Delete Me')]);
      const paragraph = schema.nodes.paragraph.create(null, [schema.text('Keep Me')]);
      const doc = schema.nodes.doc.create(null, [heading, paragraph]);
      const state = EditorState.create({ schema, doc });
      const view = createMockView(state);

      const result = deleteSelectedBlocks(view as any, [0]);
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();

      // Only the paragraph should remain
      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.child(0).type.name).toBe('paragraph');
      expect(view.state.doc.child(0).textContent).toBe('Keep Me');
    });

    it('deletes only the targeted task item when taskList has multiple items', () => {
      const item1 = schema.nodes.taskItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Task 1')]),
      ]);
      const item2 = schema.nodes.taskItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Task 2')]),
      ]);
      const taskList = schema.nodes.taskList.create(null, [item1, item2]);
      const doc = schema.nodes.doc.create(null, [taskList]);
      const state = EditorState.create({ schema, doc });
      const view = createMockView(state);

      const item2Pos = 1 + item1.nodeSize;
      const result = deleteSelectedBlocks(view as any, [item2Pos]);
      expect(result).toBe(true);

      const list = view.state.doc.child(0);
      expect(list.type.name).toBe('taskList');
      expect(list.childCount).toBe(1);
      expect(list.child(0).textContent).toBe('Task 1');
    });

    it('deletes the entire taskList container when deleting the sole task item', () => {
      const item = schema.nodes.taskItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Only Task')]),
      ]);
      const taskList = schema.nodes.taskList.create(null, [item]);
      const paragraph = schema.nodes.paragraph.create(null, [schema.text('Other text')]);
      const doc = schema.nodes.doc.create(null, [taskList, paragraph]);
      const state = EditorState.create({ schema, doc });
      const view = createMockView(state);

      // item pos is 1 (inside taskList)
      const result = deleteSelectedBlocks(view as any, [1]);
      expect(result).toBe(true);

      // Entire taskList container must be gone
      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.child(0).type.name).toBe('paragraph');
      expect(view.state.doc.child(0).textContent).toBe('Other text');
    });

    it('replaces document with empty heading 1 (default title) when all blocks are deleted', () => {
      const heading = schema.nodes.heading.create(null, [schema.text('Only Title')]);
      const doc = schema.nodes.doc.create(null, [heading]);
      const state = EditorState.create({ schema, doc });
      const view = createMockView(state);

      const result = deleteSelectedBlocks(view as any, [0]);
      expect(result).toBe(true);

      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.child(0).type.name).toBe('heading');
      expect(view.state.doc.child(0).attrs.level).toBe(1);
      expect(view.state.doc.child(0).textContent).toBe('');
    });

    it('clears title bar line text while maintaining heading 1 on Cmd+Backspace', () => {
      const heading = schema.nodes.heading.create({ level: 1 }, [schema.text('Title Text to Clear')]);
      const paragraph = schema.nodes.paragraph.create(null, [schema.text('Body text')]);
      const doc = schema.nodes.doc.create(null, [heading, paragraph]);
      let state = EditorState.create({ schema, doc });
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, 3))); // inside title text
      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);

      // Title line should be empty heading 1, body paragraph preserved
      expect(view.state.doc.child(0).type.name).toBe('heading');
      expect(view.state.doc.child(0).attrs.level).toBe(1);
      expect(view.state.doc.child(0).textContent).toBe('');
      expect(view.state.doc.child(1).type.name).toBe('paragraph');
      expect(view.state.doc.child(1).textContent).toBe('Body text');
    });

    it('places cursor on the same line (the block that shifted up) after deleting a middle line', () => {
      const p1 = schema.nodes.paragraph.create(null, [schema.text('Line 1')]);
      const p2 = schema.nodes.paragraph.create(null, [schema.text('Line 2')]);
      const p3 = schema.nodes.paragraph.create(null, [schema.text('Line 3')]);
      const doc = schema.nodes.doc.create(null, [p1, p2, p3]);

      const p2Pos = p1.nodeSize; // 8
      let state = EditorState.create({ schema, doc });
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, p2Pos + 2)));
      const view = createMockView(state);

      const result = deleteSelectedBlocks(view as any, [p2Pos]);
      expect(result).toBe(true);

      // Doc should have 2 children: Line 1 and Line 3
      expect(view.state.doc.childCount).toBe(2);
      expect(view.state.doc.child(0).textContent).toBe('Line 1');
      expect(view.state.doc.child(1).textContent).toBe('Line 3');

      // Cursor must be inside the block that shifted up to Line 2 position (Line 3), NOT Line 1
      const selection = view.state.selection;
      const $from = selection.$from;
      expect($from.parent.textContent).toBe('Line 3');
    });
  });

  describe('handleDeleteLineOrBlock on multi-line codeBlock', () => {
    it('deletes the active line in a multi-line code block', () => {
      const codeBlock = schema.nodes.codeBlock.create(null, [
        schema.text('const a = 1;\nconst b = 2;\nconst c = 3;'),
      ]);
      const doc = schema.nodes.doc.create(null, [codeBlock]);

      // Offset inside "const b = 2;" is at position 1 + 13 + 3 = 17
      let state = EditorState.create({ schema, doc });
      const bPos = doc.textContent.indexOf('const b = 2;');
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1 + bPos + 2)));

      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);
      expect(view.state.doc.textContent).toContain('const a = 1;');
      expect(view.state.doc.textContent).toContain('const c = 3;');
      expect(view.state.doc.textContent).not.toContain('const b = 2;');
    });
  });

  describe('handleDeleteLineOrBlock same-line cursor row preservation', () => {
    it('clears middle paragraph and keeps cursor on that same line row (does not jump back)', () => {
      const p1 = schema.nodes.paragraph.create(null, [schema.text('Line 1')]);
      const p2 = schema.nodes.paragraph.create(null, [schema.text('Line 2')]);
      const p3 = schema.nodes.paragraph.create(null, [schema.text('Line 3')]);
      const doc = schema.nodes.doc.create(null, [p1, p2, p3]);

      const p2Pos = p1.nodeSize; // 8
      let state = EditorState.create({ schema, doc });
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, p2Pos + 2)));
      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);

      // Line 2 becomes empty paragraph, Line 1 and Line 3 remain unchanged
      expect(view.state.doc.childCount).toBe(3);
      expect(view.state.doc.child(0).textContent).toBe('Line 1');
      expect(view.state.doc.child(1).textContent).toBe('');
      expect(view.state.doc.child(2).textContent).toBe('Line 3');

      // Cursor must stay on Line 2 (empty paragraph), NOT jump to Line 1
      const selection = view.state.selection;
      expect(selection.$from.parent.textContent).toBe('');
      expect(selection.$from.pos).toBe(p2Pos + 1);
    });

    it('clears last paragraph and keeps cursor on that same line row (does not jump back)', () => {
      const p1 = schema.nodes.paragraph.create(null, [schema.text('Line 1')]);
      const p2 = schema.nodes.paragraph.create(null, [schema.text('Last Line')]);
      const doc = schema.nodes.doc.create(null, [p1, p2]);

      const p2Pos = p1.nodeSize;
      let state = EditorState.create({ schema, doc });
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, p2Pos + 2)));
      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);

      // Last line becomes empty paragraph
      expect(view.state.doc.childCount).toBe(2);
      expect(view.state.doc.child(0).textContent).toBe('Line 1');
      expect(view.state.doc.child(1).textContent).toBe('');

      // Cursor must stay on the last line, NOT jump back to Line 1
      const selection = view.state.selection;
      expect(selection.$from.parent.textContent).toBe('');
      expect(selection.$from.pos).toBe(p2Pos + 1);
    });

    it('clears task item formatting and text, leaving empty paragraph on that line row', () => {
      const heading = schema.nodes.heading.create({ level: 1 }, [schema.text('Title')]);
      const item1 = schema.nodes.taskItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Task 1')]),
      ]);
      const item2 = schema.nodes.taskItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Task 2')]),
      ]);
      const taskList = schema.nodes.taskList.create(null, [item1, item2]);
      const doc = schema.nodes.doc.create(null, [heading, taskList]);

      // Put cursor inside item2 ("Task 2")
      const item2Pos = heading.nodeSize + 1 + item1.nodeSize;
      let state = EditorState.create({ schema, doc });
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, item2Pos + 2)));
      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);

      // Document has Heading, Task 1, and an empty paragraph
      expect(view.state.doc.childCount).toBe(3);
      expect(view.state.doc.child(0).textContent).toBe('Title');
      expect(view.state.doc.child(1).type.name).toBe('taskList');
      expect(view.state.doc.child(2).type.name).toBe('paragraph');
      expect(view.state.doc.child(2).textContent).toBe('');

      // Cursor must be inside the empty paragraph on that same line row
      const selection = view.state.selection;
      expect(selection.$from.parent.textContent).toBe('');
      expect(selection.$from.parent.type.name).toBe('paragraph');
    });
  });

  describe('handleDeleteLineOrBlock cursor at first position behavior', () => {
    it('deletes empty line and moves cursor to the end of the previous line when at offset 0', () => {
      const p1 = schema.nodes.paragraph.create(null, [schema.text('Line 1')]);
      const p2 = schema.nodes.paragraph.create(null, []);
      const doc = schema.nodes.doc.create(null, [p1, p2]);

      const p2Pos = p1.nodeSize; // 8
      let state = EditorState.create({ schema, doc });
      // Cursor at offset 0 of empty p2 (position 9)
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, p2Pos + 1)));
      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);

      // p2 should be deleted
      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.child(0).textContent).toBe('Line 1');

      // Cursor must be at the end of Line 1
      const selection = view.state.selection;
      expect(selection.$from.parent.textContent).toBe('Line 1');
      expect(selection.$from.pos).toBe(7); // end of "Line 1"
    });

    it('deletes empty line following a list and moves cursor into the previous list item', () => {
      const item1 = schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, [
          schema.nodes.paragraph.create(null, [schema.text('Bullet item')]),
        ]),
      ]);
      const p = schema.nodes.paragraph.create(null, []);
      const doc = schema.nodes.doc.create(null, [item1, p]);

      const pPos = item1.nodeSize;
      let state = EditorState.create({ schema, doc });
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, pPos + 1)));
      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);

      // Empty paragraph deleted, doc only has the list
      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.child(0).type.name).toBe('bulletList');

      // Cursor at the end of the previous bullet item
      const selection = view.state.selection;
      expect(selection.$from.parent.textContent).toBe('Bullet item');
    });

    it('deletes empty list item and moves cursor to the end of the previous item', () => {
      const heading = schema.nodes.heading.create({ level: 1 }, [schema.text('Title')]);
      const item1 = schema.nodes.listItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('Item 1')]),
      ]);
      const item2 = schema.nodes.listItem.create(null, [
        schema.nodes.paragraph.create(null, []),
      ]);
      const list = schema.nodes.bulletList.create(null, [item1, item2]);
      const doc = schema.nodes.doc.create(null, [heading, list]);

      const item2Pos = heading.nodeSize + 1 + item1.nodeSize;
      let state = EditorState.create({ schema, doc });
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, item2Pos + 2)));
      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);

      // List has only 1 item left
      const resultList = view.state.doc.child(1);
      expect(resultList.childCount).toBe(1);
      expect(resultList.child(0).textContent).toBe('Item 1');

      // Cursor inside Item 1
      const selection = view.state.selection;
      expect(selection.$from.parent.textContent).toBe('Item 1');
    });

    it('joins non-empty line into previous line when cursor is at offset 0', () => {
      const p1 = schema.nodes.paragraph.create(null, [schema.text('Line 1')]);
      const p2 = schema.nodes.paragraph.create(null, [schema.text('Line 2')]);
      const doc = schema.nodes.doc.create(null, [p1, p2]);

      const p2Pos = p1.nodeSize; // 8
      let state = EditorState.create({ schema, doc });
      // Cursor at offset 0 of p2 (pos 9)
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, p2Pos + 1)));
      const view = createMockView(state);
      const mockEditor = { view };

      const handled = handleDeleteLineOrBlock(mockEditor);
      expect(handled).toBe(true);

      // Merged into Line 1Line 2
      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.child(0).textContent).toBe('Line 1Line 2');
      // Cursor at junction point in the merged line (pos 7)
      expect(view.state.selection.from).toBe(7);
    });
  });
});
