import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  ThemeMode,
  AccentColor,
  applyThemeMode,
  applyAccent,
  applyFont,
} from "./theme";

export type SettingsSyncPayload =
  | { type: "theme_mode"; value: ThemeMode }
  | { type: "accent"; value: AccentColor }
  | { type: "font"; value: string }
  | { type: "zoom"; value: number }
  | { type: "esc_loses_focus"; value: boolean }
  | { type: "always_on_top"; value: boolean }
  | { type: "commands_config"; value: any }
  | { type: "notes_cleared" }
  | { type: "notes_updated" };

const TAURI_EVENT_NAME = "notefast://settings-sync";
const BROADCAST_CHANNEL_NAME = "notefast_settings_channel";

// Safe BroadcastChannel singleton
let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  } catch (err) {
    console.warn("BroadcastChannel initialization skipped:", err);
  }
}

/**
 * Broadcasts a settings change across all windows/webviews instantly:
 * 1. Tauri Inter-window event (emit)
 * 2. Web BroadcastChannel (cross-tab / cross-webview)
 * 3. Local window DOM CustomEvent
 */
export function broadcastSync(payload: SettingsSyncPayload): void {
  if (typeof window === "undefined") return;

  // 1. Dispatch local DOM custom event for in-window components
  try {
    window.dispatchEvent(
      new CustomEvent("notefast_sync_event", { detail: payload })
    );
  } catch {}

  // 2. BroadcastChannel for same-origin webviews
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch {}
  }

  // 3. Tauri multi-window application bus
  try {
    emit(TAURI_EVENT_NAME, payload).catch(() => {});
  } catch {}
}

export interface SettingsSyncCallbacks {
  onThemeModeChange?: (mode: ThemeMode) => void;
  onAccentChange?: (accent: AccentColor) => void;
  onFontChange?: (fontId: string) => void;
  onZoomChange?: (zoom: number) => void;
  onEscLosesFocusChange?: (val: boolean) => void;
  onAlwaysOnTopChange?: (val: boolean) => void;
  onCommandsConfigChange?: (commands: any) => void;
  onNotesCleared?: () => void;
  onNotesUpdated?: () => void;
}

/**
 * Subscribes to setting sync events across all communication channels.
 * Automatically applies global theme, accent, and typography updates,
 * and calls optional component callbacks.
 */
export function listenToSettingsSync(callbacks?: SettingsSyncCallbacks): () => void {
  if (typeof window === "undefined") return () => {};

  let unlistenTauri: UnlistenFn | null = null;
  let isCleanedUp = false;

  const handlePayload = (payload: SettingsSyncPayload) => {
    if (!payload || !payload.type) return;

    switch (payload.type) {
      case "theme_mode":
        applyThemeMode(payload.value);
        callbacks?.onThemeModeChange?.(payload.value);
        break;
      case "accent":
        applyAccent(payload.value);
        callbacks?.onAccentChange?.(payload.value);
        break;
      case "font":
        applyFont(payload.value);
        callbacks?.onFontChange?.(payload.value);
        break;
      case "zoom":
        callbacks?.onZoomChange?.(payload.value);
        break;
      case "esc_loses_focus":
        callbacks?.onEscLosesFocusChange?.(payload.value);
        break;
      case "always_on_top":
        callbacks?.onAlwaysOnTopChange?.(payload.value);
        break;
      case "commands_config":
        callbacks?.onCommandsConfigChange?.(payload.value);
        break;
      case "notes_cleared":
        callbacks?.onNotesCleared?.();
        break;
      case "notes_updated":
        callbacks?.onNotesUpdated?.();
        break;
    }
  };

  // 1. Listen via Tauri Event bus
  listen<SettingsSyncPayload>(TAURI_EVENT_NAME, (event) => {
    if (isCleanedUp) return;
    handlePayload(event.payload);
  })
    .then((unlisten) => {
      if (isCleanedUp) {
        unlisten();
      } else {
        unlistenTauri = unlisten;
      }
    })
    .catch(() => {});

  // 2. Listen via BroadcastChannel
  const handleBcMessage = (e: MessageEvent) => {
    if (isCleanedUp) return;
    if (e.data) {
      handlePayload(e.data as SettingsSyncPayload);
    }
  };
  if (broadcastChannel) {
    broadcastChannel.addEventListener("message", handleBcMessage);
  }

  // 3. Listen via local DOM custom event
  const handleDomEvent = (e: Event) => {
    if (isCleanedUp) return;
    const custom = e as CustomEvent<SettingsSyncPayload>;
    if (custom.detail) {
      handlePayload(custom.detail);
    }
  };
  window.addEventListener("notefast_sync_event", handleDomEvent);

  // 4. Fallback: StorageEvent
  const handleStorage = (e: StorageEvent) => {
    if (isCleanedUp) return;
    if (e.key === "notefast_theme_mode" && e.newValue) {
      handlePayload({ type: "theme_mode", value: e.newValue as ThemeMode });
    } else if (e.key === "notefast_accent_color" && e.newValue) {
      handlePayload({ type: "accent", value: e.newValue as AccentColor });
    } else if (e.key === "notefast_font" && e.newValue) {
      handlePayload({ type: "font", value: e.newValue });
    } else if (e.key === "notefast_zoom_level" && e.newValue) {
      const parsed = parseFloat(e.newValue);
      if (!isNaN(parsed)) handlePayload({ type: "zoom", value: parsed });
    } else if (e.key === "notefast_esc_loses_focus" && e.newValue) {
      handlePayload({ type: "esc_loses_focus", value: e.newValue === "true" });
    } else if (e.key === "notefast_always_on_top" && e.newValue) {
      handlePayload({ type: "always_on_top", value: e.newValue === "true" });
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    isCleanedUp = true;
    if (unlistenTauri) {
      unlistenTauri();
    }
    if (broadcastChannel) {
      broadcastChannel.removeEventListener("message", handleBcMessage);
    }
    window.removeEventListener("notefast_sync_event", handleDomEvent);
    window.removeEventListener("storage", handleStorage);
  };
}
