/**
 * notificationsSection.test.tsx — Task 9 TDD step 1.
 *
 * NotificationsSection: "Always ✓" non-configurable text; toggle calls savePrefs.
 */
import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { NotificationsSection } from "../NotificationsSection";

jest.mock("../prefs", () => ({
  loadPrefs: jest.fn().mockResolvedValue({ notifyOnNewItems: false }),
  savePrefs: jest.fn().mockResolvedValue(undefined),
  DEFAULT_PREFS: { notifyOnNewItems: false },
  PREFS_KEY: "cc.prefs",
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("NotificationsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset loadPrefs mock
    const { loadPrefs } = require("../prefs") as { loadPrefs: jest.Mock };
    loadPrefs.mockResolvedValue({ notifyOnNewItems: false });
  });

  it("renders the non-configurable 'Always ✓' line for targeted notifications", async () => {
    const { findByText } = render(
      <Wrapper>
        <NotificationsSection />
      </Wrapper>,
    );
    await act(async () => {});
    await findByText("Always ✓");
  });

  it("renders the notify-on-all-items toggle", async () => {
    const { findByTestId } = render(
      <Wrapper>
        <NotificationsSection />
      </Wrapper>,
    );
    await act(async () => {});
    const toggle = await findByTestId("notify-all-switch");
    expect(toggle).toBeTruthy();
  });

  it("toggling the switch calls savePrefs with flipped value", async () => {
    const { savePrefs } = require("../prefs") as { savePrefs: jest.Mock };
    const { findByTestId } = render(
      <Wrapper>
        <NotificationsSection />
      </Wrapper>,
    );
    await act(async () => {});

    const toggle = await findByTestId("notify-all-switch");
    fireEvent(toggle, "valueChange", true);

    await waitFor(() => {
      expect(savePrefs).toHaveBeenCalledWith({ notifyOnNewItems: true });
    });
  });
});
