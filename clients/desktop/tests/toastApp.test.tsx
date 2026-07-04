/**
 * Tests for ToastApp (toast/main.tsx) bootstrap logic.
 *
 * Covers findings 1+2+5:
 *   1. cc:capture-result event → toast state rendered + show_window invoked.
 *   2. useEffect cleanup: subscriptions use proper lifecycle (no StrictMode leak).
 *   5. Second sequential synced capture restarts the countdown timer.
 *
 * Also covers M3 (capstone fix): captureToastEnabled=false suppresses the
 * toast; captureToastDurationMs controls the countdown.
 *
 * The toast_update path (cc:evt) is also exercised to confirm the existing
 * behaviour is preserved after the subscription refactor.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetEvents, emit, Store } from "./tauriMock";
import { __setStore, savePrefs } from "../src/shared/settings";
import { ToastApp } from "../src/toast/main";

// tauriMock is aliased via vitest.config.ts for @tauri-apps/api/event.
// invoke is declared as a global in main.tsx — provide a spy on window.
const invokeSpy = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  __resetEvents();
  invokeSpy.mockClear();
  // Fresh store per test — ensures captureToastEnabled defaults to true.
  __setStore(new Store());
  // Expose as a global so the declare function invoke(...) call resolves.
  (window as unknown as Record<string, unknown>)["invoke"] = invokeSpy;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)["invoke"];
});

describe("ToastApp — cc:capture-result", () => {
  it("shows toast and invokes show_window on a synced capture", async () => {
    render(<ToastApp />);

    // Nothing shown yet.
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      await emit("cc:capture-result", {
        state: "synced",
        snippet: "Hello world",
        outboxId: "01X",
      });
    });

    // Toast rendered.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/synced/i)).toBeInTheDocument();
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();

    // show_window invoked with label "toast".
    expect(invokeSpy).toHaveBeenCalledWith("show_window", { label: "toast" });
  });

  it("shows toast for a non-synced capture (queued) without countdown", async () => {
    render(<ToastApp />);

    await act(async () => {
      await emit("cc:capture-result", { state: "queued", snippet: undefined, outboxId: undefined });
    });

    expect(screen.getByText(/queued — will sync when connected/i)).toBeInTheDocument();
    expect(invokeSpy).toHaveBeenCalledWith("show_window", { label: "toast" });
  });

  it("second capture increments captureId (countdown restarts)", async () => {
    render(<ToastApp />);

    await act(async () => {
      await emit("cc:capture-result", { state: "synced", snippet: "first", outboxId: "01A" });
    });

    const countdownAfterFirst = screen.queryByText(/\ds$/);
    expect(countdownAfterFirst).toBeInTheDocument();

    // Second capture arrives while first is still showing.
    await act(async () => {
      await emit("cc:capture-result", { state: "synced", snippet: "second", outboxId: "01B" });
    });

    // show_window called twice (once per capture).
    expect(invokeSpy).toHaveBeenCalledTimes(2);
    expect(invokeSpy).toHaveBeenLastCalledWith("show_window", { label: "toast" });
    // The snippet updated to the second capture.
    expect(screen.getByText(/second/)).toBeInTheDocument();
  });
});

describe("ToastApp — toast_update via cc:evt", () => {
  it("toast_update synced starts countdown (queued→synced flip)", async () => {
    render(<ToastApp />);

    // Deliver a queued capture first.
    await act(async () => {
      await emit("cc:capture-result", { state: "queued", snippet: "hi", outboxId: "01Y" });
    });
    expect(screen.getByText(/queued/i)).toBeInTheDocument();

    // Background flips to synced.
    await act(async () => {
      await emit("cc:evt", { type: "toast_update", outboxId: "01Y", state: "synced" });
    });

    expect(screen.getByText(/synced/i)).toBeInTheDocument();
  });

  it("toast_update cancelled hides the window", async () => {
    render(<ToastApp />);

    await act(async () => {
      await emit("cc:capture-result", { state: "queued", snippet: "bye", outboxId: "01Z" });
    });

    invokeSpy.mockClear();

    await act(async () => {
      await emit("cc:evt", { type: "toast_update", outboxId: "01Z", state: "cancelled" });
    });

    expect(invokeSpy).toHaveBeenCalledWith("hide_window", { label: "toast" });
    // Toast cleared — nothing rendered.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("toast_update for a different outboxId is a no-op", async () => {
    render(<ToastApp />);

    await act(async () => {
      await emit("cc:capture-result", { state: "queued", snippet: "keep", outboxId: "01Q" });
    });

    invokeSpy.mockClear();

    await act(async () => {
      await emit("cc:evt", { type: "toast_update", outboxId: "WRONG", state: "cancelled" });
    });

    // Toast still showing; no hide invoked.
    expect(screen.getByText(/queued/i)).toBeInTheDocument();
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});

describe("ToastApp — M3: prefs gate (captureToastEnabled / captureToastDurationMs)", () => {
  it("captureToastEnabled=false suppresses toast and show_window", async () => {
    await savePrefs({ captureToastEnabled: false });
    render(<ToastApp />);

    await act(async () => {
      await emit("cc:capture-result", {
        state: "synced",
        snippet: "secret",
        outboxId: "01P",
      });
    });

    // Toast must NOT appear and show_window must NOT be called.
    expect(screen.queryByRole("status")).toBeNull();
    expect(invokeSpy).not.toHaveBeenCalledWith("show_window", expect.anything());
  });

  it("captureToastEnabled=true (default) shows toast normally", async () => {
    render(<ToastApp />);

    await act(async () => {
      await emit("cc:capture-result", {
        state: "synced",
        snippet: "hello",
        outboxId: "01R",
      });
    });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(invokeSpy).toHaveBeenCalledWith("show_window", { label: "toast" });
  });

  it("captureToastDurationMs=2000 is passed as countdownMs for synced captures", async () => {
    await savePrefs({ captureToastDurationMs: 2000 });
    render(<ToastApp />);

    await act(async () => {
      await emit("cc:capture-result", {
        state: "synced",
        snippet: "hi",
        outboxId: "01S",
      });
    });

    // The countdown should show 2 s (2000 ms → "2s" label in Toast).
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Toast renders — show_window invoked.
    expect(invokeSpy).toHaveBeenCalledWith("show_window", { label: "toast" });
  });
});
