import React from "react";
import { createRoot } from "react-dom/client";
import "@tab/ui/styles.css";
import { initializeThemePreference, subscribeToSystemThemeChanges } from "@tab/ui";
import { OverlaySurface } from "./surfaces/OverlaySurface";
import "./styles/base.css";
import "./styles/overlay.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing React root");
}

document.body.dataset.surface = "overlay";
initializeThemePreference();
const unsubscribeFromSystemTheme = subscribeToSystemThemeChanges();
window.addEventListener("beforeunload", unsubscribeFromSystemTheme, { once: true });

createRoot(root).render(
  <React.StrictMode>
    <OverlaySurface />
  </React.StrictMode>,
);
