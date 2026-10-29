import { useSyncExternalStore } from "react";

type SaveStatusListener = () => void;

export interface SaveStatusState {
  isSaveBlocked: boolean;
  blockedNoteId: string | null;
  blockedError: string | null;
  isSaving: boolean;
  isSaved: boolean;
}

let currentState: SaveStatusState = {
  isSaveBlocked: false,
  blockedNoteId: null,
  blockedError: null,
  isSaving: false,
  isSaved: true,
};

const listeners = new Set<SaveStatusListener>();

/**
 * External reactive store for tracking autosave state (saving, saved, blocked).
 * Used by TitleBar to render clean status indicators without unnecessary React tree re-renders.
 */
export const saveStatusStore = {
  getSnapshot(): SaveStatusState {
    return currentState;
  },

  isBlocked(): boolean {
    return currentState.isSaveBlocked;
  },

  setSaving(saving: boolean): void {
    if (currentState.isSaving === saving) return;
    currentState = {
      ...currentState,
      isSaving: saving,
      isSaved: saving ? false : currentState.isSaved,
    };
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error("SaveStatus listener error:", e);
      }
    });
  },

  setSaved(): void {
    currentState = {
      ...currentState,
      isSaving: false,
      isSaved: true,
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

  setBlocked(blocked: boolean, noteId?: string | null, error?: string | null): void {
    if (
      currentState.isSaveBlocked === blocked &&
      currentState.blockedNoteId === (noteId || null) &&
      currentState.blockedError === (error || null)
    ) {
      return;
    }
    currentState = {
      ...currentState,
      isSaveBlocked: blocked,
      blockedNoteId: blocked ? (noteId || currentState.blockedNoteId) : null,
      blockedError: blocked ? (error || currentState.blockedError) : null,
      isSaving: false,
      isSaved: !blocked,
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
    currentState = {
      isSaveBlocked: false,
      blockedNoteId: null,
      blockedError: null,
      isSaving: false,
      isSaved: true,
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
