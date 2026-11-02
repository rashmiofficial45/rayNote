// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingCodeBlockToolbar } from '../FloatingCodeBlockToolbar';
import { ensureLanguageLoaded } from '../extensions';
import { copyToClipboard } from '../../lib/clipboard';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../extensions', () => ({ensureLanguageLoaded: vi.fn().mockResolvedValue(true)}));
vi.mock('../../lib/clipboard', () => ({copyToClipboard: vi.fn().mockResolvedValue(true)}));
let host: HTMLDivElement;
let root: Root;
let editor: Editor;
beforeEach(async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => ({})});
  vi.mocked(ensureLanguageLoaded).mockReset().mockResolvedValue(true);
  vi.mocked(copyToClipboard).mockClear();
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: vi.fn().mockResolvedValue(true)}});
  host = document.createElement('div'); document.body.append(host);
  const editorHost = document.createElement('div'); host.append(editorHost);
  editor = new Editor({element: editorHost, extensions: [StarterKit], content: '<pre><code>original code</code></pre>'});
  const toolbarHost = document.createElement('div'); host.append(toolbarHost); root = createRoot(toolbarHost);
  await act(async () => root.render(<FloatingCodeBlockToolbar editor={editor} scrollContainerRef={{current: host}} />));
  act(() => editor.commands.setTextSelection(3));
});
afterEach(() => {act(() => root.unmount()); editor.destroy(); host.remove(); vi.restoreAllMocks();});
describe('Code toolbar asynchronous boundaries', () => {
  it('uses the shared native clipboard fallback helper', async () => {
    const button = host.querySelector('[aria-label="Copy code"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => button.click());
    expect(copyToClipboard).toHaveBeenCalledWith('original code');
  });
  it('does not change another document after a language load resolves', async () => {
    act(() => (host.querySelector('[aria-label="Select code block language"]') as HTMLButtonElement).click());
    let finish!: (value: boolean) => void;
    vi.mocked(ensureLanguageLoaded).mockImplementationOnce(() => new Promise<boolean>(resolve => {finish = resolve;}));
    const python = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Python'))!;
    act(() => python.click());
    act(() => editor.commands.setContent('<pre><code>other note code</code></pre>'));
    await act(async () => {finish(true); await Promise.resolve();});
    expect(editor.state.doc.firstChild?.attrs.language).toBeNull();
    expect(editor.getText().trim()).toBe('other note code');
  });
});
