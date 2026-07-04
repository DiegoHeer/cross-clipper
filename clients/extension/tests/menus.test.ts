import { describe, expect, it, vi } from "vitest";
import type { Prefs } from "../src/shared/settings";

function makeDeps() {
  const created: Record<string, unknown>[] = [];
  let removed = 0;
  const send = vi.fn(async () => undefined);
  const flash = vi.fn(async () => undefined);
  return {
    created,
    send,
    flash,
    removedCount: () => removed,
    deps: {
      contextMenus: {
        create: (opts: Record<string, unknown>) => created.push(opts),
        removeAll: async () => void removed++,
      },
      send,
      flash,
    },
  };
}

const prefs = (on: boolean): Prefs => ({ notifyOnNewItems: false, contextMenuSend: on });

describe("context menus", () => {
  it("creates both entries when enabled, none when disabled — always resetting first", async () => {
    const { syncContextMenus } = await import("../src/background/menus");
    const ctx = makeDeps();
    await syncContextMenus(ctx.deps, prefs(true));
    expect(ctx.removedCount()).toBe(1);
    expect(ctx.created.map((c) => c.id)).toEqual(["cc-send-selection", "cc-send-link"]);
    await syncContextMenus(ctx.deps, prefs(false));
    expect(ctx.removedCount()).toBe(2);
    expect(ctx.created).toHaveLength(2); // nothing new created
  });

  it("selection clicks send text; link clicks send the link URL; both flash", async () => {
    const { onMenuClicked, MENU_LINK, MENU_SELECTION } = await import("../src/background/menus");
    const ctx = makeDeps();
    await onMenuClicked(ctx.deps, { menuItemId: MENU_SELECTION, selectionText: "picked words" });
    expect(ctx.send).toHaveBeenCalledWith("text", "picked words");
    await onMenuClicked(ctx.deps, { menuItemId: MENU_LINK, linkUrl: "https://example.com/x" });
    expect(ctx.send).toHaveBeenCalledWith("link", "https://example.com/x");
    expect(ctx.flash).toHaveBeenCalledTimes(2);
  });

  it("ignores unknown menu ids and empty payloads", async () => {
    const { onMenuClicked, MENU_SELECTION } = await import("../src/background/menus");
    const ctx = makeDeps();
    await onMenuClicked(ctx.deps, { menuItemId: "someone-elses-menu" });
    await onMenuClicked(ctx.deps, { menuItemId: MENU_SELECTION });
    expect(ctx.send).not.toHaveBeenCalled();
  });
});
