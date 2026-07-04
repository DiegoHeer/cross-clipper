import { chromium, test as base, type BrowserContext } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type TestServer } from "./server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  popupUrl: string;
  server: TestServer;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium", // new headless supports extensions; use xvfb-run if the runner's channel doesn't
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent("serviceworker");
    await use(new URL(sw.url()).host);
  },
  popupUrl: async ({ extensionId }, use) => {
    await use(`chrome-extension://${extensionId}/src/popup/index.html`);
  },
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await startServer();
    await use(server);
    await server.stop();
  },
});

export const expect = test.expect;
