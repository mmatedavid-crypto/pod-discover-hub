import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";

// "ResizeObserver loop completed with undelivered notifications" is a benign
// browser notice (layout settled one frame later), not an app crash. Swallow it
// before error overlays/trackers treat it as fatal and blank the screen.
window.addEventListener(
  "error",
  (ev) => {
    if (typeof ev.message === "string" && ev.message.includes("ResizeObserver loop")) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    }
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
