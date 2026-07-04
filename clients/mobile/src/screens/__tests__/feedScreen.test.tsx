/**
 * feedScreen.test.tsx — Task 7 TDD step 1 (failing).
 *
 * FeedScreen integration: swipe-right copies; swipe-left defers delete with undo.
 * Amendment A5: delete deferred ~5s; undo cancels; timer fires → exactly one remove.
 * Finding 2 fix: origin filter via route param.
 */
import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { SyncProvider } from "../../sync/useSync";
import { SyncController } from "../../sync/SyncController";
import { MemoryStorage } from "@crossclipper/core";
import { FeedScreen } from "../FeedScreen";
import * as Clipboard from "expo-clipboard";
import type { Item, WsLike } from "@crossclipper/core";

// ─── useRoute / useNavigation mocks ──────────────────────────────────────────

let mockRouteParams: { originDeviceId?: string } | undefined = undefined;
const mockSetParams = jest.fn();

jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams }),
    useNavigation: () => ({ setParams: mockSetParams }),
  };
});

// ─── Swipeable mock (same approach as swipeableRow tests) ─────────────────────
jest.mock("react-native-gesture-handler/Swipeable", () => {
  const React = require("react");
  const { View, TouchableOpacity, Text } = require("react-native");
  const MockSwipeable = React.forwardRef(
    (
      {
        onSwipeableOpen,
        children,
      }: {
        onSwipeableOpen?: (dir: "left" | "right") => void;
        children: React.ReactNode;
      },
      _ref: unknown,
    ) => (
      <View>
        {children}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="swipe-right"
          onPress={() => onSwipeableOpen?.("right")}
        >
          <Text>swipe-right</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="swipe-left"
          onPress={() => onSwipeableOpen?.("left")}
        >
          <Text>swipe-left</Text>
        </TouchableOpacity>
      </View>
    ),
  );
  MockSwipeable.displayName = "MockSwipeable";
  return MockSwipeable;
});

// ─── Fake controller factory ──────────────────────────────────────────────────

const AUTH_KEY = "cc.auth";
const AUTH_VALUE = JSON.stringify({
  baseUrl: "http://localhost:8000",
  token: "tok",
  deviceId: "self-device-id",
  deviceName: "Test Device",
});

function makeItem(id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"): Item {
  return {
    id,
    kind: "text",
    body: "hello world",
    user_id: "u1",
    origin_device_id: "d1",
    target_device_id: null,
    created_at: "2026-01-01T00:00:00",
    deleted_at: null,
    sync_seq: 1,
  } as unknown as Item;
}

async function makeController(items: Item[] = []): Promise<{
  ctrl: SyncController;
  mockRemove: jest.Mock;
}> {
  const storage = new MemoryStorage();
  await storage.set(AUTH_KEY, AUTH_VALUE);
  await storage.set("cc.items", JSON.stringify(items));

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

  const ctrl = new SyncController({ storage, socketFactory, fetchFn });

  // Spy on remove BEFORE any test assertions
  const mockRemove = jest.spyOn(ctrl, "remove") as unknown as jest.Mock;
  mockRemove.mockResolvedValue(undefined);

  return { ctrl, mockRemove };
}

