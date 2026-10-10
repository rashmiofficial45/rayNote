import { describe, it, expect } from 'vitest';
import { sliceToMarkdown, isMarkdownContent, markdownToTipTapHtml } from '../markdownUtils';

describe('Markdown Serialization & Clipboard Utilities (Test C)', () => {
  describe('isMarkdownContent detector', () => {
    it('detects headings as markdown', () => {
      expect(isMarkdownContent('# Hello World')).toBe(true);
      expect(isMarkdownContent('### Section Title')).toBe(true);
    });

    it('detects task lists as markdown', () => {
      expect(isMarkdownContent('- [ ] Todo item')).toBe(true);
      expect(isMarkdownContent('- [x] Completed task')).toBe(true);
    });

    it('detects code blocks as markdown', () => {
      expect(isMarkdownContent('```js\nconsole.log(1);\n```')).toBe(true);
    });

    it('detects blockquotes and horizontal rules', () => {
      expect(isMarkdownContent('> Famous quote')).toBe(true);
      expect(isMarkdownContent('---')).toBe(true);
    });

    it('identifies regular plain text without markdown markup', () => {
      expect(isMarkdownContent('This is just normal sentences without formatting.')).toBe(false);
      expect(isMarkdownContent('Grocery list: milk, eggs, bread')).toBe(false);
    });
  });

  describe('markdownToTipTapHtml parser', () => {
    it('converts markdown tasks into TipTap task items with checked state', () => {
      const md = '- [x] Ship v1.0\n- [ ] Write docs';
      const html = markdownToTipTapHtml(md);
      expect(html).toContain('data-type="taskList"');
      expect(html).toContain('data-type="taskItem"');
      expect(html).toContain('data-checked="true"');
      expect(html).toContain('data-checked="false"');
    });

    it('converts markdown headings and bold into HTML elements', () => {
      const md = '# Main Header\n\n**Important** note';
      const html = markdownToTipTapHtml(md);
      expect(html).toContain('<h1>Main Header</h1>');
      expect(html).toContain('<strong>Important</strong>');
    });
  });

  describe('sliceToMarkdown serializer', () => {
    // Mock minimal ProseMirror node structures to verify AST serialization without requiring browser DOM
    function mockTextNode(text: string, marks: any[] = []) {
      return {
        isText: true,
        text,
        marks,
      };
    }

    function mockBlockNode(type: string, content: any[] = [], attrs: Record<string, any> = {}) {
      return {
        isBlock: true,
        isText: false,
        type: { name: type },
        attrs,
        content: {
          childCount: content.length,
          child: (i: number) => content[i],
        },
      };
    }

    it('serializes headings with correct markdown prefix (# / ## / ###)', () => {
      const h1 = mockBlockNode('heading', [mockTextNode('Level 1')], { level: 1 });
      const h2 = mockBlockNode('heading', [mockTextNode('Level 2')], { level: 2 });
      const slice = { content: { size: 2, childCount: 2, child: (i: number) => [h1, h2][i] } } as any;

      const md = sliceToMarkdown(slice);
      expect(md).toContain('# Level 1');
      expect(md).toContain('## Level 2');
    });

    it('serializes text marks (bold, italic, strike, inline code, link)', () => {
      const p = mockBlockNode('paragraph', [
        mockTextNode('plain '),
        mockTextNode('bold', [{ type: { name: 'bold' } }]),
        mockTextNode(' and '),
        mockTextNode('italic', [{ type: { name: 'italic' } }]),
        mockTextNode(' and '),
        mockTextNode('code', [{ type: { name: 'code' } }]),
        mockTextNode(' and '),
        mockTextNode('link', [{ type: { name: 'link' }, attrs: { href: 'https://raynote.app' } }]),
      ]);
      const slice = { content: { size: 1, childCount: 1, child: () => p } } as any;

      const md = sliceToMarkdown(slice);
      expect(md).toContain('**bold**');
      expect(md).toContain('*italic*');
      expect(md).toContain('`code`');
      expect(md).toContain('[link](https://raynote.app)');
    });

    it('serializes task lists with checked and unchecked states', () => {
      const t1 = mockBlockNode('taskItem', [mockBlockNode('paragraph', [mockTextNode('Task 1')])], { checked: true });
      const t2 = mockBlockNode('taskItem', [mockBlockNode('paragraph', [mockTextNode('Task 2')])], { checked: false });
      const taskList = mockBlockNode('taskList', [t1, t2]);
      const slice = { content: { size: 1, childCount: 1, child: () => taskList } } as any;

      const md = sliceToMarkdown(slice);
      expect(md).toContain('- [x] Task 1');
      expect(md).toContain('- [ ] Task 2');
    });

    it('serializes code blocks with language tag', () => {
      const codeNode = {
        isBlock: true,
        isText: false,
        type: { name: 'codeBlock' },
        attrs: { language: 'typescript' },
        textContent: 'const x: number = 42;',
        content: { childCount: 0, child: () => null },
      };
      const slice = { content: { size: 1, childCount: 1, child: () => codeNode } } as any;

      const md = sliceToMarkdown(slice);
      expect(md).toContain('```typescript\nconst x: number = 42;\n```');
    });

    it('serializes blockquotes and horizontal rules', () => {
      const bq = mockBlockNode('blockquote', [mockBlockNode('paragraph', [mockTextNode('Quoted insight')])]);
      const hr = mockBlockNode('horizontalRule', []);
      const slice = { content: { size: 2, childCount: 2, child: (i: number) => [bq, hr][i] } } as any;

      const md = sliceToMarkdown(slice);
      expect(md).toContain('> Quoted insight');
      expect(md).toContain('---');
    });

    it('serializes tables with headers and markdown column separators', () => {
      const th1 = mockBlockNode('tableHeader', [mockTextNode('Col A')]);
      const th2 = mockBlockNode('tableHeader', [mockTextNode('Col B')]);
      const r1 = mockBlockNode('tableRow', [th1, th2]);

      const td1 = mockBlockNode('tableCell', [mockTextNode('Val 1')]);
      const td2 = mockBlockNode('tableCell', [mockTextNode('Val 2')]);
      const r2 = mockBlockNode('tableRow', [td1, td2]);

      const table = mockBlockNode('table', [r1, r2]);
      const slice = { content: { size: 1, childCount: 1, child: () => table } } as any;

      const md = sliceToMarkdown(slice);
      expect(md).toContain('| Col A | Col B |');
      expect(md).toContain('| --- | --- |');
      expect(md).toContain('| Val 1 | Val 2 |');
    });
  });
});
