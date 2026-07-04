import browser from "webextension-polyfill";
import { EVENTS_PORT, isPopupRequest } from "../shared/messages";
import { PREFS_KEY, loadAuth, loadPrefs } from "../shared/settings";
import { ExtensionStorage } from "../shared/storage";
import { AlertManager } from "./alerts";
import { BackgroundController } from "./controller";
import { onMenuClicked, syncContextMenus } from "./menus";
import { browserSocketFactory } from "./socket";

const storage = new ExtensionStorage();

const alerts = new AlertManager({
  storage,
  notifications: {
    // Cast through unknown: the AlertDeps interface uses Record<string,unknown> for testability;
    // the actual opts passed by AlertManager always satisfy CreateNotificationOptions.
    create: (id, opts) =>
      browser.notifications.create(
        id,
        opts as unknown as Parameters<(typeof browser.notifications)["create"]>[0],
      ),
  },
  action: browser.action,
  getPrefs: loadPrefs,
  getSelfDeviceId: async () => (await loadAuth())?.deviceId ?? null,
});

const controller = new BackgroundController({
  storage,
  socketFactory: browserSocketFactory,
  onNewItem: (item) => void alerts.onItem(item),
});
controller.onPopupOpened = () => void alerts.clearBadge();

const menuDeps = {
  contextMenus: browser.contextMenus,
  send: async (kind: "text" | "link", body: string) => {
    await controller.handleRequest({ type: "send", kind, body, targetDeviceId: null });
  },
  flash: () => alerts.flashBadge(),
};

browser.contextMenus.onClicked.addListener((info) => void onMenuClicked(menuDeps, info));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && PREFS_KEY in changes) {
    void loadPrefs().then((p) => syncContextMenus(menuDeps, p));
  }
});

browser.notifications.onClicked.addListener(() => {
  void browser.action.openPopup().catch(() =>
    browser.windows.create({
      url: browser.runtime.getURL("src/popup/index.html"),
      type: "popup",
      width: 380,
      height: 540,
    }),
  );
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
  void loadPrefs().then((p) => syncContextMenus(menuDeps, p));
});
browser.runtime.onStartup.addListener(() => void controller.wake());
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cc-tick") void controller.wake();
});
void controller.wake();

export { controller, alerts }; // consumed by menus wiring (Task 19)
