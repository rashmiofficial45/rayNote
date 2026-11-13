import { safeLocalStorageGetItem, STORAGE_KEYS } from "./storage";

export type ZoomMode = "windowed" | "fullscreen";
export const DEFAULT_ZOOM = 1.2;
export const ZOOM_MODE_KEY = "notefast_active_zoom_mode";
export const ZOOM_KEYS: Record<ZoomMode, string> = {
  windowed: STORAGE_KEYS.ZOOM_LEVEL,
  fullscreen: "notefast_fullscreen_zoom_level",
};

export function isValidZoom(value: number): boolean {
  return value >= 0.6 && value <= 2;
}

export function readZoom(mode: ZoomMode): number {
  const value = Number(safeLocalStorageGetItem(ZOOM_KEYS[mode]));
  return isValidZoom(value) ? value : DEFAULT_ZOOM;
}
