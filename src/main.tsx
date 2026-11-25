import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initFrameProbe } from "./lib/frameProbe";
import { applyGlassClarity, getStoredGlassClarity } from "./lib/theme";

applyGlassClarity(getStoredGlassClarity());

if (import.meta.env.DEV) {
  initFrameProbe();
}

const isSettings =
  window.location.search.includes("window=settings") ||
  window.location.hash.includes("settings");

const SettingsApp = React.lazy(() => import("./SettingsApp"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSettings ? (
      <React.Suspense fallback={null}>
        <SettingsApp />
      </React.Suspense>
    ) : <App />}
  </React.StrictMode>
);
