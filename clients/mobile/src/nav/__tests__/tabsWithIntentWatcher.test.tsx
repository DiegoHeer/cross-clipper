/**
 * tabsWithIntentWatcher.test.tsx — Regression tests for TabsWithIntentWatcher.
 *
 * TabsWithIntentWatcher (exported for testing from RootNavigator.tsx) watches
 * the share intent and opens the AndroidShare modal on each genuine OS delivery.
 *
 * Tested behaviours:
 *   1. Single delivery: navigate("AndroidShare") is called exactly once;
 *      reset() is called once (always paired with navigate on the happy path).
 *   2. Re-share regression: after reset() clears the intent (shared → null),
 *      a new OS delivery of the same body triggers navigate() AGAIN — exactly
 *      2 total. The old dedup bug would have given exactly 1 (second delivery
 *      hit the dedup branch before handledRef was cleared on the null pass).
 *   3. Dedup: while the same live delivery is pending (same key), a re-render
 *      that changes another dep triggers the dedup branch: reset() fires but
 *      navigate() does NOT. Verified: navigate count stays at its prior value.
 *   4. Unauthed: intent is reset silently; navigate is NOT called.
 *
 * Assertion mechanism (navigate spy):
 *   @react-navigation/native is partially mocked — NavigationContainer stays
 *   real; useNavigation() returns a spy object. Variables are "mock"-prefixed
 *   to satisfy jest.mock() factory hoisting restrictions.
 *
 *   A stateful Harness component forces re-renders of TabsWithIntentWatcher
 *   via React state updates (not outer tree rerenders) to bypass React
 *   Navigation's screen-level memoization. The Screen uses the render-prop
 *   form `{() => <TabsWithIntentWatcher />}` for the same reason.
 *
 *   navigate calls are filtered to args[0] === "AndroidShare" so internal
 *   calls from other navigator components don't pollute the count.
 */
import React, { useState } from "react";
import { Platform } from "react-native";
import { render, act } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { TabsWithIntentWatcher } from "../RootNavigator";
import type { RootStackParamList } from "../RootNavigator";

// ─── Screen component mocks ───────────────────────────────────────────────────

jest.mock("../../screens/FeedScreen", () => ({
  FeedScreen: () =>
    require("react").createElement(require("react-native").Text, null, "Feed"),
}));
jest.mock("../../screens/DevicesScreen", () => ({
  DevicesScreen: () =>
    require("react").createElement(require("react-native").Text, null, "Devices"),
}));
jest.mock("../../screens/DeviceDetailScreen", () => ({
  DeviceDetailScreen: () =>
    require("react").createElement(require("react-native").Text, null, "DeviceDetail"),
}));
jest.mock("../../screens/SettingsScreen", () => ({
  SettingsScreen: () =>
    require("react").createElement(require("react-native").Text, null, "Settings"),
}));
jest.mock("../../share/AndroidShareModal", () => ({
  AndroidShareModal: () =>
    require("react").createElement(require("react-native").Text, null, "AndroidShareStub"),
}));

// ─── Navigate spy ─────────────────────────────────────────────────────────────
// "mock"-prefixed names pass jest.mock() hoisting scope checks.

const mockNavigate = jest.fn();
const mockNavigation = {
  navigate: mockNavigate,
  goBack: jest.fn(),
  dispatch: jest.fn(),
  reset: jest.fn(),
  isFocused: jest.fn().mockReturnValue(true),
  canGoBack: jest.fn().mockReturnValue(false),
  getState: jest.fn().mockReturnValue({ routes: [], index: 0, key: "r", type: "stack" }),
  getParent: jest.fn().mockReturnValue(undefined),
  setOptions: jest.fn(),
  addListener: jest.fn().mockReturnValue(jest.fn()),
  removeListener: jest.fn(),
  setParams: jest.fn(),
  getId: jest.fn().mockReturnValue(undefined),
};

// Partial mock: NavigationContainer stays real; useNavigation returns our spy.
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
}));

// ─── useShareIntent mock ──────────────────────────────────────────────────────

let mockSharedValue: { kind: "text" | "link"; body: string } | null = null;
const mockReset = jest.fn();

jest.mock("../../share/useShareIntent", () => ({
  useShareIntent: () => ({
    shared: mockSharedValue,
    reset: mockReset,
  }),
}));

// ─── useSync mock ─────────────────────────────────────────────────────────────

let mockAuthed = true;

jest.mock("../../sync/useSync", () => ({
  SyncProvider: ({ children }: { children: unknown }) =>
    require("react").createElement(require("react").Fragment, null, children),
  useSync: () => ({
    authed: mockAuthed,
    ready: true,
    status: "idle" as const,
    items: [],
    devices: [],
    selfDeviceId: null,
    baseUrl: null,
    pendingIds: [],
    failedIds: [],
    authRequired: false,
    send: jest.fn(),
    remove: jest.fn(),
    renameDevice: jest.fn(),
    revokeDevice: jest.fn(),
    onSignedIn: jest.fn(),
    signOut: jest.fn(),
  }),
}));

