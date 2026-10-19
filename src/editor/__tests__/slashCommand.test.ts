import { describe, it, expect } from 'vitest';
import { SlashCommand } from '../SlashCommand';

describe('SlashCommand item filtering and ranking', () => {
  const getItems = (SlashCommand.options as any).suggestion.items;

  it('returns all items with Heading 1 first when query is empty', () => {
    const items = getItems({ query: '' });
    expect(items.length).toBeGreaterThan(5);
    expect(items[0].title).toBe('Heading 1');
    expect(items[1].title).toBe('Heading 2');
  });

  it('does NOT contain video embed option in any query or list', () => {
    const all = getItems({ query: '' });
    const titles = all.map((i: any) => i.title.toLowerCase());
    expect(titles.some((t: string) => t.includes('video') || t.includes('embed') || t.includes('iframe'))).toBe(false);
  });

  it('matches only relevant options for query "t" (Task List, Text, Table) and excludes Heading 1', () => {
    const items = getItems({ query: 't' });
    const titles = items.map((i: any) => i.title);
    expect(titles).toContain('Task List');
    expect(titles).toContain('Text');
    expect(titles).toContain('Table');
    expect(titles).not.toContain('Heading 1');
    expect(titles).not.toContain('Quote');
    expect(titles).not.toContain('Code Block');
  });

  it('matches only relevant options for query "b" (Bold, Bullet List) and excludes Task List, Quote, Code Block', () => {
    const items = getItems({ query: 'b' });
    const titles = items.map((i: any) => i.title);
    expect(titles).toContain('Bold');
    expect(titles).toContain('Bullet List');
    expect(titles).not.toContain('Task List');
    expect(titles).not.toContain('Quote');
    expect(titles).not.toContain('Code Block');
  });

  it('matches only Numbered List when query is "n"', () => {
    const items = getItems({ query: 'n' });
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Numbered List');
  });

  it('matches Numbered List when query is "number" or "num"', () => {
    const itemsNumber = getItems({ query: 'number' });
    expect(itemsNumber.length).toBe(1);
    expect(itemsNumber[0].title).toBe('Numbered List');

    const itemsNum = getItems({ query: 'num' });
    expect(itemsNum.length).toBe(1);
    expect(itemsNum[0].title).toBe('Numbered List');
  });

  it('does NOT match Heading 1, 2, or 3 for query "n"', () => {
    const items = getItems({ query: 'n' });
    const titles = items.map((i: any) => i.title);
    expect(titles).not.toContain('Heading 1');
    expect(titles).not.toContain('Heading 2');
    expect(titles).not.toContain('Heading 3');
  });

  it('matches Heading 2 for query "h2"', () => {
    const items = getItems({ query: 'h2' });
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Heading 2');
  });

  it('matches Italic for query "em" and does not match video embed', () => {
    const items = getItems({ query: 'em' });
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Italic');
  });
});
