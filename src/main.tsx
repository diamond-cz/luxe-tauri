import React from "react";
import ReactDOM from "react-dom/client";

// Side-effect import: synchronously initialises i18next BEFORE React renders.
// This guarantees `useTranslation()` sees a ready instance on first render
// and avoids the "Should have a queue" hook-queue mismatch that happens when
// i18next.init runs after components have already mounted.
import "./locales/i18n";

import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
