/**
 * RootNavigator tests — TDD step 1 (failing).
 *
 * Renders RootNavigator inside test providers and asserts:
 * - Three tab labels (Feed, Devices, Settings) are visible.
 * - Pressing "Devices" navigates to the devices screen.
 * - Pressing "Settings" navigates to the settings screen.
 */
import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ThemeProvider } from "../../theme/ThemeProvider";
import { SyncProvider } from "../../sync/useSync";
import { SyncController } from "../../sync/SyncController";
import { MemoryStorage } from "@crossclipper/core";
import { RootNavigator } from "../RootNavigator";
import type { WsLike } from "@crossclipper/core";

// ─── Fake controller ─────────────────────────────────────────────────────────

async function makeController(): Promise<SyncController> {
  const storage = new MemoryStorage();
  const socketFactory = (_url: string): WsLike => ({
    send: jest.fn(),
    close: jest.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
  });
  const fetchFn = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ items: [], next_cursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  return new SyncController({ storage, socketFactory, fetchFn });
}

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function TestWrapper({
  children,
  controller,
}: {
  children: React.ReactNode;
  controller: SyncController;
}) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SyncProvider controller={controller}>
          <NavigationContainer>{children}</NavigationContainer>
        </SyncProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RootNavigator", () => {
  let controller: SyncController | null = null;

  afterEach(async () => {
    // Release engine/outbox timers so the worker can exit cleanly.
    // Wrap in act() because sleep() emits a state update (status → "stopped").
    if (controller) {
      await act(async () => { controller!.sleep(); });
      controller = null;
    }
  });

  it("renders three bottom tab labels", async () => {
    controller = await makeController();
    const { getByRole } = render(
      <TestWrapper controller={controller}>
        <RootNavigator />
      </TestWrapper>,
    );

    // Each tab renders as an accessible button with the tab label as its name.
    await waitFor(() => {
      expect(getByRole("button", { name: "Feed" })).toBeTruthy();
      expect(getByRole("button", { name: "Devices" })).toBeTruthy();
      expect(getByRole("button", { name: "Settings" })).toBeTruthy();
    });
  });

  it("pressing Devices tab shows the devices screen placeholder", async () => {
    controller = await makeController();
    const { getByRole, getByText } = render(
      <TestWrapper controller={controller}>
        <RootNavigator />
      </TestWrapper>,
    );

    // Wait for the tab bar to mount, then press the Devices tab button.
    await waitFor(() => expect(getByRole("button", { name: "Devices" })).toBeTruthy());
    fireEvent.press(getByRole("button", { name: "Devices" }));

    // The DevicesScreen renders a "No devices" or similar message
    await waitFor(() => {
      expect(getByText("No devices")).toBeTruthy();
    });
  });

  it("pressing Settings tab shows the settings screen placeholder", async () => {
    controller = await makeController();
    const { getByRole, getByText } = render(
      <TestWrapper controller={controller}>
        <RootNavigator />
      </TestWrapper>,
    );

    await waitFor(() => expect(getByRole("button", { name: "Settings" })).toBeTruthy());
    fireEvent.press(getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      // Settings screen renders section headers (Task 9 full implementation)
      expect(getByText("APPEARANCE")).toBeTruthy();
    });
  });
});
