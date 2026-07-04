import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../theme/theme";
import { Flyout } from "./Flyout";
import "../theme/tokens.css";
import "../ui/ui.css";

initTheme();

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Flyout />
    </StrictMode>,
  );
}
