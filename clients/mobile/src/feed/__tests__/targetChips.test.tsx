/**
 * targetChips.test.tsx — Task 7 TDD step 1 (failing).
 *
 * TargetChips: excludes self, defaults to silent, selecting chip reports id.
 */
import React, { useState } from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { TargetChips } from "../TargetChips";
import type { Device } from "@crossclipper/core";

function makeDevice(id: string, name: string): Device {
  return {
    id,
    name,
    platform: "ios",
    online: true,
    last_seen_at: "2026-01-01T00:00:00",
    created_at: "2026-01-01T00:00:00",
  } as unknown as Device;
}

const SELF_ID = "self-device-id";
const OTHER = makeDevice("other-device-id", "iPad");
const SELF = makeDevice(SELF_ID, "My iPhone");

const DEVICES = [SELF, OTHER];

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("TargetChips", () => {
  it("excludes the self device", () => {
    const { queryByRole } = render(
      <Wrapper>
        <TargetChips
          devices={DEVICES}
          selfDeviceId={SELF_ID}
          value={null}
          onChange={() => {}}
        />
      </Wrapper>,
    );
    // Self device button should NOT be present
    expect(queryByRole("button", { name: /my iphone/i })).toBeNull();
    // Other device button SHOULD be present
    expect(queryByRole("button", { name: /ipad/i })).toBeTruthy();
  });

  it("has Silent chip selected by default (value=null)", () => {
    const { getByRole } = render(
      <Wrapper>
        <TargetChips
          devices={DEVICES}
          selfDeviceId={SELF_ID}
          value={null}
          onChange={() => {}}
        />
      </Wrapper>,
    );
    const silentBtn = getByRole("button", { name: /silent/i });
    // aria-pressed = true when selected
    expect(silentBtn.props.accessibilityState?.selected ?? silentBtn.props["aria-pressed"]).toBeTruthy();
  });

  it("calls onChange with device id when a device chip is pressed", () => {
    const onChange = jest.fn();
    const { getByRole } = render(
      <Wrapper>
        <TargetChips
          devices={DEVICES}
          selfDeviceId={SELF_ID}
          value={null}
          onChange={onChange}
        />
      </Wrapper>,
    );
    fireEvent.press(getByRole("button", { name: /ipad/i }));
    expect(onChange).toHaveBeenCalledWith("other-device-id");
  });

  it("calls onChange with null when Silent is pressed", () => {
    const onChange = jest.fn();
    const { getByRole } = render(
      <Wrapper>
        <TargetChips
          devices={DEVICES}
          selfDeviceId={SELF_ID}
          value={"other-device-id"}
          onChange={onChange}
        />
      </Wrapper>,
    );
    fireEvent.press(getByRole("button", { name: /silent/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows selected chip when value matches a device id", () => {
    const { getByRole } = render(
      <Wrapper>
        <TargetChips
          devices={DEVICES}
          selfDeviceId={SELF_ID}
          value={"other-device-id"}
          onChange={() => {}}
        />
      </Wrapper>,
    );
    const ipadBtn = getByRole("button", { name: /ipad/i });
    expect(ipadBtn.props.accessibilityState?.selected ?? ipadBtn.props["aria-pressed"]).toBeTruthy();
  });
});
