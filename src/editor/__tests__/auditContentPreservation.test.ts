// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { Editor } from '@tiptap/core';
import { getExtensions } from '../extensions';
import { markdownToTipTapHtml } from '../markdownUtils';
import { noteContentToMarkdown } from '../../lib/utils';
import { getAllBlocks } from '../../extensions/BlockSelection';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function create(content: string | object = '<p></p>', pasteOptions?: Parameters<typeof getExtensions>[1]) {
  const editor = new Editor({ extensions: getExtensions(undefined, pasteOptions), content });
  editors.push(editor);
  return editor;
}
function paste(editor: Editor, text: string) {
  const event = { clipboardData: { getData: (type: string) => type === 'text/plain' ? text : '', files: [] }, preventDefault() {} } as unknown as ClipboardEvent;
  return !!editor.view.someProp('handlePaste', handler => handler(editor.view, event, null as never));
}

describe('audit content-preservation regressions B03–B08', () => {
  it('B03 retains the complete first pasted line when an auto-title is capped', () => {
    let title = 'Untitled';
    const editor = create('<p></p>', { getCurrentTitle: () => title, onSetTitle: value => { title = value; } });
    const original = 'a'.repeat(160) + ' END';
    paste(editor, original);
    // Either keep the full original line in the body or preserve its overflow there.
    expect(editor.getText().includes(original) || (title + editor.getText()).includes(original)).toBe(true);
  });

  it('B04 does not replace an existing embed during ordinary paste', () => {
    let title = 'Untitled';
    const editor = create({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 } },
      { type: 'iframe', attrs: { src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' } },
      { type: 'paragraph' },
    ] }, { getCurrentTitle: () => title, onSetTitle: value => { title = value; } });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    paste(editor, 'pasted text');
    let embeds = 0;
    editor.state.doc.descendants(node => { if (node.type.name === 'iframe') embeds++; });
    expect(embeds).toBe(1);
    expect(title).toBe('Untitled');
  });

  it.each([1, 2, 3])('B05 preserves H%i text when explicitly inserting a divider', level => {
    const editor = create(`<h${level}>Precious heading</h${level}><p>Body</p>`);
    editor.commands.setTextSelection(4);
    expect(editor.commands.setHorizontalRule()).toBe(true);
    const json: JSONContent = editor.getJSON() as JSONContent;
    expect(json.content?.find(node => node.type === 'heading')?.content?.[0]?.text).toBe('Precious heading');
    expect(json.content?.some(node => node.type === 'horizontalRule')).toBe(true);
  });

  it.each(['bulletList', 'orderedList', 'taskList'])('B06 preserves nested code in a %s Markdown round trip', type => {
    const content = { type: 'doc', content: [{ type, content: [{ type: type === 'taskList' ? 'taskItem' : 'listItem',
      ...(type === 'taskList' ? { attrs: { checked: false } } : {}),
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'parent' }] },
        { type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'line1\nline2' }] }],
    }] }] };
    const markdown = noteContentToMarkdown(JSON.stringify(content), '');
    const editor = create(markdownToTipTapHtml(markdown));
    const lists = (editor.getJSON() as JSONContent).content?.filter(node => node.type === type) || [];
    expect(lists).toHaveLength(1);
    const code = lists[0].content?.[0].content?.find(node => node.type === 'codeBlock');
    expect(code?.content?.[0]?.text?.replace(/\n$/, '')).toBe('line1\nline2');
    expect(editor.getJSON().content?.filter(node => node.type === 'codeBlock')).toHaveLength(0);
  });

  it('B07 indents the block-selected list item, not the stale text caret item', () => {
    const editor = create('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>');
    const blocks = getAllBlocks(editor.state.doc);
    editor.commands.setTextSelection(blocks[1].pos + 2);
    editor.commands.selectBlock(blocks[2].pos);
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, event));
    const items = (editor.getJSON() as JSONContent).content?.[0].content || [];
    expect(items).toHaveLength(2);
    expect(items[0].content).toHaveLength(1);
    expect(items[1].content?.[0]?.content?.[0]?.text).toBe('two');
    expect(items[1].content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('three');
  });

  it('B08 imports mixed ordinary/task items without phantom empty items', () => {
    const editor = create(markdownToTipTapHtml('# Title\n\n- normal\n- [ ] task'));
    const items: Array<{ type: string; text: string }> = [];
    editor.state.doc.descendants(node => {
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') items.push({ type: node.type.name, text: node.textContent });
    });
    expect(items).toEqual([{ type: 'listItem', text: 'normal' }, { type: 'taskItem', text: 'task' }]);
  });
});
