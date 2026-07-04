import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";

// Scaffold test still imports this module as a default export — keep the
// named export for backward compatibility with the existing scaffold test.
export default function AppWrapper() {
  return <App />;
}

const el = document.getElementById("root");
if (el) {
  // Initialise design tokens (accent colour + system dark/light mode) only
  // when mounting in a real browser window. Import is deferred to avoid
  // running window.matchMedia during vitest module init.
  import("../theme/theme").then(({ initTheme }) => initTheme());

  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
