import { useEffect, useState } from "react";
import { getPreferredBrowser, listWebBrowsers, setPreferredBrowser, type WebBrowser } from "../lib/webBrowsers";

export function WebBrowserSetting() {
  const [browsers, setBrowsers] = useState<WebBrowser[] | null>(null);
  const [preferredBrowser, setSelection] = useState(getPreferredBrowser);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const installed = await listWebBrowsers();
        if (active) {
          setBrowsers(installed);
          setLoadError(false);
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        refreshing = false;
      }
    }

    void refresh();
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(() => {
      if (document.hasFocus()) void refresh();
    }, 5000);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, []);

  const missing = preferredBrowser && browsers && !browsers.some((browser) => browser.bundleId === preferredBrowser);
  const description = saveError ? "Could not save your browser choice."
    : loadError ? "Could not refresh the installed browsers. rayNote will retry."
    : missing ? "Your preferred browser is unavailable. Web links use the system default."
    : "Choose which browser opens web links from rayNote.";

  return (
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-row-text">
          <label htmlFor="web-browser" className="settings-row-title block text-[13.5px] [font-weight:600] text-[color:var(--text-primary)]">
            Web Browser
          </label>
          <div id="web-browser-description" className="settings-row-desc text-[12px] text-[color:var(--text-muted)]" aria-live="polite">
            {description}
          </div>
        </div>
        <div className="settings-row-action">
          <select
            id="web-browser"
            aria-describedby="web-browser-description"
            className="settings-select-input min-h-8 max-w-full"
            value={preferredBrowser}
            disabled={!browsers && !loadError}
            onChange={(event) => {
              const bundleId = event.target.value;
              const saved = setPreferredBrowser(bundleId);
              setSaveError(!saved);
              if (saved) setSelection(bundleId);
            }}
          >
            <option value="">System Default</option>
            {preferredBrowser && (!browsers || missing) && (
              <option value={preferredBrowser} disabled>
                {missing ? "Preferred Browser Unavailable" : "Preferred Browser"}
              </option>
            )}
            {browsers?.map((browser) => (
              <option key={browser.bundleId} value={browser.bundleId}>{browser.name}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
