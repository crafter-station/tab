import React from "react";
import { createRoot } from "react-dom/client";
import "@tab/ui/styles.css";
import { initializeThemePreference } from "@tab/ui";
import { App } from "./App";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/onboarding.css";
import "./styles/sign-in.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing React root");
}

initializeThemePreference();

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
