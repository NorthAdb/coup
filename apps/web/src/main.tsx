import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Portal } from "./portal/Portal.js";
import { BrassApp } from "./brass/BrassApp.js";
import "./styles.css";
import "./brass/brass.css";

const path = window.location.pathname;

function route() {
  if (path === "/" || path === "/index.html") return <Portal />;
  if (path.startsWith("/brass")) return <BrassApp />;
  // coup 全部既有路径（/join、/coup、遗留根路径）保持原行为。
  return <App />;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    {route()}
  </StrictMode>,
);
