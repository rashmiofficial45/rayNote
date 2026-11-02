import { describe, expect, it } from 'vitest';
import { noteContentToMarkdown } from '../../lib/utils';
import { sliceToMarkdown } from '../markdownUtils';
import { marked } from 'marked';
const text = (value: string) => ({type: 'text', text: value});
const pmText = (value: string) => ({isText: true, text: value, type: {name: 'text'}, marks: []});
const pmNode = (name: string, children: any[] = [], attrs = {}, textContent = '') => ({isText: false, type: {name}, attrs, textContent, content: {childCount: children.length, child: (i: number) => children[i]}});
const slice = (node: any) => ({content: {size: 1, childCount: 1, child: () => node}} as any);
describe('Markdown export content integrity', () => {
  it.each(['```\ninside\n```', 'before\n````\ninside\n````\nafter'])('escapes code fences for document export and clipboard fallback', code => {
    const json = JSON.stringify({type: 'doc', content: [{type: 'codeBlock', attrs: {language: 'markdown'}, content: [text(code)]}]});
    const copied = sliceToMarkdown(slice(pmNode('codeBlock', [], {language: 'markdown'}, code)));
    for (const markdown of [noteContentToMarkdown(json), copied]) {
      const tokens = marked.lexer(markdown);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('code');
      expect((tokens[0] as any).text).toBe(code);
    }
  });
  it('preserves hard line breaks in document and clipboard fallback serializers', () => {
    const json = JSON.stringify({type: 'doc', content: [{type: 'paragraph', content: [text('first'), {type: 'hardBreak'}, text('second')]}]});
    const copied = sliceToMarkdown(slice(pmNode('paragraph', [pmText('first'), pmNode('hardBreak'), pmText('second')])));
    for (const markdown of [noteContentToMarkdown(json), copied]) {
      expect(markdown).toContain('first  \nsecond');
    }
  });
});
