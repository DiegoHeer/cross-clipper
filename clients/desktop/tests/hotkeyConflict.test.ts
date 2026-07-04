/**
 * Tests for the cc:hotkey-conflict listener (m1 capstone fix).
 *
 * Verifies that listenHotkeyConflict registers a listener which fires
 * tauriNotifier.notify with the correct arguments when the Rust side emits
 * a boot-time hotkey conflict event.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetEvents, emit } from "./tauriMock";
import { listenHotkeyConflict } from "../src/background/main";
import type { Notifier } from "../src/background/alerts";

beforeEach(() => {
  __resetEvents();
});

describe("listenHotkeyConflict", () => {
  it("calls notifier.notify when cc:hotkey-conflict fires for capture role", async () => {
    const notifier: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await listenHotkeyConflict(notifier);

    await emit("cc:hotkey-conflict", { combo: "Ctrl+Alt+C", role: "capture" });

    expect(notifier.notify).toHaveBeenCalledWith(
      "hotkey-conflict-capture",
      "Capture hotkey unavailable",
      "Capture hotkey unavailable — pick another in Settings → Capture",
    );
  });

  it("calls notifier.notify when cc:hotkey-conflict fires for flyout role", async () => {
    const notifier: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await listenHotkeyConflict(notifier);

    await emit("cc:hotkey-conflict", { combo: "Ctrl+Alt+V", role: "flyout" });

    expect(notifier.notify).toHaveBeenCalledWith(
      "hotkey-conflict-flyout",
      "Capture hotkey unavailable",
      "Capture hotkey unavailable — pick another in Settings → Capture",
    );
  });

  it("does not call notifier.notify when no event is emitted", async () => {
    const notifier: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await listenHotkeyConflict(notifier);

    // No event emitted — notify must not be called.
    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
