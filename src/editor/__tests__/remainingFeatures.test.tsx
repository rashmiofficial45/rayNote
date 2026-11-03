// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {getExtensions, scanCodeBlockLanguages, ensureLanguageLoaded} from '../extensions';
import {copySelectedBlocks, serializeSelectedBlocks} from '../../extensions/BlockSelection';
import {smartToggleBlockFormat} from '../formatMemory';
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
});
