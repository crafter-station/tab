import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/controls.css";
import "./styles/overlay.css";
import "./styles/onboarding.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing React root");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
