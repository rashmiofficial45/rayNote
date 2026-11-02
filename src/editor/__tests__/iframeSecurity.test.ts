// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { IframeExtension, normalizeEmbedUrl } from '../iframeExtension';
let editor: Editor;
afterEach(() => editor?.destroy());
function setup(content: string | object = '<p>text</p>') { editor = new Editor({extensions: [StarterKit, IframeExtension], content}); }
describe('Iframe embed boundary', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/private', ' JaVaScRiPt:alert(1)'])('rejects unsafe URL %s', url => {
    expect(normalizeEmbedUrl(url)).toBe('');
  });
  it('normalizes actual YouTube hosts without rewriting lookalike hosts', () => {
    expect(normalizeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=2')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?t=2');
    expect(normalizeEmbedUrl('https://evil.example/youtube.com/embed/dQw4w9WgXcQ')).toBe('https://evil.example/youtube.com/embed/dQw4w9WgXcQ');
  });
  it('rejects unsafe command insertion and unsafe pasted HTML', () => {
    setup();
    expect(editor.commands.setIframe({src: 'javascript:alert(1)'})).toBe(false);
    editor.commands.setContent('<iframe src="javascript:alert(1)"></iframe>');
    expect(editor.getHTML()).not.toContain('<iframe');
  });
  it('removes unsafe stored URLs and isolates embedded pages from app origin', () => {
    setup({type: 'doc', content: [{type: 'iframe', attrs: {src: 'javascript:alert(1)'}}]});
    expect(editor.getHTML()).not.toContain('javascript:');
    editor.commands.setContent('<p>text</p>');
    editor.commands.setIframe({src: 'https://example.com/embed'});
    const doc = new DOMParser().parseFromString(editor.getHTML(), 'text/html');
    const frame = doc.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });
});
