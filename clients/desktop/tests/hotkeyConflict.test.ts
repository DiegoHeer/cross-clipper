/**
 * Tests for boot-time hotkey-conflict pull (fix 3 — pull-on-boot).
 *
 * Verifies that notifyBootConflicts invokes get_boot_conflicts and fires
 * notifier.notify for each returned conflict.  The Rust side drains the list;
 * the mock simulates drain semantics by returning the configured value once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyBootConflicts, type BootConflict } from "../src/background/main";
import type { Notifier } from "../src/background/alerts";

// ---------------------------------------------------------------------------
// Mock invoke — allow per-test return values
// ---------------------------------------------------------------------------

let invokeReturn: BootConflict[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((_cmd: string) => Promise.resolve(invokeReturn)),
}));

import { invoke } from "@tauri-apps/api/core";

beforeEach(() => {
  invokeReturn = [];
  vi.mocked(invoke).mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notifyBootConflicts", () => {
  it("invokes get_boot_conflicts on startup", async () => {
    const notifier: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await notifyBootConflicts(notifier);

    expect(invoke).toHaveBeenCalledWith("get_boot_conflicts");
  });

  it("calls notifier.notify for each conflict returned", async () => {
    invokeReturn = [
      { combo: "Ctrl+Alt+C", role: "capture", message: "already registered" },
      { combo: "Ctrl+Alt+V", role: "flyout", message: "already registered" },
    ];
    const notifier: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await notifyBootConflicts(notifier);

    expect(notifier.notify).toHaveBeenCalledTimes(2);
    expect(notifier.notify).toHaveBeenCalledWith(
      "hotkey-conflict-capture",
      "Capture hotkey unavailable",
      "Capture hotkey unavailable — pick another in Settings → Capture",
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      "hotkey-conflict-flyout",
      "Capture hotkey unavailable",
      "Capture hotkey unavailable — pick another in Settings → Capture",
    );
  });

  it("calls notifier.notify with correct id for capture role", async () => {
    invokeReturn = [
      { combo: "Ctrl+Alt+C", role: "capture", message: "conflict" },
    ];
    const notifier: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await notifyBootConflicts(notifier);

    expect(notifier.notify).toHaveBeenCalledWith(
      "hotkey-conflict-capture",
      "Capture hotkey unavailable",
      "Capture hotkey unavailable — pick another in Settings → Capture",
    );
  });

  it("does not call notifier.notify when no conflicts returned", async () => {
    invokeReturn = [];
    const notifier: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await notifyBootConflicts(notifier);

    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
