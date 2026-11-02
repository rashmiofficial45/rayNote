// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SearchExtension } from '../searchExtension';
let editor: Editor;
afterEach(() => editor?.destroy());
function setup(html: string) { editor = new Editor({extensions: [StarterKit, SearchExtension], content: html}); return editor; }
describe('Search and replacement regressions', () => {
  it('replaces without dispatching a mismatched nested transaction and treats text literally', () => {
    setup('<p>cat cat</p>'); editor.commands.setSearchTerm('cat');
    expect(() => editor.commands.replaceCurrentResult('<b>dog</b>')).not.toThrow();
    expect(editor.getText()).toBe('<b>dog</b> cat');
  });
  it('replaces all non-overlapping occurrences', () => {
    setup('<p>aaaaa</p>'); editor.commands.setSearchTerm('aa');
    expect(() => editor.commands.replaceAllResults('b')).not.toThrow();
    expect(editor.getText()).toBe('bba');
  });
  it('refreshes match positions synchronously before replace after typing', () => {
    setup('<p>cat dog</p>'); editor.commands.setSearchTerm('dog');
    editor.commands.insertContentAt(1, 'new ');
    editor.commands.replaceCurrentResult('fox');
    expect(editor.getText()).toBe('new cat fox');
  });
  it('finds a phrase spanning mark boundaries', () => {
    setup('<p>hello <strong>world</strong></p>'); editor.commands.setSearchTerm('hello world');
    expect((editor.storage as any).search.results).toHaveLength(1);
    editor.commands.replaceAllResults('goodbye');
    expect(editor.getText()).toBe('goodbye');
  });
  it('does not mutate search state or document when checking can()', () => {
    setup('<p>cat cat</p>'); editor.commands.setSearchTerm('cat');
    const before = JSON.stringify((editor.storage as any).search);
    editor.can().nextSearchResult(); editor.can().replaceAllResults('dog'); editor.can().setSearchTerm('dog');
    expect(JSON.stringify((editor.storage as any).search)).toBe(before);
    expect(editor.getText()).toBe('cat cat');
  });
});
