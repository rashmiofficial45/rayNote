// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { Editor } from '../Editor';
import { noteCache } from '../../lib/noteCache';
import { invoke } from '@tauri-apps/api/core';
import { flushEditorNow } from '../../lib/db';
import { readActiveNoteSnapshot } from '../../lib/storage';
import { preloadLanguagesForContent } from '../extensions';

vi.mock('../extensions', async importOriginal => {
  const actual = await importOriginal<typeof import('../extensions')>();
  return { ...actual, preloadLanguagesForContent: vi.fn(actual.preloadLanguagesForContent) };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn().mockResolvedValue(undefined), listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: vi.fn().mockResolvedValue(() => {}), listen: vi.fn().mockResolvedValue(() => {}) }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const doc = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] }] });
const version = '2026-11-01T00:00:00Z';
let root: Root;
let host: HTMLDivElement;
let editor: TiptapEditor;

beforeEach(() => {
  vi.useFakeTimers(); noteCache.clear(); localStorage.clear();
  vi.mocked(invoke).mockReset().mockResolvedValue(null);
  vi.mocked(preloadLanguagesForContent).mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); noteCache.clear(); localStorage.clear(); });

describe('Recovery durability and document ownership', () => {
  it('commits a restored dirty snapshot without requiring another edit (B01)', async () => {
    const update = vi.fn().mockResolvedValue('2026-11-03T00:00:00Z');
    noteCache.set('a', doc('Recovered draft'), version, 'Recovered draft', 0, true);
    vi.mocked(invoke).mockImplementation(command => Promise.resolve(command === 'get_note' ? { id: 'a', content: doc('Old database draft'), updated_at: version } : undefined));
    await act(async () => root.render(<Editor noteId="a" noteTitle="Recovered draft" onUpdate={update} onEditorReady={e => { editor = e; }} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(editor.getText()).toBe('Recovered draft');
    expect(update).toHaveBeenCalledWith('a', expect.stringContaining('Recovered draft'), 'Recovered draft');
    expect(readActiveNoteSnapshot()).toMatchObject({ id: 'a', unsaved: false });
  });

  it.each(['reject', 'missing'] as const)('never assigns source content to an unloaded target after a %s response (B02)', async failure => {
    const update = vi.fn().mockResolvedValue('2026-11-03T00:00:00Z');
    const draw = async (id: string) => act(async () => root.render(<Editor noteId={id} noteTitle={id} onUpdate={update} onEditorReady={e => { editor = e; }} />));
    noteCache.set('a', doc('Source document A'), version, 'Source document A');
    vi.mocked(invoke).mockImplementation((command, args: any) => {
      if (command !== 'get_note') return Promise.resolve(undefined);
      if (args.id === 'a') return Promise.resolve({ id: 'a', content: doc('Source document A'), updated_at: version });
      return failure === 'reject' ? Promise.reject(new Error('Database temporarily unavailable')) : Promise.resolve(null);
    });
    await draw('a'); await draw('b');
    act(() => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' new edit'));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(update.mock.calls.some(([id, content]) => id === 'b' && content.includes('Source document A'))).toBe(false);
  });

  it('keeps source cache and persistent recovery if orphan replacement fails (B03)', async () => {
    noteCache.set('orphan', doc('Precious draft'), version, 'Precious draft', 0, true);
    noteCache.persistActiveToLocalStorage('orphan', doc('Precious draft'), version, true);
    const recover = vi.fn().mockRejectedValue(new Error('Disk full'));
    await act(async () => root.render(<Editor noteId="orphan" noteTitle="Precious draft" onUpdate={vi.fn()} onRecoverOrphan={recover} />));
    expect(recover).toHaveBeenCalled();
    expect(noteCache.peek('orphan')?.content).toBe(doc('Precious draft'));
    expect(readActiveNoteSnapshot()).toMatchObject({ id: 'orphan', content: doc('Precious draft'), unsaved: true });
  });

  it('reports a failed explicit flush to lifecycle callers (B07)', async () => {
    noteCache.set('a', doc('Source'), version, 'Source');
    vi.mocked(invoke).mockResolvedValue({ id: 'a', content: doc('Source'), updated_at: version });
    const update = vi.fn().mockRejectedValue(new Error('Disk write failed'));
    await act(async () => root.render(<Editor noteId="a" onUpdate={update} onEditorReady={e => { editor = e; }} />));
    act(() => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' unsaved'));
    await act(async () => { await expect(flushEditorNow()).rejects.toThrow('Disk write failed'); });
    expect(readActiveNoteSnapshot()).toMatchObject({ id: 'a', unsaved: true });
  });

  it('does not let canceled switch completion unlock a newer pending switch', async () => {
    for (const id of ['a', 'b', 'c']) noteCache.set(id, doc(id), version, id);
    vi.mocked(invoke).mockImplementation((_command, args: any) => Promise.resolve({ id: args.id, content: doc(args.id), updated_at: version }));
    const update = vi.fn().mockResolvedValue(version);
    const draw = async (id: string) => act(async () => root.render(<Editor noteId={id} onUpdate={update} onEditorReady={e => { editor = e; }} />));
    await draw('a');
    let finishB!: () => void; let finishC!: () => void;
    vi.mocked(preloadLanguagesForContent).mockImplementation(content => {
      if (content === doc('b')) return new Promise<void>(resolve => { finishB = resolve; });
      if (content === doc('c')) return new Promise<void>(resolve => { finishC = resolve; });
      return Promise.resolve();
    });
    await draw('b'); await draw('c');
    await act(async () => { finishB(); await Promise.resolve(); });
    expect(editor.isEditable).toBe(false);
    await act(async () => { finishC(); await Promise.resolve(); });
    expect(editor.getText()).toBe('c'); expect(editor.isEditable).toBe(true);
  });
});
