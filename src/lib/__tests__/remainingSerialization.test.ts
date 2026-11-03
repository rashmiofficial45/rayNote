// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { noteContentToMarkdown, noteContentToPlainText } from '../utils';
const doc = (inline: unknown[]) => JSON.stringify({ type: 'doc', content: [{type: 'paragraph', content: inline}] });
const text = (value: string, marks?: unknown[]) => ({type: 'text', text: value, ...(marks ? { marks } : {})});
const rendered = (markdown: string) => { const div = document.createElement('div'); div.innerHTML = marked.parse(markdown, {async:false}) as string; return div; };
describe('remaining serialization regressions', () => {
  it('retains an explicit metadata-only title in whole-note Markdown', () => {
    const html = rendered(noteContentToMarkdown(doc([text('Body text')]), 'Metadata title'));
    expect(html.querySelector('h1')?.textContent).toBe('Metadata title');
    expect(html.querySelector('p')?.textContent).toBe('Body text');
  });
  it('does not turn literal Markdown punctuation into formatting on export', () => {
    const original = '**literal** and [literal](https://example.com)';
    const html = rendered(noteContentToMarkdown(doc([text(original)]), ''));
    expect(html.querySelector('p')?.textContent).toBe(original);
    expect(html.querySelector('strong, a')).toBeNull();
  });
  it('preserves backticks inside an inline code mark', () => {
    const original = 'value `with` backticks';
    const html = rendered(noteContentToMarkdown(doc([text(original, [{type:'code'}])]), ''));
    expect(html.querySelector('code')?.textContent).toBe(original);
  });
  it('preserves hard line breaks in plain-text copy', () => {
    expect(noteContentToPlainText(doc([text('first'), {type:'hardBreak'}, text('second')]))).toBe('first\nsecond');
  });
  it('preserves literal tilde delimiters without creating strike formatting', () => {
    const original = '~~literal~~';
    const html = rendered(noteContentToMarkdown(doc([text(original)]), ''));
    expect(html.querySelector('p')?.textContent).toBe(original);
    expect(html.querySelector('del')).toBeNull();
  });
  it('preserves a closing parenthesis in a link destination', () => {
    const target = 'https://example.com/a)';
    const html = rendered(noteContentToMarkdown(doc([text('link', [{type:'link',attrs:{href:target}}])]), ''));
    expect(decodeURI(html.querySelector('a')?.getAttribute('href') || '')).toBe(target);
    expect(html.querySelector('p')?.textContent).toBe('link');
  });
  it('retains bold formatting and surrounding whitespace in marked text', () => {
    const html = rendered(noteContentToMarkdown(doc([text('Before'), text(' bold ', [{type:'bold'}]), text('after')]), ''));
    expect(html.querySelector('strong')?.textContent.trim()).toBe('bold');
    expect(html.querySelector('p')?.textContent).toBe('Before bold after');
  });

});

describe('selected Markdown structure', () => {
  it('keeps multiple paragraphs distinct inside a quote', () => {
    const value = JSON.stringify({type:'doc',content:[{type:'blockquote',content:[{type:'paragraph',content:[text('first')]},{type:'paragraph',content:[text('second')]}]}]});
    expect(rendered(noteContentToMarkdown(value, '')).querySelectorAll('blockquote p')).toHaveLength(2);
  });
});
