import { invoke } from "@tauri-apps/api/core";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "./storage";

const PREFERRED_BROWSER_KEY = "raynote_preferred_web_browser";

export interface WebBrowser {
  bundleId: string;
  name: string;
}

export function getPreferredBrowser(): string {
  return safeLocalStorageGetItem(PREFERRED_BROWSER_KEY) ?? "";
}

export function setPreferredBrowser(bundleId: string): boolean {
  return safeLocalStorageSetItem(PREFERRED_BROWSER_KEY, bundleId);
}

export async function listWebBrowsers(): Promise<WebBrowser[]> {
  const browsers = await invoke<WebBrowser[]>("list_web_browsers");
  if (!Array.isArray(browsers)) throw new Error("Could not discover installed web browsers");
  return browsers;
}

export function openInPreferredBrowser(url: string, bundleId: string): Promise<void> {
  return invoke("open_web_link_in_browser", { url, bundleId });
}
