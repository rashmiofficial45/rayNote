import {emit, listen} from '@tauri-apps/api/event';

const REQUEST = 'raynote://flush-request';
const RESULT = 'raynote://flush-result';
interface FlushRequest { requestId: string }
interface FlushResult extends FlushRequest { error?: string }

/** Settings must receive success from the editor owner before reading SQLite. */
export async function requestEditorFlush(): Promise<void> {
  const requestId = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const result = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  try {
    stop = await listen<FlushResult>(RESULT, ({payload}) => {
      if (payload.requestId !== requestId) return;
      if (payload.error !== undefined) reject(new Error(payload.error || 'Saving failed'));
      else resolve();
    });
    timer = setTimeout(() => reject(new Error('The notes window did not finish saving. Please retry.')), 15000);
    await Promise.all([emit(REQUEST, {requestId}), result]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    stop?.();
  }
}

export async function registerEditorFlushHandler(flush: () => Promise<void>): Promise<() => void> {
  return listen<FlushRequest>(REQUEST, async ({payload}) => {
    let error: string | undefined;
    try { await flush(); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    await emit(RESULT, {requestId: payload.requestId, ...(error !== undefined ? {error} : {})});
  });
}
