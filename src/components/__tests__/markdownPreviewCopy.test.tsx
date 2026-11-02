// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { MarkdownViewerModal } from '../MarkdownViewerModal';
import { copyToClipboard } from '../../lib/clipboard';
vi.mock('../../lib/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(false) }));
vi.mock('../DocumentTickSlider', () => ({ DocumentTickSlider: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
describe('Markdown preview clipboard fallback', () => {
  it('uses the native-capable copy helper and reports failure without a copied success state', async () => {
    const host = document.createElement('div'); const root = createRoot(host); const toast = vi.fn();
    try {
      await act(async () => root.render(<MarkdownViewerModal fileData={{ name: 'note.md', content: '# Note' }} onClose={() => {}} onImportToNotes={() => {}} onShowToast={toast} />));
      await act(async () => (host.querySelector('.md-viewer-copy-btn') as HTMLButtonElement).click());
      expect(copyToClipboard).toHaveBeenCalledWith('# Note');
      expect(toast).toHaveBeenCalledWith('Failed to copy Markdown content to clipboard');
      expect(host.querySelector('.md-viewer-copy-btn')?.textContent).toBe('Copy');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
