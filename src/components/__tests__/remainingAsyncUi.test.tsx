// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {getExtensions} from '../../editor/extensions';
import {FindBar} from '../FindBar';
import {MarkdownViewerModal} from '../MarkdownViewerModal';
import {SwitchConflictModal} from '../SwitchConflictModal';
vi.mock('../DocumentTickSlider',()=>({DocumentTickSlider:()=>null}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn().mockResolvedValue(()=>{}),emit:vi.fn().mockResolvedValue(undefined)}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement;let root:Root;let editor:Editor|undefined;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());editor?.destroy();editor=undefined;host.remove();vi.restoreAllMocks();});
describe('remaining async UI contracts',()=>{
 it('reapplies the retained Find query when reopened without a selection',async()=>{
  editor=new Editor({extensions:getExtensions(),content:'<p>fox fox</p>'});
  const draw=async(open:boolean)=>act(async()=>root.render(<FindBar isOpen={open} onClose={()=>{}} editor={editor!}/>));
  await draw(true);const input=host.querySelector('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'fox');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect((editor.storage as any).search.results).toHaveLength(2);
  await draw(false);editor.commands.setTextSelection(1);await draw(true);
  expect((host.querySelector('input') as HTMLInputElement).value).toBe('fox');expect((editor.storage as any).search.results).toHaveLength(2);
 });
 it('keeps Quick View open until its asynchronous import succeeds',async()=>{
  let finish!:(value?:unknown)=>void;const close=vi.fn();const start=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>root.render(<MarkdownViewerModal fileData={{name:'note.md',content:'# Test'}} onClose={close} onImportToNotes={start}/>));
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Import to Notes'))!;
  await act(async()=>button.click());expect(start).toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
  await act(async()=>finish());expect(close).toHaveBeenCalledTimes(1);
 });
 it('does not display copied success after an asynchronous clipboard failure',async()=>{
  const copy=vi.fn().mockResolvedValue(false);
  await act(async()=>root.render(<SwitchConflictModal conflict={{failedNoteId:'a',content:'content',text:'text'}} onSaveAsNewNote={()=>{}} onCopyText={copy} onDiscardAndSwitch={()=>{}} onClose={()=>{}}/>));
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Copy text'))!;
  await act(async()=>button.click());expect(copy).toHaveBeenCalled();expect(host.textContent).not.toContain('Copied to clipboard!');
 });
});
