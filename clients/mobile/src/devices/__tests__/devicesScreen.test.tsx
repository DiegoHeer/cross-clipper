/**
 * devicesScreen.test.tsx — Task 8 TDD step 1.
 *
 * DevicesScreen: renders one row per device; press → navigates to detail.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { SyncProvider } from "../../sync/useSync";
import { SyncController } from "../../sync/SyncController";
import { MemoryStorage } from "@crossclipper/core";
import { DevicesScreen } from "../../screens/DevicesScreen";
import type { Device, WsLike } from "@crossclipper/core";

const AUTH_KEY = "cc.auth";
const AUTH_VALUE = JSON.stringify({
  baseUrl: "http://localhost:8000",
  token: "tok",
  deviceId: "self-device-id",
  deviceName: "Test Device",
});

const Stack = createNativeStackNavigator();

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "device-1",
    name: "My Phone",
    platform: "ios",
    online: true,
    last_seen_at: new Date().toISOString(),
    created_at: "2026-01-01T00:00:00",
    ...overrides,
  } as Device;
}

async function makeController(devices: Device[] = []): Promise<SyncController> {
  const storage = new MemoryStorage();
  await storage.set(AUTH_KEY, AUTH_VALUE);
  await storage.set("cc.devices", JSON.stringify(devices));

  const socketFactory = (_url: string): WsLike => ({
    send: jest.fn(),
    close: jest.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
  });

  const fetchFn = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ items: [], next_cursor: null }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  return new SyncController({ storage, socketFactory, fetchFn });
}

function DetailPlaceholder() {
  const { Text } = require("react-native");
  return <Text>Detail Screen</Text>;
}

function TestWrapper({
  children,
  controller,
}: {
  children: React.ReactNode;
  controller: SyncController;
}) {
  return (
    <ThemeProvider>
      <SyncProvider controller={controller}>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen name="DevicesList" component={() => children as React.JSX.Element} />
            <Stack.Screen name="DeviceDetail" component={DetailPlaceholder} />
          </Stack.Navigator>
        </NavigationContainer>
      </SyncProvider>
    </ThemeProvider>
  );
}

describe("DevicesScreen", () => {
  it("renders one row per device", async () => {
    const devices = [
      makeDevice({ id: "d1", name: "My Phone" }),
      makeDevice({ id: "d2", name: "Work Laptop", platform: "windows" }),
    ];
    const ctrl = await makeController(devices);
    const mockNav = { push: jest.fn() } as unknown as Parameters<typeof DevicesScreen>[0]["navigation"];
    const { getAllByRole, findByText } = render(
      <ThemeProvider>
        <SyncProvider controller={ctrl}>
          <NavigationContainer>
            <DevicesScreen navigation={mockNav} route={{ key: "DevicesList", name: "DevicesList", params: undefined }} />
          </NavigationContainer>
        </SyncProvider>
      </ThemeProvider>,
    );
    await act(async () => {});
    await findByText("My Phone");
    await findByText("Work Laptop");
    // Each device should render as a pressable row
    const rows = getAllByRole("button");
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("shows empty state when no devices", async () => {
    const ctrl = await makeController([]);
    const mockNav = { push: jest.fn() } as unknown as Parameters<typeof DevicesScreen>[0]["navigation"];
    const { findByText } = render(
      <ThemeProvider>
        <SyncProvider controller={ctrl}>
          <NavigationContainer>
            <DevicesScreen navigation={mockNav} route={{ key: "DevicesList", name: "DevicesList", params: undefined }} />
          </NavigationContainer>
        </SyncProvider>
      </ThemeProvider>,
    );
    await act(async () => {});
    await findByText(/no devices/i);
  });

  it("pressing a row navigates to DeviceDetail", async () => {
    const device = makeDevice({ id: "d1", name: "My Phone" });
    const ctrl = await makeController([device]);
    const mockNav = { push: jest.fn() } as unknown as Parameters<typeof DevicesScreen>[0]["navigation"];
    const { findByText } = render(
      <ThemeProvider>
        <SyncProvider controller={ctrl}>
          <NavigationContainer>
            <DevicesScreen navigation={mockNav} route={{ key: "DevicesList", name: "DevicesList", params: undefined }} />
          </NavigationContainer>
        </SyncProvider>
      </ThemeProvider>,
    );
    await act(async () => {});
    const row = await findByText("My Phone");
    fireEvent.press(row);
    expect(mockNav.push).toHaveBeenCalledWith("DeviceDetail", { deviceId: "d1" });
  });
});
