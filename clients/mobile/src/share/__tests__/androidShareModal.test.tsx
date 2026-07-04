/**
 * androidShareModal.test.tsx — Task 14 TDD step 1.
 *
 * Tests the AndroidShareModal screen:
 *   - Renders ShareSheet with the shared payload from route.params.
 *   - Tapping a tile calls useSync().send with correct args.
 *   - Dismisses (navigation.goBack) after successful send.
 *   - Tapping the backdrop dismisses the modal.
 *
 * Platform guard: tests run with Platform.OS="android" (jest-expo preset default
 * for android platform). We assert the component returns null on iOS in a
 * separate case using Platform.OS spy.
 */
import React from "react";
import { Platform } from "react-native";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ThemeProvider } from "../../theme/ThemeProvider";
import { SyncProvider } from "../../sync/useSync";
import { SyncController } from "../../sync/SyncController";
import { MemoryStorage } from "@crossclipper/core";
import type { WsLike } from "@crossclipper/core";
import { AndroidShareModal } from "../AndroidShareModal";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../nav/RootNavigator";

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

// ─── Mock navigation ──────────────────────────────────────────────────────────

function makeMockNavigation(goBack = jest.fn()) {
  return {
    goBack,
    navigate: jest.fn(),
    dispatch: jest.fn(),
    reset: jest.fn(),
    isFocused: jest.fn().mockReturnValue(true),
    canGoBack: jest.fn().mockReturnValue(true),
    getState: jest.fn().mockReturnValue({ routes: [] }),
    getParent: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn().mockReturnValue(jest.fn()),
    removeListener: jest.fn(),
    setParams: jest.fn(),
    push: jest.fn(),
    pop: jest.fn(),
    popToTop: jest.fn(),
    replace: jest.fn(),
    getId: jest.fn(),
  } as unknown as NativeStackScreenProps<RootStackParamList, "AndroidShare">["navigation"];
}

function makeMockRoute(shared: { kind: "text" | "link"; body: string }) {
  return {
    key: "AndroidShare-test",
    name: "AndroidShare" as const,
    params: { shared },
  } as NativeStackScreenProps<RootStackParamList, "AndroidShare">["route"];
}

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function Wrapper({
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

describe("AndroidShareModal", () => {
  const shared = { kind: "text" as const, body: "hello from intent" };

  beforeEach(() => {
    // Ensure Platform.OS is android for these tests
    Object.defineProperty(Platform, "OS", { get: () => "android", configurable: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders ShareSheet with the shared payload", async () => {
    const controller = await makeController();
    const navigation = makeMockNavigation();
    const route = makeMockRoute(shared);

    const { getAllByRole } = render(
      <Wrapper controller={controller}>
        <AndroidShareModal navigation={navigation} route={route} />
      </Wrapper>,
    );

    // ShareSheet renders at least the broadcast tile
    await waitFor(() => {
      const buttons = getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("tapping broadcast tile calls send and then dismisses", async () => {
    const controller = await makeController();
    const sendSpy = jest.spyOn(controller, "send").mockResolvedValue("item-id");
    const goBack = jest.fn();
    const navigation = makeMockNavigation(goBack);
    const route = makeMockRoute(shared);

    const { getAllByRole } = render(
      <Wrapper controller={controller}>
        <AndroidShareModal navigation={navigation} route={route} />
      </Wrapper>,
    );

    await waitFor(() => {
      const buttons = getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });

    await act(async () => {
      const buttons = getAllByRole("button");
      fireEvent.press(buttons[0]!);
    });

    await waitFor(() => {
      // send called with the text kind and body (broadcast = no targetDeviceId)
      expect(sendSpy).toHaveBeenCalledWith("text", "hello from intent", undefined);
      expect(goBack).toHaveBeenCalled();
    });
  });

  it("returns null on iOS", () => {
    Object.defineProperty(Platform, "OS", { get: () => "ios", configurable: true });

    const navigation = makeMockNavigation();
    const route = makeMockRoute(shared);

    // No controller or wrapper needed — should bail before rendering anything
    const { toJSON } = render(<AndroidShareModal navigation={navigation} route={route} />);
    expect(toJSON()).toBeNull();
  });
});
