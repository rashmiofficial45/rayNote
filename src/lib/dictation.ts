import { invoke } from "@tauri-apps/api/core";
import type { Editor } from "@tiptap/react";

type DictationListener = (isListening: boolean, interimText?: string) => void;

let recognitionInstance: any = null;
let activeListening = false;
const listeners = new Set<DictationListener>();

export function isSpeechRecognitionAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );
}

export function subscribeDictationState(cb: DictationListener): () => void {
  listeners.add(cb);
  cb(activeListening, "");
  return () => {
    listeners.delete(cb);
  };
}

function notifyDictationState(listening: boolean, interim: string = "") {
  activeListening = listening;
  for (const cb of listeners) {
    try {
      cb(listening, interim);
    } catch {}
  }
}

/**
 * Inserts recognized speech into the TipTap editor at current cursor.
 * Handles automatic spacing and punctuation formatting.
 */
export function insertDictatedText(editor: Editor, text: string) {
  if (!editor || !text) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  const { state } = editor;
  const { $from } = state.selection;

  // Add leading space if preceding character is not whitespace or start of node
  let prefix = "";
  if ($from.parentOffset > 0) {
    const charBefore = state.doc.textBetween(Math.max(0, $from.pos - 1), $from.pos, "\n");
    if (charBefore && !/\s/.test(charBefore)) {
      prefix = " ";
    }
  }

  const toInsert = prefix + trimmed;
  editor.chain().focus().insertContent(toInsert).run();
}

/**
 * Triggers macOS native system dictation via Cocoa selector [NSApp sendAction:sel!(startDictation:)].
 * This activates the native macOS Dictation prompt directly over the focused note editor.
 */
export async function startNativeDictation(): Promise<boolean> {
  try {
    await invoke("start_native_dictation");
    return true;
  } catch (err) {
    console.warn("[rayNote] Native dictation invocation failed:", err);
    return false;
  }
}

/**
 * Starts in-app speech recognition or triggers macOS native dictation.
 */
export async function startDictation(editor: Editor): Promise<boolean> {
  if (activeListening) return true;

  // First ensure microphone permission is promptable on macOS
  if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release test stream immediately
      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.warn("[rayNote] Microphone permission check:", err);
      // Fallback directly to native macOS dictation which prompts system microphone access
      await startNativeDictation();
      return true;
    }
  }

  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (SpeechRecognition) {
    try {
      if (recognitionInstance) {
        try {
          recognitionInstance.abort();
        } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";

      recognition.onstart = () => {
        notifyDictationState(true, "");
      };

      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = item[0]?.transcript || "";
          if (item.isFinal) {
            insertDictatedText(editor, transcript);
          } else {
            interim += transcript;
          }
        }
        notifyDictationState(true, interim);
      };

      recognition.onerror = (event: any) => {
        console.warn("[rayNote] Speech recognition error:", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          stopDictation();
          startNativeDictation();
        }
      };

      recognition.onend = () => {
        notifyDictationState(false, "");
        recognitionInstance = null;
      };

      recognitionInstance = recognition;
      recognition.start();
      return true;
    } catch (err) {
      console.warn("[rayNote] Failed to start Web SpeechRecognition, falling back to native:", err);
    }
  }

  // Fallback to macOS native dictation
  notifyDictationState(true, "");
  const ok = await startNativeDictation();
  setTimeout(() => {
    notifyDictationState(false, "");
  }, 3000);
  return ok;
}

/**
 * Stops any active speech recognition session.
 */
export function stopDictation() {
  if (recognitionInstance) {
    try {
      recognitionInstance.stop();
    } catch {}
    recognitionInstance = null;
  }
  notifyDictationState(false, "");
}

/**
 * Toggles speech dictation on or off.
 */
export async function toggleDictation(editor: Editor): Promise<boolean> {
  if (activeListening) {
    stopDictation();
    return false;
  } else {
    return startDictation(editor);
  }
}
