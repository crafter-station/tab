import React from "react";
import { createRoot } from "react-dom/client";
import "@tabb/ui/styles.css";
import { initializeThemePreference } from "@tabb/ui";
import { OverlaySurface } from "./surfaces/OverlaySurface";
import "./styles/base.css";
import "./styles/overlay.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing React root");
}

document.body.dataset.surface = "overlay";
initializeThemePreference();

createRoot(root).render(
  <React.StrictMode>
    <OverlaySurface />
  </React.StrictMode>,
);
