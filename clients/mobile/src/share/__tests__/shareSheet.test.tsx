/**
 * shareSheet.test.tsx — Task 13 TDD step 1 (failing → pass after implementation).
 *
 * A2 tile row: silent-broadcast accented first tile, device tiles with presence
 * dots, self excluded, last-used hoisted, tap = send + "Sent ✓" + auto-dismiss.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { ShareSheet } from "../ShareSheet";
import type { Device } from "@crossclipper/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDevice(
  id: string,
  name: string,
  online = true,
): Device {
  return {
    id,
    name,
    platform: "ios",
    online,
    last_seen_at: "2026-01-01T00:00:00",
    created_at: "2026-01-01T00:00:00",
  } as unknown as Device;
}

const SELF_ID = "self-device-id";
const PHONE = makeDevice("phone-id", "My Phone");
const TABLET = makeDevice("tablet-id", "My Tablet", false);
const SELF = makeDevice(SELF_ID, "My iPhone");

const DEVICES = [SELF, PHONE, TABLET];

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ShareSheet (A2 tile row)", () => {
  const shared = { kind: "text" as const, body: "hello world" };

  describe("tile rendering", () => {
    it("renders a silent-broadcast tile first", () => {
      const { getAllByRole } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={jest.fn()}
            onError={jest.fn()}
            sendFn={jest.fn()}
          />
        </Wrapper>,
      );
      const buttons = getAllByRole("button");
      // First button is broadcast tile
      expect(buttons[0].props.accessibilityLabel ?? buttons[0].props["aria-label"]).toMatch(
        /everyone|broadcast|all/i,
      );
    });

    it("excludes self device from tiles", () => {
      const { queryByRole } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={jest.fn()}
            onError={jest.fn()}
            sendFn={jest.fn()}
          />
        </Wrapper>,
      );
      expect(queryByRole("button", { name: /my iphone/i })).toBeNull();
    });

    it("renders tiles for non-self devices", () => {
      const { getByRole } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={jest.fn()}
            onError={jest.fn()}
            sendFn={jest.fn()}
          />
        </Wrapper>,
      );
      expect(getByRole("button", { name: /my phone/i })).toBeTruthy();
      expect(getByRole("button", { name: /my tablet/i })).toBeTruthy();
    });

    it("online device has presence dot", () => {
      const { getByTestId } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={jest.fn()}
            onError={jest.fn()}
            sendFn={jest.fn()}
          />
        </Wrapper>,
      );
      // Presence dot for online device
      expect(getByTestId("presence-dot-phone-id")).toBeTruthy();
    });

    it("offline device has no presence dot", () => {
      const { queryByTestId } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={jest.fn()}
            onError={jest.fn()}
            sendFn={jest.fn()}
          />
        </Wrapper>,
      );
      expect(queryByTestId("presence-dot-tablet-id")).toBeNull();
    });
  });

  describe("broadcast tile (silent, no target_device_id)", () => {
    it("tapping broadcast tile calls sendFn without target_device_id", async () => {
      const sendFn = jest.fn().mockResolvedValue({ status: "sent", item: { id: "x" } });
      const onSent = jest.fn();
      const { getAllByRole } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={onSent}
            onError={jest.fn()}
            sendFn={sendFn}
          />
        </Wrapper>,
      );
      const broadcastBtn = getAllByRole("button")[0];
      await act(async () => {
        fireEvent.press(broadcastBtn);
      });
      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "text", body: "hello world" }),
      );
      // Critically: no target_device_id in the call
      expect(sendFn.mock.calls[0][0].targetDeviceId).toBeUndefined();
    });
  });

  describe("device tile", () => {
    it("tapping a device tile calls sendFn with that target_device_id", async () => {
      const sendFn = jest.fn().mockResolvedValue({ status: "sent", item: { id: "x" } });
      const { getByRole } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={jest.fn()}
            onError={jest.fn()}
            sendFn={sendFn}
          />
        </Wrapper>,
      );
      await act(async () => {
        fireEvent.press(getByRole("button", { name: /my phone/i }));
      });
      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "text", body: "hello world", targetDeviceId: "phone-id" }),
      );
    });
  });

  describe("post-send feedback", () => {
    it("shows 'Sent ✓' after successful send", async () => {
      const sendFn = jest.fn().mockResolvedValue({ status: "sent", item: { id: "x" } });
      const { getAllByRole, findByText } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={jest.fn()}
            onError={jest.fn()}
            sendFn={sendFn}
          />
        </Wrapper>,
      );
      await act(async () => {
        fireEvent.press(getAllByRole("button")[0]);
      });
      expect(await findByText(/sent\s*✓/i)).toBeTruthy();
    });

    it("calls onSent after successful send", async () => {
      const sendFn = jest.fn().mockResolvedValue({ status: "sent", item: { id: "x" } });
      const onSent = jest.fn();
      const { getAllByRole } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={onSent}
            onError={jest.fn()}
            sendFn={sendFn}
          />
        </Wrapper>,
      );
      await act(async () => {
        fireEvent.press(getAllByRole("button")[0]);
      });
      expect(onSent).toHaveBeenCalled();
    });

    it("calls onError when sendFn returns queued status", async () => {
      const sendFn = jest
        .fn()
        .mockResolvedValue({ status: "queued", retryHint: "open app to retry" });
      const onError = jest.fn();
      const { getAllByRole } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            onSent={jest.fn()}
            onError={onError}
            sendFn={sendFn}
          />
        </Wrapper>,
      );
      await act(async () => {
        fireEvent.press(getAllByRole("button")[0]);
      });
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/open app/i));
    });
  });

  describe("last-used hoist", () => {
    it("hoists last-used device to second position (after broadcast tile)", () => {
      const { getAllByRole } = render(
        <Wrapper>
          <ShareSheet
            shared={shared}
            devices={DEVICES}
            selfDeviceId={SELF_ID}
            lastUsedDeviceId="tablet-id"
            onSent={jest.fn()}
            onError={jest.fn()}
            sendFn={jest.fn()}
          />
        </Wrapper>,
      );
      const buttons = getAllByRole("button");
      // buttons[0] = broadcast, buttons[1] = last-used (tablet)
      const secondLabel =
        buttons[1].props.accessibilityLabel ?? buttons[1].props["aria-label"] ?? "";
      expect(secondLabel).toMatch(/my tablet/i);
    });
  });
});
