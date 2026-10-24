import { useSyncExternalStore } from "react";

type SaveStatusListener = () => void;

export interface SaveStatusState {
  isSaveBlocked: boolean;
  blockedNoteId: string | null;
  blockedError: string | null;
}

let currentState: SaveStatusState = {
  isSaveBlocked: false,
  blockedNoteId: null,
  blockedError: null,
};

const listeners = new Set<SaveStatusListener>();

/**
 * External reactive store for tracking autosave circuit-breaker lockouts and save failures.
 * Used by TitleBar to render persistent "Not saved" indicators with 0 unnecessary React tree re-renders.
 */
export const saveStatusStore = {
  getSnapshot(): SaveStatusState {
    return currentState;
  },

  isBlocked(): boolean {
    return currentState.isSaveBlocked;
  },

  setBlocked(blocked: boolean, noteId?: string | null, error?: string | null): void {
    if (
      currentState.isSaveBlocked === blocked &&
      currentState.blockedNoteId === (noteId || null) &&
      currentState.blockedError === (error || null)
    ) {
      return;
    }
    currentState = {
      isSaveBlocked: blocked,
      blockedNoteId: blocked ? (noteId || currentState.blockedNoteId) : null,
      blockedError: blocked ? (error || currentState.blockedError) : null,
    };
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error("SaveStatus listener error:", e);
      }
    });
  },

  reset(): void {
    if (!currentState.isSaveBlocked && !currentState.blockedNoteId && !currentState.blockedError) {
      return;
    }
    currentState = {
      isSaveBlocked: false,
      blockedNoteId: null,
      blockedError: null,
    };
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error("SaveStatus listener error:", e);
      }
    });
  },

  subscribe(listener: SaveStatusListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useSaveStatus(): SaveStatusState {
  return useSyncExternalStore(saveStatusStore.subscribe, saveStatusStore.getSnapshot);
}
