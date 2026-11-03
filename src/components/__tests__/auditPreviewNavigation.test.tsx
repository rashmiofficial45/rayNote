// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { MarkdownViewerModal } from '../MarkdownViewerModal';
import { openUrl } from '@tauri-apps/plugin-opener';
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/db', () => ({ openSettingsWindow: vi.fn() }));
vi.mock('../DocumentTickSlider', () => ({ DocumentTickSlider: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Audit preview navigation boundary', () => {
  it('opens an HTTPS preview link externally without replacing the app context (R03)', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<MarkdownViewerModal fileData={{ name: 'links.md', content: '[Documentation](https://example.com/docs)' }} onClose={() => {}} onImportToNotes={() => {}} />));
      const anchor = host.querySelector('a')!;
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      // Prevent jsdom from attempting real navigation after collecting whether
      // the application canceled it first.
      
      document.addEventListener('click', e => { e.preventDefault(); }, { once: true });
      await act(async () => anchor.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(openUrl).toHaveBeenCalledWith('https://example.com/docs');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
