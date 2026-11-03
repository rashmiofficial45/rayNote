// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import SettingsApp from '../../SettingsApp';
import {invoke} from '@tauri-apps/api/core';
import * as db from '../../lib/db';
import {requestEditorFlush} from '../../lib/editorFlush';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn().mockResolvedValue(undefined)}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn().mockResolvedValue(()=>{}),emit:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../../lib/editorFlush',()=>({requestEditorFlush:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement;let root:Root;
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.spyOn(db,'getStorageStats').mockResolvedValue({notes_count:2,size_bytes:0,db_path:'/tmp/fixture'} as any);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();localStorage.clear();vi.restoreAllMocks();});
it('does not export from Settings until the owner acknowledges successful persistence',async()=>{
 localStorage.setItem('notefast_settings_active_pane','storage');let finish!:()=>void;
 vi.mocked(requestEditorFlush).mockReturnValue(new Promise(resolve=>{finish=resolve}));
 const exported=vi.spyOn(db,'exportAllNotesFromDb').mockResolvedValue('ok');
 await act(async()=>root.render(<SettingsApp/>));
 const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Export Markdown')!;
 await act(async()=>button.click());expect(requestEditorFlush).toHaveBeenCalledOnce();expect(exported).not.toHaveBeenCalled();
 await act(async()=>finish());expect(exported).toHaveBeenCalledOnce();
});
it('aborts Settings export when the editor owner rejects saving',async()=>{
 localStorage.setItem('notefast_settings_active_pane','storage');vi.mocked(requestEditorFlush).mockRejectedValue(new Error('Disk full'));
 const exported=vi.spyOn(db,'exportAllNotesFromDb').mockResolvedValue('ok');await act(async()=>root.render(<SettingsApp/>));
 const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Export Markdown')!;
 await act(async()=>button.click());expect(exported).not.toHaveBeenCalled();expect(host.textContent).toContain('Export failed');
});
it('keeps a rejected global shortcut enable disabled in UI and storage',async()=>{
 localStorage.setItem('notefast_settings_active_pane','commands');localStorage.setItem('notefast_commands_config',JSON.stringify([{id:'toggle',enabled:false}]));
 let reject!:(error:Error)=>void;vi.mocked(invoke).mockImplementation(cmd=>cmd==='set_toggle_shortcut'?new Promise((_r,rej)=>{reject=rej}):Promise.resolve());
 await act(async()=>root.render(<SettingsApp/>));const toggle=host.querySelector('[aria-label="Toggle rayNote (Toggle Notes)"]') as HTMLInputElement;
 expect(toggle.classList.contains('is-checked')).toBe(false);await act(async()=>toggle.click());
 expect(toggle.classList.contains('is-checked')).toBe(false);
 await act(async()=>reject(new Error('Shortcut unavailable')));expect(toggle.classList.contains('is-checked')).toBe(false);
 expect(JSON.parse(localStorage.getItem('notefast_commands_config')!).find((c:any)=>c.id==='toggle').enabled).toBe(false);
});

it('commits enabled state only after successful native registration',async()=>{
 localStorage.setItem('notefast_settings_active_pane','commands');localStorage.setItem('notefast_commands_config',JSON.stringify([{id:'toggle',enabled:false}]));
 let finish!:()=>void;vi.mocked(invoke).mockImplementation(cmd=>cmd==='set_toggle_shortcut'?new Promise<void>(resolve=>{finish=resolve}):Promise.resolve());
 await act(async()=>root.render(<SettingsApp/>));const toggle=host.querySelector('[aria-label="Toggle rayNote (Toggle Notes)"]') as HTMLButtonElement;
 await act(async()=>toggle.click());expect(toggle.classList.contains('is-checked')).toBe(false);
 await act(async()=>finish());expect(toggle.classList.contains('is-checked')).toBe(true);
 expect(JSON.parse(localStorage.getItem('notefast_commands_config')!).find((c:any)=>c.id==='toggle').enabled).toBe(true);
});