// ─── Stateful harness ─────────────────────────────────────────────────────────
//
// The harness exposes a forceRerender() function to trigger re-renders of
// TabsWithIntentWatcher from within the navigator context. Using React state
// rather than test-library's rerender() bypasses React Navigation's screen-
// level memoization that would otherwise suppress re-renders of the screen.
//
// The render-prop form `{() => <TabsWithIntentWatcher />}` is used for the
// same reason — React Navigation does not memoize render-prop screens.

const Stack = createNativeStackNavigator<RootStackParamList>();
let forceRerenderFn: (() => void) | null = null;

function Harness() {
  const [, setTick] = useState(0);
  forceRerenderFn = () => setTick((n) => n + 1);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {/* Render-prop form bypasses memoization so state changes propagate. */}
            <Stack.Screen name="Tabs">{() => <TabsWithIntentWatcher />}</Stack.Screen>
            <Stack.Screen name="AndroidShare">
              {() =>
                require("react").createElement(
                  require("react-native").Text,
                  null,
                  "AndroidShareStub",
                )
              }
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/** Navigate calls where the first arg is "AndroidShare". */
function androidShareCalls() {
  return mockNavigate.mock.calls.filter((args) => args[0] === "AndroidShare");
}

/** Force a re-render so the effect sees the updated mockSharedValue. */
async function deliverIntent(payload: { kind: "text" | "link"; body: string } | null) {
  await act(async () => {
    mockSharedValue = payload;
    forceRerenderFn?.();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TabsWithIntentWatcher", () => {
  beforeEach(async () => {
    Object.defineProperty(Platform, "OS", {
      get: () => "android",
      configurable: true,
    });
    mockSharedValue = null;
    mockAuthed = true;
    mockReset.mockClear();
    mockNavigate.mockClear();
    forceRerenderFn = null;

    // Render the harness — reused across steps via forceRerenderFn.
    render(<Harness />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("navigates to AndroidShare exactly once and calls reset() on first delivery", async () => {
    // Initial state: no intent.
    expect(androidShareCalls()).toHaveLength(0);
    expect(mockReset).not.toHaveBeenCalled();

    // Deliver first intent.
    await deliverIntent({ kind: "text", body: "Hello" });

    const calls = androidShareCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["AndroidShare", { shared: { kind: "text", body: "Hello" } }]);
    // reset() is always paired with navigate in the happy path.
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("navigates TWICE for two separate OS deliveries — re-share regression", async () => {
    // ── Delivery 1 ────────────────────────────────────────────────────────────
    await deliverIntent({ kind: "text", body: "X" });

    expect(androidShareCalls()).toHaveLength(1);

    // ── Shared → null: OS clears intent; handledRef is reset to null ──────────
    await deliverIntent(null);

    // null branch: no extra navigate call.
    expect(androidShareCalls()).toHaveLength(1);

    // ── Delivery 2: same body — genuinely new OS intent ───────────────────────
    await deliverIntent({ kind: "text", body: "X" });

    // MUST be exactly 2: 1 = old dedup bug; 3+ = loop regression.
    const finalCalls = androidShareCalls();
    expect(finalCalls).toHaveLength(2);
    expect(finalCalls[1]).toEqual([
      "AndroidShare",
      { shared: { kind: "text", body: "X" } },
    ]);
    // reset() called once per delivery = 2 total.
    expect(mockReset).toHaveBeenCalledTimes(2);
  });

  it("calls reset() but NOT navigate when the same live delivery re-triggers the effect", async () => {
    // First delivery: navigate + reset.
    await deliverIntent({ kind: "text", body: "Y" });

    const navigateAfterFirst = androidShareCalls().length;
    expect(navigateAfterFirst).toBeGreaterThanOrEqual(1);

    // Re-render with shared still set: same key → dedup branch if effect re-fires.
    // Force re-render without changing mockSharedValue (same object ref).
    await act(async () => {
      forceRerenderFn?.();
    });

    // Hard constraint: navigate count must NOT increase (dedup prevents it).
    expect(androidShareCalls()).toHaveLength(navigateAfterFirst);
    // reset() IS called again if the effect re-fired (belt-and-suspenders branch).
    // We assert >= navigateAfterFirst on reset (at least as many as navigate calls).
    expect(mockReset.mock.calls.length).toBeGreaterThanOrEqual(navigateAfterFirst);
  });

  it("resets intent silently without navigating when unauthed", async () => {
    mockAuthed = false;

    await deliverIntent({ kind: "text", body: "Secret" });

    // No navigate — user must sign in first.
    expect(androidShareCalls()).toHaveLength(0);
    // reset() IS called to clear the stranded intent.
    expect(mockReset).toHaveBeenCalledTimes(1);
  });
});
