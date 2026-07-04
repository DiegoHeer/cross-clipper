import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme } from "../theme/theme";
import "./app.css";

// Scaffold test still imports this module as a default export — keep the
// named export for backward compatibility with the existing scaffold test.
export default function AppWrapper() {
  return <App />;
}

const el = document.getElementById("root");
if (el) {
  // Initialise design tokens (accent colour + system dark/light mode) before
  // first paint so the theme is applied synchronously. theme.ts guards
  // window.matchMedia usage behind typeof checks; vitest's setup stub also
  // provides a matchMedia shim, so this import is safe in tests.
  initTheme();

  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
