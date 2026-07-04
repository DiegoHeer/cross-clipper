import type { Prefs } from "../shared/settings";

export const MENU_SELECTION = "cc-send-selection";
export const MENU_LINK = "cc-send-link";

export interface MenuDeps {
  contextMenus: {
    create(opts: Record<string, unknown>): unknown;
    removeAll(): Promise<void>;
  };
  send(kind: "text" | "link", body: string): Promise<void>;
  flash(): Promise<void>;
}

export async function syncContextMenus(deps: MenuDeps, prefs: Prefs): Promise<void> {
  await deps.contextMenus.removeAll();
  if (!prefs.contextMenuSend) return;
  deps.contextMenus.create({
    id: MENU_SELECTION,
    title: "Send selection to CrossClipper",
    contexts: ["selection"],
  });
  deps.contextMenus.create({
    id: MENU_LINK,
    title: "Send link to CrossClipper",
    contexts: ["link"],
  });
}

export async function onMenuClicked(
  deps: MenuDeps,
  info: { menuItemId: string | number; selectionText?: string; linkUrl?: string },
): Promise<void> {
  if (info.menuItemId === MENU_SELECTION && info.selectionText) {
    await deps.send("text", info.selectionText);
    await deps.flash();
  } else if (info.menuItemId === MENU_LINK && info.linkUrl) {
    await deps.send("link", info.linkUrl);
    await deps.flash();
  }
}
