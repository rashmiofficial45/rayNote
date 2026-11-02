// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { MarkdownViewerModal } from '../MarkdownViewerModal';
vi.mock('../../lib/db', () => ({ openSettingsWindow: vi.fn() }));
vi.mock('../DocumentTickSlider', () => ({ DocumentTickSlider: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Markdown preview untrusted HTML boundary', () => {
  it('preserves formatting but strips executable HTML, event handlers and unsafe links', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<MarkdownViewerModal
        fileData={{ name: 'external.md', content: '# Heading\n\n**Bold**\n\n<img src="x" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">bad</a><iframe srcdoc="<script>alert(1)</script>"></iframe>' }}
        onClose={() => {}} onImportToNotes={() => {}} />));
      expect(host.querySelector('strong')?.textContent).toBe('Bold');
      expect(host.querySelector('script, iframe, [onerror]')).toBeNull();
      expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