function TestWrapper({
  children,
  controller,
}: {
  children: React.ReactNode;
  controller: SyncController;
}) {
  return (
    <GestureHandlerRootView>
      <ThemeProvider>
        <SyncProvider controller={controller}>
          <NavigationContainer>{children}</NavigationContainer>
        </SyncProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FeedScreen", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Clipboard.setStringAsync as jest.Mock).mockClear();
    mockSetParams.mockClear();
    mockRouteParams = undefined; // reset filter between tests
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows empty-feed hint when there are no items", async () => {
    const { ctrl } = await makeController([]);
    const { getByText } = render(
      <TestWrapper controller={ctrl}>
        <FeedScreen />
      </TestWrapper>,
    );
    await act(async () => {});
    expect(getByText(/nothing here yet/i)).toBeTruthy();
  });

  it("shows items from the feed", async () => {
    const item = makeItem();
    const { ctrl } = await makeController([item]);
    const { getByText } = render(
      <TestWrapper controller={ctrl}>
        <FeedScreen />
      </TestWrapper>,
    );
    await act(async () => {});
    expect(getByText("hello world")).toBeTruthy();
  });

  it("swipe-right writes to clipboard and shows '✓ Copied'", async () => {
    const item = makeItem();
    const { ctrl } = await makeController([item]);
    const { getAllByRole, findByText } = render(
      <TestWrapper controller={ctrl}>
        <FeedScreen />
      </TestWrapper>,
    );
    await act(async () => {});

    // Trigger swipe-right on first card
    const swipeRightBtns = getAllByRole("button", { name: "swipe-right" });
    fireEvent.press(swipeRightBtns[0]!);

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("hello world");
    await findByText(/✓ Copied/);
  });

  it("swipe-left removes item optimistically but does NOT call remove yet", async () => {
    const item = makeItem();
    const { ctrl, mockRemove } = await makeController([item]);
    const { getAllByRole, findByText, queryByText } = render(
      <TestWrapper controller={ctrl}>
        <FeedScreen />
      </TestWrapper>,
    );
    await act(async () => {});

    // Item is visible
    expect(queryByText("hello world")).toBeTruthy();

    // Swipe left
    fireEvent.press(getAllByRole("button", { name: "swipe-left" })[0]!);

    // Optimistic: item gone from list immediately
    await waitFor(() => expect(queryByText("hello world")).toBeNull());

    // Undo bar appears
    await findByText(/undo/i);

    // remove NOT yet called (deferred)
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("pressing Undo restores the item and remove is never called", async () => {
    const item = makeItem();
    const { ctrl, mockRemove } = await makeController([item]);
    const { getAllByRole, findByText, findByRole, queryByText } = render(
      <TestWrapper controller={ctrl}>
        <FeedScreen />
      </TestWrapper>,
    );
    await act(async () => {});

    // Swipe left
    fireEvent.press(getAllByRole("button", { name: "swipe-left" })[0]!);
    await waitFor(() => expect(queryByText("hello world")).toBeNull());

    // Press Undo
    const undoBtn = await findByRole("button", { name: /undo delete/i });
    fireEvent.press(undoBtn);

    // Item restored
    await findByText("hello world");

    // Advance timers past 5s — remove should NOT be called
    act(() => {
      jest.advanceTimersByTime(6000);
    });

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("without Undo, timer fires and remove is called exactly once", async () => {
    const item = makeItem();
    const { ctrl, mockRemove } = await makeController([item]);
    const { getAllByRole, queryByText } = render(
      <TestWrapper controller={ctrl}>
        <FeedScreen />
      </TestWrapper>,
    );
    await act(async () => {});

    // Swipe left
    fireEvent.press(getAllByRole("button", { name: "swipe-left" })[0]!);
    await waitFor(() => expect(queryByText("hello world")).toBeNull());

    // Advance past 5s undo window
    act(() => {
      jest.advanceTimersByTime(6000);
    });

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledWith(item.id);
    });
  });

  describe("origin filter (Finding 2)", () => {
    function makeItemWithOrigin(id: string, originDeviceId: string): Item {
      return {
        id,
        kind: "text",
        body: `item-from-${originDeviceId}`,
        user_id: "u1",
        origin_device_id: originDeviceId,
        target_device_id: null,
        created_at: "2026-01-01T00:00:00",
        deleted_at: null,
        sync_seq: 1,
      } as unknown as Item;
    }

    it("when originDeviceId param is set, only items from that origin render", async () => {
      const itemA = makeItemWithOrigin("01ARZ3NDEKTSV4RRFFQ69G5FAV", "device-a");
      const itemB = makeItemWithOrigin("01BX5ZZKBKACTAV9WEVGEMMVS0", "device-b");
      mockRouteParams = { originDeviceId: "device-a" };

      const { ctrl } = await makeController([itemA, itemB]);
      const { queryByText, getByText } = render(
        <TestWrapper controller={ctrl}>
          <FeedScreen />
        </TestWrapper>,
      );
      await act(async () => {});

      // Only the device-a item is visible
      expect(getByText("item-from-device-a")).toBeTruthy();
      expect(queryByText("item-from-device-b")).toBeNull();
    });

    it("dismissing the filter chip restores the full feed", async () => {
      const itemA = makeItemWithOrigin("01ARZ3NDEKTSV4RRFFQ69G5FAV", "device-a");
      const itemB = makeItemWithOrigin("01BX5ZZKBKACTAV9WEVGEMMVS0", "device-b");
      mockRouteParams = { originDeviceId: "device-a" };

      const { ctrl } = await makeController([itemA, itemB]);
      const { queryByText, getByText, getByRole } = render(
        <TestWrapper controller={ctrl}>
          <FeedScreen />
        </TestWrapper>,
      );
      await act(async () => {});

      // Filter active — device-b item hidden
      expect(queryByText("item-from-device-b")).toBeNull();

      // Dismiss the filter chip
      const clearBtn = getByRole("button", { name: /clear origin filter/i });
      fireEvent.press(clearBtn);
      await act(async () => {});

      // Both items now visible
      expect(getByText("item-from-device-a")).toBeTruthy();
      expect(getByText("item-from-device-b")).toBeTruthy();
    });

    it("repeat jump from same device re-applies filter after chip dismiss", async () => {
      const itemA = makeItemWithOrigin("01ARZ3NDEKTSV4RRFFQ69G5FAV", "device-a");
      const itemB = makeItemWithOrigin("01BX5ZZKBKACTAV9WEVGEMMVS0", "device-b");
      mockRouteParams = { originDeviceId: "device-a" };

      const { ctrl } = await makeController([itemA, itemB]);
      const { queryByText, getByText, getByRole, rerender } = render(
        <TestWrapper controller={ctrl}>
          <FeedScreen />
        </TestWrapper>,
      );
      await act(async () => {});

      // Filter active — only device-a visible
      expect(getByText("item-from-device-a")).toBeTruthy();
      expect(queryByText("item-from-device-b")).toBeNull();

      // Dismiss the chip — must call setParams to clear the stale param.
      // Simulate what real navigation does: after setParams the route param becomes undefined.
      mockSetParams.mockImplementationOnce(() => {
        mockRouteParams = { originDeviceId: undefined };
      });
      const clearBtn = getByRole("button", { name: /clear origin filter/i });
      fireEvent.press(clearBtn);
      await act(async () => {});

      expect(mockSetParams).toHaveBeenCalledWith({ originDeviceId: undefined });

      // Both items now visible
      expect(getByText("item-from-device-a")).toBeTruthy();
      expect(getByText("item-from-device-b")).toBeTruthy();

      // Simulate repeat "Jump to feed" from device-a (same param value as the original jump).
      // Because setParams cleared the param to undefined, the effect dep changes
      // undefined → "device-a" and the filter re-fires.
      mockRouteParams = { originDeviceId: "device-a" };
      rerender(
        <TestWrapper controller={ctrl}>
          <FeedScreen />
        </TestWrapper>,
      );
      await act(async () => {});

      // Filter re-applied — device-b hidden again
      expect(getByText("item-from-device-a")).toBeTruthy();
      expect(queryByText("item-from-device-b")).toBeNull();
    });
  });
});
