import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const isSettings =
  window.location.search.includes("window=settings") ||
  window.location.hash.includes("settings");

const SettingsApp = React.lazy(() => import("./SettingsApp"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSettings ? (
      <React.Suspense fallback={<div />}>
        <SettingsApp />
      </React.Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
