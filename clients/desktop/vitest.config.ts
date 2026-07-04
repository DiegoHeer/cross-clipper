import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Tauri APIs throw outside a real window; tests use the fake (Task 5).
      "@tauri-apps/api/event": path.resolve(__dirname, "tests/tauriMock.ts"),
      "@tauri-apps/plugin-store": path.resolve(__dirname, "tests/tauriMock.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
