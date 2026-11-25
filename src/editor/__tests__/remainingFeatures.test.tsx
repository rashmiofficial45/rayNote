// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {getExtensions, scanCodeBlockLanguages, ensureLanguageLoaded} from '../extensions';
import {copySelectedBlocks, serializeSelectedBlocks} from '../../extensions/BlockSelection';
import {smartToggleBlockFormat} from '../formatMemory';
import {markdownToTipTapHtml} from '../markdownUtils';
import {DocumentTickSlider} from '../../components/DocumentTickSlider';
import {createRoot} from 'react-dom/client';
import {act} from 'react';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn().mockRejectedValue(new Error('clipboard denied'))}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn().mockResolvedValue(()=>{}),emit:vi.fn().mockResolvedValue(undefined)}));
const editors: Editor[] = [];
const makeEditor = (content: string | object) => { const editor = new Editor({extensions:getExtensions(),content}); editors.push(editor); return editor; };
afterEach(()=>{editors.splice(0).forEach(e=>e.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.querySelectorAll('textarea').forEach(n=>n.remove());});
describe('remaining editor feature regressions',()=>{
 it('discovers code languages in a live ProseMirror document',()=>{
  const editor=makeEditor({type:'doc',content:[{type:'codeBlock',attrs:{language:'python'},content:[{type:'text',text:'print(1)'}]}]});
  expect(scanCodeBlockLanguages(editor.state.doc)).toEqual(['python']);
 });
 it.each(['swift','kotlin','php','ruby'])('loads the grammar offered in the picker for %s',async language=>{
  expect(await ensureLanguageLoaded(language)).toBe(true);
 });
 it('supports safe iframe and YouTube nodes in the active schema',()=>{
  const editor=makeEditor('<p>Text</p>');
  expect(editor.schema.nodes.iframe).toBeDefined(); expect(editor.schema.nodes.youtube).toBeDefined();
 });
 it('keeps selected content when all clipboard paths reject',async()=>{
  const editor=makeEditor('<p>Precious text</p><p>Keep</p>'); editor.commands.setBlockSelection(0,0,[0]);
  const old=(document as any).execCommand; (document as any).execCommand=()=>{throw new Error('denied')};
  const clip=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
  try { await Promise.resolve(copySelectedBlocks(editor.view,true)); expect(editor.getText()).toContain('Precious text'); }
  finally { (document as any).execCommand=old; if(clip)Object.defineProperty(navigator,'clipboard',clip); else delete (navigator as any).clipboard; }
 });
 it('always removes the temporary clipboard textarea after an exception',async()=>{
  const editor=makeEditor('<p>Precious text</p>'); editor.commands.setBlockSelection(0,0,[0]);
  const old=(document as any).execCommand;(document as any).execCommand=()=>{throw new Error('denied')};
  const clip=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
  const before=document.querySelectorAll('textarea').length;
  try {await Promise.resolve(copySelectedBlocks(editor.view,false));expect(document.querySelectorAll('textarea').length).toBe(before);}
  finally {(document as any).execCommand=old;if(clip)Object.defineProperty(navigator,'clipboard',clip);else delete (navigator as any).clipboard;}
 });
 it('does not restore another editor\'s remembered block format',()=>{
  const first=makeEditor('<h2>First</h2>');first.commands.setTextSelection(1);smartToggleBlockFormat(first,'codeBlock');
  const second=makeEditor('<pre><code>Second</code></pre>');second.commands.setTextSelection(1);smartToggleBlockFormat(second,'codeBlock');
  expect(second.isActive('paragraph')).toBe(true);expect(second.isActive('heading',{level:2})).toBe(false);
 });
});

describe('selected list clipboard structure', () => {
 it('preserves an ordered list item and its source numbering',()=>{
  const editor=makeEditor('<ol start="4"><li><p>first</p></li><li><p>second</p></li></ol>');
  const second = 1 + editor.state.doc.firstChild!.firstChild!.nodeSize;
  editor.commands.setBlockSelection(second,second,[second]);
  expect(serializeSelectedBlocks(editor.state)?.markdownText).toContain('5. second');
 });

 it('updates scroll ticks without remeasuring the note on ordinary scroll', async () => {
  const container = document.createElement('div');
  container.appendChild(document.createElement('div'));
  const host = document.createElement('div');
  document.body.append(container, host);
  const root = createRoot(host);
  const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  let resize: (() => void) | undefined;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });

  let nextFrame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => { nextFrame = undefined; });
  let contentHeight = 1200;
  const readContentHeight = vi.fn(() => contentHeight);
  Object.defineProperty(container, 'scrollHeight', { get: readContentHeight });
  Object.defineProperty(container, 'clientHeight', { value: 400 });

  try {
    await act(async () => root.render(<DocumentTickSlider scrollContainerRef={{ current: container }} />));
    const ticks = Array.from(host.querySelectorAll('.doc-tick-item'));
    const activeTick = () => ticks.findIndex(tick => tick.classList.contains('is-active'));
    expect(activeTick()).toBe(0);

    readContentHeight.mockClear();
    await act(async () => {
      container.scrollTop = 800;
      container.dispatchEvent(new Event('scroll'));
      nextFrame?.(0);
    });
    expect(activeTick()).toBe(ticks.length - 1);
    expect(readContentHeight).not.toHaveBeenCalled();

    await act(async () => {
      contentHeight = 2000;
      resize?.();
    });
    expect(activeTick()).toBe(Math.round((ticks.length - 1) / 2));
    expect(readContentHeight).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    host.remove();
    container.remove();
  }
 });

});

