import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Portal } from "./portal/Portal.js";
import { BrassApp } from "./brass/BrassApp.js";
import { SplendorApp } from "./splendor/SplendorApp.js";
import "./styles.css";
import "./brass/brass.css";
import "./splendor/splendor.css";
import "./splendor/splendor-pieces.css";
import "./splendor/splendor-table.css";

const path = window.location.pathname;

function route() {
  if (path === "/" || path === "/index.html") return <Portal />;
  if (path.startsWith("/brass")) return <BrassApp />;
  if (path.startsWith("/splendor")) return <SplendorApp />;
  // coup 全部既有路径（/join、/coup、遗留根路径）保持原行为。
  return <App />;
}

// 标签页标题按页面区隔：门户/大厅用「大厅」，各游戏用各自的名字；
// 进入房间后由各 App 细化（如「政变 · 房间 NNNN」）。
document.title =
  path === "/" || path === "/index.html"
    ? "大厅"
    : path.startsWith("/brass")
      ? "工业革命 · 伯明翰"
      : path.startsWith("/splendor")
        ? "璀璨宝石"
        : "政变";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    {route()}
  </StrictMode>,
);
