import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Tauri expects a fixed dev port and no HMR clobbering.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5183, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        flyout: resolve(__dirname, "flyout.html"),
        toast: resolve(__dirname, "toast.html"),
        background: resolve(__dirname, "background.html"),
      },
    },
  },
});
