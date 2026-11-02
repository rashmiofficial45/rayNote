import { emit, listen } from "@tauri-apps/api/event";

const CLEAR_REQUEST = "raynote://clear-notes-request";
const CLEAR_RESULT = "raynote://clear-notes-result";
interface ClearRequest { requestId: string }
interface ClearResult extends ClearRequest { error?: string }

/** The main editor owns deletion so pending saves settle before rows are removed. */
export async function requestClearAllNotes(): Promise<void> {
  const requestId = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const result = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  try {
    unlisten = await listen<ClearResult>(CLEAR_RESULT, ({ payload }) => {
      if (payload.requestId !== requestId) return;
      if (payload.error) fail(new Error(payload.error));
      else finish();
    });
    timer = setTimeout(() => fail(new Error("The notes window did not finish clearing notes. Please try again.")), 15000);
    await emit(CLEAR_REQUEST, { requestId });
    await result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    unlisten?.();
  }
}

export async function registerClearAllNotesHandler(clearAll: () => Promise<void>): Promise<() => void> {
  return listen<ClearRequest>(CLEAR_REQUEST, async ({ payload }) => {
    try {
      await clearAll();
      await emit(CLEAR_RESULT, { requestId: payload.requestId });
    } catch (error) {
      await emit(CLEAR_RESULT, { requestId: payload.requestId, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
