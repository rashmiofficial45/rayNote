import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Globe } from "lucide-react";
import { getPreferredBrowser, listWebBrowsers, setPreferredBrowser, type WebBrowser } from "../lib/webBrowsers";

function BrowserIcon({ icon }: { icon?: string }) {
  return icon
    ? <img className="browser-picker-icon" src={icon} alt="" />
    : <Globe className="browser-picker-icon" aria-hidden="true" />;
}

export function WebBrowserSetting() {
  const [browsers, setBrowsers] = useState<WebBrowser[] | null>(null);
  const [preferredBrowser, setSelection] = useState(getPreferredBrowser);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [menuPosition, setMenuPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = menuPosition !== null;

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

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const selected = menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    (selected ?? menu?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => setMenuPosition(null);
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && (
        triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)
      )) return;
      dismiss();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("scroll", dismissOutside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("scroll", dismissOutside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);

  const selected = browsers?.find(browser => browser.bundleId === preferredBrowser);
  const missing = Boolean(preferredBrowser && browsers && !selected);
  const unavailable = preferredBrowser && !selected;
  const options = [
    { bundleId: "", name: "System Default" },
    ...(unavailable ? [{ bundleId: preferredBrowser, name: missing ? "Preferred Browser Unavailable" : "Preferred Browser", disabled: true }] : []),
    ...(browsers ?? []),
  ];
  const description = saveError ? "Could not save your browser choice."
    : loadError ? "Could not refresh the installed browsers. rayNote will retry."
    : missing ? "Your preferred browser is unavailable. Web links use the system default."
    : "Choose which browser opens web links from rayNote.";

  return (
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-row-text">
          <label id="web-browser-label" htmlFor="web-browser" className="settings-row-title block">
            Web Browser
          </label>
          <div id="web-browser-description" className="settings-row-desc" aria-live="polite">
            {description}
          </div>
        </div>
        <div className="settings-row-action">
          <button
            id="web-browser"
            ref={triggerRef}
            type="button"
            aria-labelledby="web-browser-label web-browser-value"
            aria-describedby="web-browser-description"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? "web-browser-options" : undefined}
            className="browser-picker-trigger"
            disabled={!browsers && !loadError}
            onClick={(event) => {
              if (open) return setMenuPosition(null);
              const bounds = event.currentTarget.getBoundingClientRect();
              const width = Math.min(Math.max(228, bounds.width), window.innerWidth - 16);
              const below = window.innerHeight - bounds.bottom - 14;
              const above = bounds.top - 14;
              const placeAbove = below < options.length * 34 + 12 && above > below;
              setMenuPosition({
                width,
                left: Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8)),
                maxHeight: Math.max(0, placeAbove ? above : below),
                ...(placeAbove ? { bottom: window.innerHeight - bounds.top + 6 } : { top: bounds.bottom + 6 }),
              });
            }}
          >
            <BrowserIcon icon={selected?.icon} />
            <span id="web-browser-value">{selected?.name ?? (unavailable ? options[1].name : "System Default")}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {open && createPortal(
            <div
              id="web-browser-options"
              role="menu"
              aria-labelledby="web-browser-label"
              className="browser-picker-menu"
              ref={menuRef}
              style={menuPosition}
              onKeyDown={(event) => {
                if (event.key === "Escape" || event.key === "Tab") {
                  if (event.key === "Escape") event.preventDefault();
                  setMenuPosition(null);
                  triggerRef.current?.focus();
                  return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                const index = items.findIndex(item => item === document.activeElement);
                const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
                items[next]?.focus();
              }}
            >
              {options.map(option => (
                <button
                  key={option.bundleId}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.bundleId === preferredBrowser}
                  disabled={"disabled" in option && option.disabled}
                  className="browser-picker-option"
                  tabIndex={-1}
                  onClick={() => {
                    const saved = setPreferredBrowser(option.bundleId);
                    setSaveError(!saved);
                    if (saved) setSelection(option.bundleId);
                    setMenuPosition(null);
                    triggerRef.current?.focus();
                  }}
                >
                  <BrowserIcon icon={"icon" in option ? option.icon : undefined} />
                  <span>{option.name}</span>
                  {option.bundleId === preferredBrowser && <Check size={14} aria-hidden="true" />}
                </button>
              ))}
            </div>,
            triggerRef.current?.closest(".settings-window-root") ?? document.body,
          )}
        </div>
      </div>
    </div>
  );
}
