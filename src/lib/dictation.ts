import { invoke } from "@tauri-apps/api/core";
import type { Editor } from "@tiptap/react";

type DictationListener = (isListening: boolean, interimText?: string) => void;

let recognitionInstance: any = null;
let activeListening = false;
let nativeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<DictationListener>();

export function isSpeechRecognitionAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
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
export function insertDictatedText(editor?: Editor | null, text?: string) {
  if (!editor || !text) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  const { state } = editor;
  const { $from } = state.selection;

  // Add leading space if preceding character is not whitespace or start of node,
  // except when the dictated text starts with punctuation marks.
  let prefix = "";
  if ($from.parentOffset > 0) {
    const charBefore = state.doc.textBetween(Math.max(0, $from.pos - 1), $from.pos, "\n");
    if (charBefore && !/\s/.test(charBefore) && !/^[,.!?:;)\]}]/.test(trimmed)) {
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

async function triggerNativeFallback(): Promise<boolean> {
  if (nativeFallbackTimer) {
    clearTimeout(nativeFallbackTimer);
    nativeFallbackTimer = null;
  }

  notifyDictationState(true, "");
  const ok = await startNativeDictation();

  // Active glow indicator while native dictation initializes
  nativeFallbackTimer = setTimeout(() => {
    notifyDictationState(false, "");
    nativeFallbackTimer = null;
  }, 3500);

  return ok;
}

/**
 * Starts in-app speech recognition or triggers macOS native dictation.
 */
export async function startDictation(editor?: Editor | null): Promise<boolean> {
  if (activeListening) return true;

  // Ensure editor has keyboard focus so macOS dictation / Web Speech targets the active text insertion point
  if (editor && !editor.isFocused) {
    try {
      editor.commands.focus();
    } catch {}
  }

  const SpeechRecognition =
    typeof window !== "undefined"
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;

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
      recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";

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
        console.warn("[rayNote] Speech recognition error:", event?.error);
        if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
          stopDictation();
          triggerNativeFallback();
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

  // Native macOS dictation: zero-latency, offline, system-integrated
  return triggerNativeFallback();
}

/**
 * Stops any active speech recognition session.
 */
export function stopDictation() {
  if (nativeFallbackTimer) {
    clearTimeout(nativeFallbackTimer);
    nativeFallbackTimer = null;
  }
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
export async function toggleDictation(editor?: Editor | null): Promise<boolean> {
  if (activeListening) {
    stopDictation();
    return false;
  } else {
    return startDictation(editor);
  }
}

