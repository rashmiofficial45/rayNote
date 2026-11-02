// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { Editor } from '../Editor';
import { noteCache } from '../../lib/noteCache';
import { invoke } from '@tauri-apps/api/core';
import { discardEditorNote } from '../../lib/db';
import { readActiveNoteSnapshot } from '../../lib/storage';
import { preloadLanguagesForContent } from '../extensions';
vi.mock('../extensions', async importOriginal => {
  const actual = await importOriginal<typeof import('../extensions')>();
  return {...actual, preloadLanguagesForContent: vi.fn(actual.preloadLanguagesForContent)};
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn().mockResolvedValue(undefined), listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: vi.fn().mockResolvedValue(() => {}), listen: vi.fn().mockResolvedValue(() => {}) }) }));
const doc = (text: string) => JSON.stringify({type: 'doc', content: [{type: 'heading', attrs: {level: 1}, content: [{type: 'text', text}]}]});
let root: Root;
let host: HTMLDivElement;
let editor: TiptapEditor;
const render = async (id: string) => { await act(async () => { root.render(<Editor noteId={id} noteTitle={id} onUpdate={vi.fn().mockResolvedValue('2026-11-02')} onEditorReady={e => { editor = e; }} />); await Promise.resolve(); }); };
beforeEach(() => {
  vi.useFakeTimers(); noteCache.clear(); localStorage.clear();
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(preloadLanguagesForContent).mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('Asynchronous editor document guards', () => {
  it('retains edits typed after cached document appears while SQLite revalidation is pending', async () => {
    let resolve!: (note: unknown) => void;
    vi.mocked(invoke).mockImplementation((command) => command === 'get_note' ? new Promise(r => { resolve = r; }) : Promise.resolve(undefined));
    noteCache.set('note-a', doc('Cached title'), '2026-01-01', 'Cached title');
    await render('note-a');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' local edit'); });
    expect(editor.getText()).toContain('local edit');
    await act(async () => { resolve({ id: 'note-a', content: doc('Older database content'), updated_at: '2026-01-02' }); await Promise.resolve(); });
    expect(editor.getText()).toContain('local edit');
  });

  it('retains edits made while a revalidation response is loading code languages', async () => {
    let resolveNote!: (note: unknown) => void;
    vi.mocked(invoke).mockImplementation(command => command === 'get_note' ? new Promise(r => { resolveNote = r; }) : Promise.resolve(undefined));
    noteCache.set('note-a', doc('Cached title'), '2026-01-01', 'Cached title');
    await render('note-a');
    let finishLanguages!: () => void;
    vi.mocked(preloadLanguagesForContent).mockImplementationOnce(() => new Promise<void>(resolve => { finishLanguages = resolve; }));
    await act(async () => { resolveNote({id: 'note-a', content: doc('Older database content'), updated_at: '2026-01-02'}); await Promise.resolve(); });
    act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' new edit'); });
    await act(async () => { finishLanguages(); await Promise.resolve(); });
    expect(editor.getText()).toContain('new edit');
    expect(noteCache.get('note-a')?.content).not.toContain('Older database content');
  });

  it('does not save or recover a deliberately discarded note during debounce or unmount', async () => {
    const onUpdate = vi.fn().mockResolvedValue('2026-11-02');
    noteCache.set('note-a', doc('Cached title'), '2026-01-01', 'Cached title');
    await act(async () => { root.render(<Editor noteId="note-a" noteTitle="a" onUpdate={onUpdate} onEditorReady={e => {editor = e;}} />); });
    act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' edit'); });
    await act(async () => { root.render(<Editor noteId="note-a" noteTitle="a" discardedNoteId="note-a" onUpdate={onUpdate} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('does not erase the newly recovered note snapshot when orphan recovery resolves', async () => {
    noteCache.set('orphan', doc('Unsaved orphan'), '2026-01-01', 'Unsaved orphan', 0, true);
    const recover = vi.fn().mockImplementation(async () => {
      localStorage.setItem('notefast_active_note_id', 'recovered');
      localStorage.setItem('notefast_active_note_content', doc('Recovered text'));
    });
    await act(async () => { root.render(<Editor noteId="orphan" noteTitle="orphan" onUpdate={vi.fn()} onRecoverOrphan={recover} />); });
    expect(recover).toHaveBeenCalled();
    expect(localStorage.getItem('notefast_active_note_id')).toBe('recovered');
    expect(localStorage.getItem('notefast_active_note_content')).toContain('Recovered text');
  });

  it('honors synchronous discard before the last-note editor unmounts', async () => {
    const onUpdate = vi.fn().mockResolvedValue('2026-11-02');
    noteCache.set('note-a', doc('Cached title'), '2026-01-01', 'Cached title');
    await act(async () => { root.render(<Editor noteId="note-a" noteTitle="a" onUpdate={onUpdate} onEditorReady={e => {editor = e;}} />); });
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' edit');
      discardEditorNote('note-a');
      root.render(null);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('persists dirty source recovery before a pending save and preserves it across rejected switching', async () => {
    const contents = {a: doc('Source'), b: doc('Target')};
    for (const [id, content] of Object.entries(contents)) noteCache.set(id, content, '2026-01-01', id);
    vi.mocked(invoke).mockImplementation((command, args: any) => Promise.resolve(command === 'get_note' ? {id: args.id, content: contents[args.id as keyof typeof contents], updated_at: '2026-01-01'} : undefined));
    let rejectSave!: (error: Error) => void;
    const onUpdate = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {rejectSave = reject;}));
    const draw = async (id: string) => { await act(async () => root.render(<Editor noteId={id} noteTitle={id} onUpdate={onUpdate} onEditorReady={e => {editor = e;}} />)); };
    await draw('a');
    act(() => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' unsaved text'));
    await act(async () => {await vi.advanceTimersByTimeAsync(350);});
    expect(readActiveNoteSnapshot()).toMatchObject({id: 'a', unsaved: true});
    expect(readActiveNoteSnapshot()?.content).toContain('unsaved text');
    noteCache.persistActiveToLocalStorage('b', contents.b, '2026-01-01', false);
    expect(readActiveNoteSnapshot()?.id).toBe('a');
    await draw('b');
    await act(async () => {rejectSave(new Error('Write failed')); await Promise.resolve();});
    expect(readActiveNoteSnapshot()?.content).toContain('unsaved text');
    expect(readActiveNoteSnapshot()).toMatchObject({id: 'a', unsaved: true});
  });

  it('publishes target recovery after the outgoing save and target document load finish', async () => {
    const contents = {a: doc('Source'), b: doc('Target')};
    for (const [id, content] of Object.entries(contents)) noteCache.set(id, content, '2026-01-01', id);
    vi.mocked(invoke).mockImplementation((command, args: any) => Promise.resolve(command === 'get_note' ? {id: args.id, content: contents[args.id as keyof typeof contents], updated_at: '2026-01-01'} : undefined));
    let resolveSave!: (updatedAt: string) => void;
    const onUpdate = vi.fn().mockImplementation(() => new Promise(resolve => {resolveSave = resolve;}));
    const draw = async (id: string) => { await act(async () => root.render(<Editor noteId={id} noteTitle={id} onUpdate={onUpdate} onEditorReady={e => {editor = e;}} />)); };
    await draw('a');
    act(() => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' saved text'));
    await act(async () => {await vi.advanceTimersByTimeAsync(350);});
    noteCache.persistActiveToLocalStorage('b', contents.b, '2026-01-01', false);
    await draw('b');
    await act(async () => {resolveSave('2026-01-02'); await Promise.resolve();});
    expect(editor.getText()).toBe('Target');
    expect(readActiveNoteSnapshot()).toMatchObject({id: 'b', content: contents.b, unsaved: false});
  });

  it('keeps newer edits in recovery while the follow-up save is pending', async () => {
    const content = doc('Source');
    noteCache.set('a', content, '2026-01-01', 'Source');
    vi.mocked(invoke).mockImplementation(command => Promise.resolve(command === 'get_note' ? {id: 'a', content, updated_at: '2026-01-01'} : undefined));
    const finishes: Array<(updatedAt: string) => void> = [];
    const onUpdate = vi.fn().mockImplementation(() => new Promise(resolve => {finishes.push(resolve);}));
    await act(async () => root.render(<Editor noteId="a" noteTitle="a" onUpdate={onUpdate} onEditorReady={e => {editor = e;}} />));
    act(() => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' first'));
    await act(async () => {await vi.advanceTimersByTimeAsync(350);});
    act(() => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' newest'));
    await act(async () => {finishes[0]('2026-01-02'); await Promise.resolve();});
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(readActiveNoteSnapshot()).toMatchObject({id: 'a', unsaved: true});
    expect(readActiveNoteSnapshot()?.content).toContain('first newest');
    await act(async () => {finishes[1]('2026-01-03'); await Promise.resolve();});
    expect(readActiveNoteSnapshot()).toMatchObject({id: 'a', unsaved: false});
    expect(readActiveNoteSnapshot()?.content).toContain('first newest');
  });

  it('does not paste an asynchronously read file into another note after switching', async () => {
    noteCache.set('note-a', doc('First'), '2026-01-01', 'First');
    noteCache.set('note-b', doc('Second'), '2026-01-01', 'Second');
    await render('note-a');
    let finish!: (text: string) => void;
    const file = {name: 'pasted.md', type: 'text/markdown', text: () => new Promise<string>(resolve => { finish = resolve; })};
    const event = {clipboardData: {files: [file]}, preventDefault: vi.fn()} as any;
    act(() => { editor.view.someProp('handlePaste', f => f(editor.view, event, null as any)); });
    await render('note-b');
    await act(async () => { finish('# Wrong note content'); await Promise.resolve(); });
    expect(editor.getText()).toBe('Second');
  });
});
