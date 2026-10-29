import { useSyncExternalStore } from "react";

type TitleListener = () => void;

let currentTitle: string | null = null;
const listeners = new Set<TitleListener>();

/**
 * External, decoupled title store for zero-latency TitleBar synchronization.
 * Subscribed via `useSyncExternalStore` so title updates from first-line edits
 * update ONLY the TitleBar component directly without triggering full App or
 * Editor React re-renders on keystrokes.
 */
export const titleStore = {
  getSnapshot(): string | null {
    return currentTitle;
  },
  getTitle(): string {
    return currentTitle || "";
  },
  setTitle(newTitle: string): void {
    const trimmed = (newTitle || "").trim();
    if (currentTitle === trimmed) return;
    currentTitle = trimmed;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error("Title listener error:", e);
      }
    });
  },
  reset(): void {
    if (currentTitle === null) return;
    currentTitle = null;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error("Title listener error:", e);
      }
    });
  },
  subscribe(listener: TitleListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useNoteTitle(): string | null {
  return useSyncExternalStore(titleStore.subscribe, titleStore.getSnapshot);
}
