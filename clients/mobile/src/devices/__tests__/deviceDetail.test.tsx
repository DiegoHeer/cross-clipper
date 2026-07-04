/**
 * deviceDetail.test.tsx — Task 8 TDD step 1.
 *
 * DeviceDetailScreen: rename, revoke confirm, send test notification, jump to feed.
 */
import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { SyncProvider } from "../../sync/useSync";
import { SyncController } from "../../sync/SyncController";
import { MemoryStorage } from "@crossclipper/core";
import { DeviceDetailScreen } from "../../screens/DeviceDetailScreen";
import type { Device, WsLike } from "@crossclipper/core";

const AUTH_KEY = "cc.auth";
const AUTH_VALUE = JSON.stringify({
  baseUrl: "http://localhost:8000",
  token: "tok",
  deviceId: "self-device-id",
  deviceName: "Test Device",
});

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

async function makeController(
  devices: Device[] = [],
  overrideFetch?: jest.Mock,
): Promise<{
  ctrl: SyncController;
  mockRenameDevice: jest.Mock;
  mockRevokeDevice: jest.Mock;
  mockSend: jest.Mock;
}> {
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

  const fetchFn =
    overrideFetch ??
    jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], next_cursor: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

  const ctrl = new SyncController({ storage, socketFactory, fetchFn });

  const mockRenameDevice = jest.spyOn(ctrl, "renameDevice") as unknown as jest.Mock;
  mockRenameDevice.mockResolvedValue(undefined);

  const mockRevokeDevice = jest.spyOn(ctrl, "revokeDevice") as unknown as jest.Mock;
  mockRevokeDevice.mockResolvedValue(undefined);

  const mockSend = jest.spyOn(ctrl, "send") as unknown as jest.Mock;
  mockSend.mockResolvedValue("outbox-id");

  return { ctrl, mockRenameDevice, mockRevokeDevice, mockSend };
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
        <NavigationContainer>{children}</NavigationContainer>
      </SyncProvider>
    </ThemeProvider>
  );
}

describe("DeviceDetailScreen", () => {
  it("renders device name in heading", async () => {
    const device = makeDevice({ id: "device-1", name: "My Phone" });
    const { ctrl } = await makeController([device]);
    const mockNav = { navigate: jest.fn(), goBack: jest.fn() } as unknown as Parameters<typeof DeviceDetailScreen>[0]["navigation"];
    const mockRoute = { params: { deviceId: "device-1" }, key: "DeviceDetail", name: "DeviceDetail" as const };

    const { findByText } = render(
      <TestWrapper controller={ctrl}>
        <DeviceDetailScreen navigation={mockNav} route={mockRoute} />
      </TestWrapper>,
    );
    await act(async () => {});
    await findByText("My Phone");
  });

  it("rename submits via the renameDevice action", async () => {
    const device = makeDevice({ id: "device-1", name: "My Phone" });
    const { ctrl, mockRenameDevice } = await makeController([device]);
    const mockNav = { navigate: jest.fn(), goBack: jest.fn() } as unknown as Parameters<typeof DeviceDetailScreen>[0]["navigation"];
    const mockRoute = { params: { deviceId: "device-1" }, key: "DeviceDetail", name: "DeviceDetail" as const };

    const { findByPlaceholderText, getByRole } = render(
      <TestWrapper controller={ctrl}>
        <DeviceDetailScreen navigation={mockNav} route={mockRoute} />
      </TestWrapper>,
    );
    await act(async () => {});

    const input = await findByPlaceholderText(/new name/i);
    fireEvent.changeText(input, "Work Phone");
    fireEvent.press(getByRole("button", { name: /rename/i }));

    await waitFor(() => {
      expect(mockRenameDevice).toHaveBeenCalledWith("device-1", "Work Phone");
    });
  });

  it("revoke requires the one-line confirm before calling revokeDevice", async () => {
    const device = makeDevice({ id: "device-1", name: "My Phone" });
    const { ctrl, mockRevokeDevice } = await makeController([device]);
    const mockNav = { navigate: jest.fn(), goBack: jest.fn() } as unknown as Parameters<typeof DeviceDetailScreen>[0]["navigation"];
    const mockRoute = { params: { deviceId: "device-1" }, key: "DeviceDetail", name: "DeviceDetail" as const };

    const { getByRole, findByRole } = render(
      <TestWrapper controller={ctrl}>
        <DeviceDetailScreen navigation={mockNav} route={mockRoute} />
      </TestWrapper>,
    );
    await act(async () => {});

    // Press revoke — should show confirm, not call yet
    fireEvent.press(getByRole("button", { name: /revoke/i }));
    expect(mockRevokeDevice).not.toHaveBeenCalled();

    // Confirm button appears
    const confirmBtn = await findByRole("button", { name: /confirm revoke/i });
    fireEvent.press(confirmBtn);

    await waitFor(() => {
      expect(mockRevokeDevice).toHaveBeenCalledWith("device-1");
    });
  });

  it("send test notification calls send with targetDeviceId", async () => {
    const device = makeDevice({ id: "device-1", name: "My Phone" });
    const { ctrl, mockSend } = await makeController([device]);
    const mockNav = { navigate: jest.fn(), goBack: jest.fn() } as unknown as Parameters<typeof DeviceDetailScreen>[0]["navigation"];
    const mockRoute = { params: { deviceId: "device-1" }, key: "DeviceDetail", name: "DeviceDetail" as const };

    const { getByRole } = render(
      <TestWrapper controller={ctrl}>
        <DeviceDetailScreen navigation={mockNav} route={mockRoute} />
      </TestWrapper>,
    );
    await act(async () => {});

    fireEvent.press(getByRole("button", { name: /send test notification/i }));

    await waitFor(() => {
      expect(mockSend).toHaveBeenCalledWith("text", expect.any(String), "device-1");
    });
  });

  it("jump to feed navigates to Feed tab with originDeviceId param", async () => {
    const device = makeDevice({ id: "device-1", name: "My Phone" });
    const { ctrl } = await makeController([device]);
    const mockNav = { navigate: jest.fn(), goBack: jest.fn() } as unknown as Parameters<typeof DeviceDetailScreen>[0]["navigation"];
    const mockRoute = { params: { deviceId: "device-1" }, key: "DeviceDetail", name: "DeviceDetail" as const };

    const { getByRole } = render(
      <TestWrapper controller={ctrl}>
        <DeviceDetailScreen navigation={mockNav} route={mockRoute} />
      </TestWrapper>,
    );
    await act(async () => {});

    fireEvent.press(getByRole("button", { name: /jump to feed/i }));

    expect(mockNav.navigate).toHaveBeenCalledWith("Feed", { originDeviceId: "device-1" });
  });
});
