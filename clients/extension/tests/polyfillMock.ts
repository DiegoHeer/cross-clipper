// Alias target for "webextension-polyfill" in vitest. Tests install a fake
// via setFakeBrowser(); anything unset throws loudly instead of silently
// succeeding.
let current: unknown = undefined;

export function setFakeBrowser(fake: unknown): void {
  current = fake;
}

const browser: unknown = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (current === undefined) {
        throw new Error(`webextension-polyfill.${prop} used without setFakeBrowser()`);
      }
      return (current as Record<string, unknown>)[prop];
    },
  },
);

export default browser;
