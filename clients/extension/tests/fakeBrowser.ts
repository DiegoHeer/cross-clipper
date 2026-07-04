type Listener = (...args: unknown[]) => unknown;

function makeEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: (fn: Listener) => listeners.add(fn),
    removeListener: (fn: Listener) => listeners.delete(fn),
    emit: (...args: unknown[]) => [...listeners].map((fn) => fn(...args)),
  };
}

export interface FakePort {
  name: string;
  onMessage: ReturnType<typeof makeEvent>;
  onDisconnect: ReturnType<typeof makeEvent>;
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
  sent: unknown[];
}

export function makeFakeBrowser() {
  const storageData: Record<string, unknown> = {};
  const storageChanged = makeEvent();
  const onMessage = makeEvent();
  const onConnect = makeEvent();
  const calls = {
    notifications: [] as unknown[],
    badgeTexts: [] as string[],
    contextMenus: [] as unknown[],
    removedAllMenus: 0,
    tabs: [] as unknown[],
    windows: [] as unknown[],
    alarms: [] as unknown[],
  };

  const makePortInternal = (name: string): FakePort => {
    const port: FakePort = {
      name,
      onMessage: makeEvent(),
      onDisconnect: makeEvent(),
      sent: [],
      postMessage: (msg) => port.sent.push(msg),
      disconnect: () => port.onDisconnect.emit(),
    };
    return port;
  };

  const browser = {
    storage: {
      local: {
        get: async (keys?: string | string[]) => {
          if (keys === undefined) return { ...storageData };
          const list = typeof keys === "string" ? [keys] : keys;
          return Object.fromEntries(
            list.filter((k) => k in storageData).map((k) => [k, storageData[k]]),
          );
        },
        set: async (values: Record<string, unknown>) => {
          Object.assign(storageData, values);
          storageChanged.emit(values, "local");
        },
        remove: async (keys: string | string[]) => {
          for (const k of typeof keys === "string" ? [keys] : keys) delete storageData[k];
        },
      },
      onChanged: storageChanged,
    },
    runtime: {
      onMessage,
      onConnect,
      sendMessage: async (msg: unknown) => {
        const results = onMessage.emit(msg, {});
        return Promise.resolve(results.find((r) => r !== undefined));
      },
      connect: ({ name }: { name: string }) => makePortInternal(name),
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
      getURL: (p: string) => `chrome-extension://fake/${p}`,
    },
    alarms: {
      create: (name: string, info: unknown) => calls.alarms.push({ name, info }),
      onAlarm: makeEvent(),
    },
    notifications: {
      create: async (id: string, opts: unknown) => (calls.notifications.push({ id, opts }), id),
      onClicked: makeEvent(),
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => void calls.badgeTexts.push(text),
      setBadgeBackgroundColor: async () => undefined,
      openPopup: async () => undefined,
    },
    contextMenus: {
      create: (opts: unknown) => calls.contextMenus.push(opts),
      removeAll: async () => void calls.removedAllMenus++,
      onClicked: makeEvent(),
    },
    permissions: { request: async () => true, contains: async () => true },
    tabs: { create: async (opts: unknown) => void calls.tabs.push(opts) },
    windows: { create: async (opts: unknown) => void calls.windows.push(opts) },
  };

  const makePort = makePortInternal;

  return { browser, storageData, calls, makePort };
}
