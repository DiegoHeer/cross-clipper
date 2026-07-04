import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1, // one persistent context + one server
  retries: process.env.CI ? 1 : 0,
  outputDir: "../e2e-results",
  use: { trace: "retain-on-failure" },
});
