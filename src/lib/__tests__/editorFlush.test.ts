// @vitest-environment happy-dom
import {it,expect,vi,afterEach} from 'vitest';
const bus=vi.hoisted(()=>({listeners:new Map<string,Set<(e:{payload:any})=>unknown>>()}));
vi.mock('@tauri-apps/api/event',()=>({
 listen:vi.fn(async(name:string,callback:(e:{payload:any})=>unknown)=>{
  const listeners=bus.listeners.get(name)||new Set();listeners.add(callback);bus.listeners.set(name,listeners);
  return ()=>listeners.delete(callback);
 }),
 emit:vi.fn(async(name:string,payload:any)=>{for(const callback of bus.listeners.get(name)||[])void callback({payload});}),
}));
import {requestEditorFlush,registerEditorFlushHandler} from '../editorFlush';
import {emit} from '@tauri-apps/api/event';
afterEach(()=>{bus.listeners.clear();vi.clearAllMocks();vi.useRealTimers();});
it('waits for the owner and ignores an unrelated acknowledgement',async()=>{
 let finish!:()=>void;const stop=await registerEditorFlushHandler(()=>new Promise(resolve=>{finish=resolve}));
 let finished=false;const pending=requestEditorFlush().then(()=>{finished=true});
 await Promise.resolve();await Promise.resolve();
 await emit('raynote://flush-result',{requestId:'unrelated'});expect(finished).toBe(false);
 finish();await pending;expect(finished).toBe(true);expect(bus.listeners.get('raynote://flush-result')?.size).toBe(0);stop();
});
it('propagates save rejection rather than acknowledging success',async()=>{
 await registerEditorFlushHandler(async()=>{throw new Error('Disk full')});
 await expect(requestEditorFlush()).rejects.toThrow('Disk full');expect(bus.listeners.get('raynote://flush-result')?.size).toBe(0);
});
it('times out and cleans up when the editor owner is unavailable',async()=>{
 vi.useFakeTimers();const pending=requestEditorFlush();const failed=expect(pending).rejects.toThrow('did not finish saving');
 await vi.advanceTimersByTimeAsync(15000);await failed;expect(bus.listeners.get('raynote://flush-result')?.size).toBe(0);
});
