/**
 * AndroidShareModal — sheet surface token test (M2).
 *
 * Bug: the `sheet` StyleSheet entry hardcoded backgroundColor "#fff", which is
 * wrong in dark mode (and technically wrong even in light mode, since the token
 * value is "#ffffff" not "#fff"). The fix replaces the static style with a
 * runtime value from `tokens.surface` via useTheme().
 *
 * Test strategy:
 *   Case 1 (light, default): render with ThemeProvider default (light).
 *     Assert sheet backgroundColor === tokens.surface ("#ffffff"), NOT "#fff".
 *   Case 2 (dark): pre-seed AsyncStorage with dark appearance, render, wait for
 *     ThemeProvider's AsyncStorage effect to update tokens, then assert the sheet
 *     uses dark surface ("#1e293b").
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { buildTokens, APPEARANCE_KEY } from "../../theme/theme";

// ─── Mock dependencies that AndroidShareModal pulls in ────────────────────────

jest.mock("../../sync/useSync", () => ({
  useSync: () => ({
    send: jest.fn(),
    devices: [],
    selfDeviceId: "self-01",
    items: [],
    status: "idle",
    lastUsedDeviceId: null,
    onSignedIn: jest.fn(),
    signOut: jest.fn(),
    remove: jest.fn(),
    renameDevice: jest.fn(),
    revokeDevice: jest.fn(),
  }),
}));

// Force Platform.OS to android so the component renders (not null).
jest.mock("react-native/Libraries/Utilities/Platform", () => ({
  OS: "android",
  select: (map: Record<string, unknown>) => map["android"],
}));

import { AndroidShareModal } from "../AndroidShareModal";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../nav/RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "AndroidShare">;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProps(): Props {
  return {
    route: {
      key: "AndroidShare",
      name: "AndroidShare" as const,
      params: { shared: { type: "text" as const, value: "hello" } },
    } as unknown as Props["route"],
    navigation: {
      goBack: jest.fn(),
      navigate: jest.fn(),
      dispatch: jest.fn(),
      reset: jest.fn(),
      isFocused: jest.fn().mockReturnValue(true),
      canGoBack: jest.fn().mockReturnValue(true),
      getId: jest.fn(),
      getState: jest.fn(),
      getParent: jest.fn(),
      addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
      removeListener: jest.fn(),
      setOptions: jest.fn(),
      setParams: jest.fn(),
      replace: jest.fn(),
      push: jest.fn(),
      pop: jest.fn(),
      popToTop: jest.fn(),
    } as unknown as Props["navigation"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AndroidShareModal — sheet surface token (M2)", () => {
  afterEach(async () => {
    await AsyncStorage.removeItem(APPEARANCE_KEY);
  });

  it("sheet backgroundColor uses tokens.surface (light), not the '#fff' literal", () => {
    // In jest, useColorScheme() returns null → resolved scheme is "light".
    const lightTokens = buildTokens("light", "#d97706");

    const { getByTestId } = render(
      <ThemeProvider>
        <AndroidShareModal {...makeProps()} />
      </ThemeProvider>,
    );

    const sheetEl = getByTestId("android-share-sheet-container");
    const flatStyle = StyleSheet.flatten(sheetEl.props.style as object) as { backgroundColor?: string };

    // Must equal the light surface token — not the old literal "#fff".
    expect(flatStyle.backgroundColor).toBe(lightTokens.surface); // "#ffffff"
    // Sanity: confirm the token value IS "#ffffff" (test is meaningful).
    expect(lightTokens.surface).toBe("#ffffff");
    // The hardcoded bug value was "#fff" — different string, would fail here.
    expect(flatStyle.backgroundColor).not.toBe("#fff");
  });

  it("sheet backgroundColor uses dark tokens.surface when theme is pinned dark", async () => {
    const darkTokens = buildTokens("dark", "#d97706");

    // Pre-seed AsyncStorage so ThemeProvider loads "dark" on mount.
    await AsyncStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ theme: "dark", accent: "#d97706" }),
    );

    const { getByTestId } = render(
      <ThemeProvider>
        <AndroidShareModal {...makeProps()} />
      </ThemeProvider>,
    );

    // Wait for ThemeProvider's useEffect to read AsyncStorage and update tokens.
    await waitFor(() => {
      const sheetEl = getByTestId("android-share-sheet-container");
      const flatStyle = StyleSheet.flatten(sheetEl.props.style as object) as { backgroundColor?: string };
      // Dark surface is "#1e293b" — impossible to reach with hardcoded "#fff".
      expect(flatStyle.backgroundColor).toBe(darkTokens.surface);
    });
  });
});
