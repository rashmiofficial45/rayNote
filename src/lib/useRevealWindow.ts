import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Reveal once the initial view has committed in its hidden webview. */
export function useRevealWindow(ready: boolean): void {
  const requested = useRef(false);

  useEffect(() => {
    if (!ready || requested.current || !("__TAURI_INTERNALS__" in window) || !isTauri()) return;
    requested.current = true;
    invoke("reveal_ready_window").catch((error: unknown) => {
      requested.current = false;
      console.error("Could not reveal rayNote window:", error);
    });
  }, [ready]);
}
