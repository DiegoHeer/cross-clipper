import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // webextension-polyfill throws outside a real extension runtime;
      // every test runs against the mutable fake instead.
      "webextension-polyfill": path.resolve(__dirname, "tests/polyfillMock.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