describe('remaining selected block and task regressions',()=>{
 it('formats only disjoint selected blocks and toggles them back',()=>{
  const e=makeEditor('<p>one</p><p>two</p><p>three</p>');
  e.commands.setBlockSelection(0,10,[0,10]);smartToggleBlockFormat(e,'heading1');
  expect(e.getJSON().content!.map(n=>n.type)).toEqual(['heading','paragraph','heading']);
  smartToggleBlockFormat(e,'heading1');
  expect(e.getJSON().content!.map(n=>n.type)).toEqual(['paragraph','paragraph','paragraph']);
 });
 it('retains nested tasks and paragraph order after actual editor parsing',()=>{
  const html=markdownToTipTapHtml('# Title\n\n- [ ] parent\n  - [x] child\n\n  after nested list');
  const e=makeEditor(html);const tasks:any[]=[];
  e.state.doc.descendants(n=>{if(n.type.name==='taskItem')tasks.push(n)});
  expect(e.getText()).toContain('child');expect(e.getText()).toContain('after nested list');
  expect(tasks.map(n=>n.attrs.checked)).toEqual([false,true]);
  expect(tasks[0].content.content.map((n:any)=>n.type.name)).toEqual(['paragraph','taskList','paragraph']);
 });
 it('preserves paragraphs in selected task Markdown',()=>{
  const e=makeEditor('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>first</p><p>second</p></div></li></ul>');
  e.commands.setBlockSelection(1,1,[1]);const copy=serializeSelectedBlocks(e.state)!;
  expect(copy.markdownText).toContain('[x]');
  const roundtrip=makeEditor(markdownToTipTapHtml(copy.markdownText));
  const paras:string[]=[];roundtrip.state.doc.descendants(n=>{if(n.type.name==='paragraph')paras.push(n.textContent)});
  expect(paras).toEqual(['first','second']);
 });
 it.each(['bulletList','orderedList','taskList'] as const)('toggles disjoint %s selections off without changing the intervening block',target=>{
  const e=makeEditor('<p>one</p><p>two</p><p>three</p>');
  e.commands.setBlockSelection(0,10,[0,10]);smartToggleBlockFormat(e,target);
  expect(e.getJSON().content!.map(n=>n.type)).toEqual([target,'paragraph',target]);
  smartToggleBlockFormat(e,target);
  expect(e.getJSON().content!.map(n=>n.type)).toEqual(['paragraph','paragraph','paragraph']);
  expect(e.getText()).toBe('one\n\ntwo\n\nthree');
 });

 it('does not toggle already-formatted blocks off in a mixed selection',()=>{
  const e=makeEditor('<h1>one</h1><p>two</p><p>three</p>');
  e.commands.setBlockSelection(0,10,[0,10]);smartToggleBlockFormat(e,'heading1');
  expect(e.getJSON().content!.map(n=>n.type)).toEqual(['heading','paragraph','heading']);
 });
 it('keeps an unselected existing list item when adjacent selected blocks are toggled on and off',()=>{
  const e=makeEditor('<p>one</p><ul><li><p>two</p></li></ul><p>three</p>');
  const last=e.state.doc.content.size-e.state.doc.lastChild!.nodeSize;
  e.commands.setBlockSelection(0,last,[0,last]);smartToggleBlockFormat(e,'bulletList');
  smartToggleBlockFormat(e,'bulletList');
  expect(e.getJSON().content!.map(n=>n.type)).toEqual(['paragraph','bulletList','paragraph']);
  expect(e.state.doc.child(1).textContent).toBe('two');
 });

});
