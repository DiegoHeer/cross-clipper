import browser from "webextension-polyfill";
import { EVENTS_PORT, isPopupRequest } from "../shared/messages";
import { ExtensionStorage } from "../shared/storage";
import { BackgroundController } from "./controller";
import { browserSocketFactory } from "./socket";

const controller = new BackgroundController({
  storage: new ExtensionStorage(),
  socketFactory: browserSocketFactory,
});

// RPC: popup requests, promise-based replies.
browser.runtime.onMessage.addListener((msg: unknown) => {
  if (isPopupRequest(msg)) return controller.handleRequest(msg);
  return undefined;
});

// Events: long-lived port per open popup.
browser.runtime.onConnect.addListener((port) => {
  if (port.name === EVENTS_PORT) void controller.onPortConnect(port);
});

// Wake paths (MV3: any of these may be the first code to run after an idle kill).
browser.runtime.onInstalled.addListener(() => {
  void browser.alarms.create("cc-tick", { periodInMinutes: 1 });
  void controller.wake();
});
browser.runtime.onStartup.addListener(() => void controller.wake());
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cc-tick") void controller.wake();
});
void controller.wake();

export { controller }; // consumed by alerts/menus wiring (Tasks 18–19)
