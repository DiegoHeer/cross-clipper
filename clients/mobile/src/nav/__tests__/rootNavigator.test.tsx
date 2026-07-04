/**
 * RootNavigator tests — TDD step 1 (failing).
 *
 * Renders RootNavigator inside test providers and asserts:
 * - Three tab labels (Feed, Devices, Settings) are visible.
 * - Pressing "Devices" navigates to the devices screen.
 * - Pressing "Settings" navigates to the settings screen.
 */
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
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
  it("renders three bottom tab labels", async () => {
    const controller = await makeController();
    const { getAllByText } = render(
      <TestWrapper controller={controller}>
        <RootNavigator />
      </TestWrapper>,
    );

    // Tab labels appear at least once (may also appear as screen headings)
    await waitFor(() => {
      expect(getAllByText("Feed").length).toBeGreaterThanOrEqual(1);
      expect(getAllByText("Devices").length).toBeGreaterThanOrEqual(1);
      expect(getAllByText("Settings").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("pressing Devices tab shows the devices screen placeholder", async () => {
    const controller = await makeController();
    const { getAllByText, getByText } = render(
      <TestWrapper controller={controller}>
        <RootNavigator />
      </TestWrapper>,
    );

    await waitFor(() => expect(getAllByText("Devices").length).toBeGreaterThanOrEqual(1));

    // Press the "Devices" tab label (first occurrence = tab bar)
    fireEvent.press(getAllByText("Devices")[0]!);

    // The DevicesScreen renders a "No devices" or similar message
    await waitFor(() => {
      expect(getByText("No devices")).toBeTruthy();
    });
  });

  it("pressing Settings tab shows the settings screen placeholder", async () => {
    const controller = await makeController();
    const { getAllByText, getByText } = render(
      <TestWrapper controller={controller}>
        <RootNavigator />
      </TestWrapper>,
    );

    await waitFor(() => expect(getAllByText("Settings").length).toBeGreaterThanOrEqual(1));

    fireEvent.press(getAllByText("Settings")[0]!);

    await waitFor(() => {
      // Settings screen renders section headers (Task 9 full implementation)
      expect(getByText("APPEARANCE")).toBeTruthy();
    });
  });
});
