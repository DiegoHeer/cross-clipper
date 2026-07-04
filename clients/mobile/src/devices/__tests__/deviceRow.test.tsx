/**
 * deviceRow.test.tsx — Task 8 TDD step 1.
 *
 * DeviceRow: presence dot, "this device" badge, 14-day stale nudge.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { DeviceRow } from "../DeviceRow";
import type { Device } from "@crossclipper/core";

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "device-1",
    name: "My Phone",
    platform: "ios",
    online: false,
    last_seen_at: new Date().toISOString(),
    created_at: "2026-01-01T00:00:00",
    ...overrides,
  } as Device;
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("DeviceRow", () => {
  it("renders online dot for online device", () => {
    const device = makeDevice({ online: true });
    const { getByTestId } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(getByTestId("presence-dot-online")).toBeTruthy();
  });

  it("renders offline dot for offline device", () => {
    const device = makeDevice({ online: false });
    const { getByTestId } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(getByTestId("presence-dot-offline")).toBeTruthy();
  });

  it("shows 'this device' badge when isSelf is true", () => {
    const device = makeDevice();
    const { getByText } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={true} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(getByText(/this device/i)).toBeTruthy();
  });

  it("does not show badge when isSelf is false", () => {
    const device = makeDevice();
    const { queryByText } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(queryByText(/this device/i)).toBeNull();
  });

  it("shows stale nudge when last_seen_at is >14 days ago", () => {
    const staleDateMs = Date.now() - 15 * 24 * 60 * 60 * 1000;
    const device = makeDevice({
      online: false,
      last_seen_at: new Date(staleDateMs).toISOString(),
    });
    const { getByText } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(getByText(/Revoke\?/i)).toBeTruthy();
  });

  it("does not show stale nudge when last_seen_at is <14 days ago", () => {
    const recentDateMs = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const device = makeDevice({
      online: false,
      last_seen_at: new Date(recentDateMs).toISOString(),
    });
    const { queryByText } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(queryByText(/Revoke\?/i)).toBeNull();
  });

  it("does not show stale nudge for online device even if last_seen_at is old", () => {
    const staleDateMs = Date.now() - 20 * 24 * 60 * 60 * 1000;
    const device = makeDevice({
      online: true,
      last_seen_at: new Date(staleDateMs).toISOString(),
    });
    const { queryByText } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(queryByText(/Revoke\?/i)).toBeNull();
  });

  it("renders device name", () => {
    const device = makeDevice({ name: "Work Laptop" });
    const { getByText } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(getByText("Work Laptop")).toBeTruthy();
  });

  it("shows 'online now' for online device", () => {
    const device = makeDevice({ online: true });
    const { getByText } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={jest.fn()} />
      </Wrapper>,
    );
    expect(getByText(/online now/i)).toBeTruthy();
  });

  it("calls onPress when row is pressed", () => {
    const onPress = jest.fn();
    const device = makeDevice();
    const { getByRole } = render(
      <Wrapper>
        <DeviceRow device={device} isSelf={false} onPress={onPress} />
      </Wrapper>,
    );
    const { fireEvent } = require("@testing-library/react-native");
    fireEvent.press(getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
