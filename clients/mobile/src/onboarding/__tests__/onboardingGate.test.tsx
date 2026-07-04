/**
 * Tests for the onboarding root gate — TDD step 1 (Task 10).
 *
 * Verifies:
 *  - unauthed snapshot → Onboarding renders
 *  - authRequired → Onboarding renders at sign-in step (server pre-filled, no retry loop)
 *  - authed snapshot → main app (RootNavigator) renders, no Onboarding
 *  - latched gate: signing in (authed broadcast) does NOT unmount Onboarding before step 3
 *  - ready gate: authed cold-start never flashes onboarding (ready=false→true,authed=true)
 *  - ready gate: unauthed cold-start shows onboarding exactly when ready=true
 */
import React from "react";
import { render, act } from "@testing-library/react-native";

// We test the App component (the inner src/App.tsx which has the gate logic)
import AppRoot from "../../App";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock SyncProvider / useSync
const mockSnapshot = {
  status: "stopped" as const,
  items: [],
  devices: [],
  selfDeviceId: null,
  pendingIds: [],
  failedIds: [],
  authRequired: false,
  authed: false,
  ready: true,
};

jest.mock("../../sync/useSync", () => {
  const React = require("react");
  const actual = jest.requireActual("../../sync/useSync");
  return {
    ...actual,
    SyncProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useSync: () => mockSnapshot,
  };
});

// Mock ThemeProvider so useTheme works
jest.mock("../../theme/ThemeProvider", () => {
  const React = require("react");
  const { buildTokens } = require("../../theme/theme");
  const tokens = buildTokens("light", "#d97706");
  const ThemeCtx = React.createContext(tokens);
  const AppCtx = React.createContext({ appearance: { theme: "auto", accent: "#d97706" }, setAppearance: jest.fn() });
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeCtx.Provider, { value: tokens },
        React.createElement(AppCtx.Provider, { value: { appearance: { theme: "auto", accent: "#d97706" }, setAppearance: jest.fn() } }, children)),
    useTheme: () => React.useContext(ThemeCtx),
    useAppearance: () => React.useContext(AppCtx),
  };
});

// Mock navigation
jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return {
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useNavigation: () => ({ navigate: jest.fn() }),
  };
});

jest.mock("../../nav/RootNavigator", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    RootNavigator: () => React.createElement(Text, { testID: "root-navigator" }, "RootNav"),
  };
});

// Mock onboarding so we can detect which step it starts at
jest.mock("../Onboarding", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    Onboarding: ({ mode, initialServer }: { mode?: string; initialServer?: string }) =>
      React.createElement(Text, { testID: "onboarding-component" }, `mode=${mode ?? "fresh"};server=${initialServer ?? ""}`),
  };
});

jest.mock("react-native-gesture-handler", () => {
  const React = require("react");
  return {
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("onboarding root gate", () => {
  beforeEach(() => {
    // Reset to unauthenticated-but-ready by default
    mockSnapshot.authed = false;
    mockSnapshot.authRequired = false;
    mockSnapshot.status = "stopped";
    mockSnapshot.ready = true;
  });

  it("renders Onboarding when unauthenticated", async () => {
    mockSnapshot.authed = false;
    const { getByTestId } = render(<AppRoot />);
    await act(async () => {});
    expect(getByTestId("onboarding-component")).toBeTruthy();
  });

  it("renders RootNavigator when authenticated", async () => {
    mockSnapshot.authed = true;
    const { getByTestId } = render(<AppRoot />);
    await act(async () => {});
    expect(getByTestId("root-navigator")).toBeTruthy();
  });

  it("renders Onboarding in reauth mode when authRequired (server pre-filled)", async () => {
    mockSnapshot.authed = true;
    mockSnapshot.authRequired = true;
    // Need baseUrl to be set in the snapshot
    (mockSnapshot as typeof mockSnapshot & { baseUrl?: string }).baseUrl = "https://clip.example.com";
    const { getByTestId } = render(<AppRoot />);
    await act(async () => {});
    const onboarding = getByTestId("onboarding-component");
    expect(onboarding.children[0]).toMatch(/mode=reauth/);
    expect(onboarding.children[0]).toMatch(/server=https:\/\/clip\.example\.com/);
  });

  it("latched gate: authed=true after initial authed=false keeps Onboarding visible (latch holds until onComplete)", async () => {
    // Start unauthed → onboarding shown
    mockSnapshot.authed = false;
    const { getByTestId, rerender } = render(<AppRoot />);
    await act(async () => {});
    expect(getByTestId("onboarding-component")).toBeTruthy();

    // Simulate auth (e.g. sign-in succeeds) — authed becomes true but latch must hold
    mockSnapshot.authed = true;
    mockSnapshot.authRequired = false;
    await act(async () => { rerender(<AppRoot />); });
    // Onboarding must still be visible (not yet completed step 3)
    expect(getByTestId("onboarding-component")).toBeTruthy();
  });

  it("ready gate (authed cold-start): snapshot starts {ready:false,authed:false} then transitions to {ready:true,authed:true} — onboarding NEVER renders, RootNavigator appears", async () => {
    // Initial state: not ready yet, default false for authed (the race scenario)
    mockSnapshot.ready = false;
    mockSnapshot.authed = false;

    const { queryByTestId, getByTestId, rerender } = render(<AppRoot />);
    await act(async () => {});

    // Before ready: nothing should be latched — neither onboarding nor root nav
    expect(queryByTestId("onboarding-component")).toBeNull();

    // doWake() completes: ready=true, authed=true (real auth state)
    mockSnapshot.ready = true;
    mockSnapshot.authed = true;
    await act(async () => { rerender(<AppRoot />); });

    // Onboarding must NEVER have rendered — RootNavigator is now visible
    expect(queryByTestId("onboarding-component")).toBeNull();
    expect(getByTestId("root-navigator")).toBeTruthy();
  });

  it("ready gate (unauthed cold-start): snapshot starts {ready:false,authed:false} then transitions to {ready:true,authed:false} — onboarding renders exactly then", async () => {
    // Initial state: not ready yet
    mockSnapshot.ready = false;
    mockSnapshot.authed = false;

    const { queryByTestId, getByTestId, rerender } = render(<AppRoot />);
    await act(async () => {});

    // Before ready: nothing shown
    expect(queryByTestId("onboarding-component")).toBeNull();

    // doWake() completes with no auth
    mockSnapshot.ready = true;
    mockSnapshot.authed = false;
    await act(async () => { rerender(<AppRoot />); });

    // Now onboarding must be visible
    expect(getByTestId("onboarding-component")).toBeTruthy();
  });
});
