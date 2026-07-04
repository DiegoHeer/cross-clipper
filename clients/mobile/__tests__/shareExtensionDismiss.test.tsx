/**
 * shareExtensionDismiss.test.tsx — Finding 2 TDD coverage.
 *
 * Verifies that the onSent callback wired in index.share.tsx calls
 * expo-share-extension's close() after DISMISS_DELAY_MS when a send succeeds.
 *
 * Uses fake timers so the delay is asserted without real waiting.
 * The expo-share-extension module is mocked via jest.setup.ts (virtual: true).
 */
import React from "react";
import { render, act, fireEvent } from "@testing-library/react-native";
import { close as mockClose } from "expo-share-extension";
import { DISMISS_DELAY_MS } from "../index.share";

// ─── Module mocks ─────────────────────────────────────────────────────────────

// appGroup singleton must return a valid bundle so ShareRoot bypasses the
// "Sign in to CrossClipper" gate and renders ShareSheet.
jest.mock("../src/platform/appGroup", () => ({
  appGroup: {
    readAuth: jest.fn().mockResolvedValue({
      baseUrl: "https://cc.example.com",
      token: "tok-abc",
      deviceId: "dev-1",
      deviceName: "My iPhone",
    }),
    writeAuth: jest.fn(),
    clearAuth: jest.fn(),
    pushToMainOutbox: jest.fn(),
    drainMainOutbox: jest.fn().mockResolvedValue([]),
  },
  makeAppGroup: jest.requireActual("../src/platform/appGroup").makeAppGroup,
}));

// sendDirect always succeeds so the onSent path is reached.
jest.mock("../src/share/sendDirect", () => ({
  sendDirect: jest.fn().mockResolvedValue({ status: "sent", item: { id: "test-id" } }),
}));

// expo must be mocked to prevent registerRootComponent from running in jest.
jest.mock("expo", () => ({
  registerRootComponent: jest.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

// Static import — mocks registered above via jest.mock() hoist before imports.
import ShareExtensionRoot from "../index.share";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ShareRoot — dismiss after sent feedback (Finding 2)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (mockClose as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Explicit timeout: fake-timer tests flush async microtasks (Promise.resolve()
  // chains) inside act(), which adds measurable overhead under full-suite worker
  // contention. 15 s gives a 10×+ safety margin over the ~1.2 s DISMISS_DELAY_MS
  // while staying well under CI limits.
  it("calls close() after DISMISS_DELAY_MS when onSent fires", async () => {
    const { getAllByRole } = render(<ShareExtensionRoot />);

    // Wait for the useEffect (readAuth) to resolve and re-render
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Tap the broadcast tile (first button) — triggers sendDirect → onSent
    const buttons = getAllByRole("button");
    await act(async () => {
      fireEvent.press(buttons[0]);
      // Let sendDirect promise resolve
      await Promise.resolve();
      await Promise.resolve();
    });

    // close() must NOT be called immediately (delay is pending)
    expect(mockClose).not.toHaveBeenCalled();

    // Advance fake timers past the dismiss delay
    act(() => {
      jest.advanceTimersByTime(DISMISS_DELAY_MS);
    });

    expect(mockClose).toHaveBeenCalledTimes(1);
  }, 15000);
});
