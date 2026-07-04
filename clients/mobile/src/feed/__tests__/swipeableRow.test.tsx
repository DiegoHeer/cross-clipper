/**
 * swipeableRow.test.tsx — Task 6 TDD step 1 (failing).
 *
 * SwipeableRow: right-swipe → onCopy, left-swipe → onDelete.
 *
 * Strategy: mock react-native-gesture-handler/Swipeable with a thin wrapper
 * that renders its children and calls onSwipeableOpen when fireEvent.press
 * is triggered on the swipe-right / swipe-left test buttons we inject.
 *
 * Per house rules: use role-based queries; do not invert data or delete UI.
 */
import React from "react";
import { Text } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import { SwipeableRow } from "../SwipeableRow";

// ─── Mock Swipeable ───────────────────────────────────────────────────────────
// Swipeable is a class component that wraps PanGestureHandler (already mocked
// as View). In tests we replace it with a stub that exposes swipe-left and
// swipe-right trigger buttons so tests can fire the callbacks without real
// gesture events.
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

describe("SwipeableRow", () => {
  it("calls onCopy when swiped right", () => {
    const onCopy = jest.fn();
    const onDelete = jest.fn();

    const { getByRole } = render(
      <SwipeableRow onCopy={onCopy} onDelete={onDelete}>
        <Text>Card content</Text>
      </SwipeableRow>,
    );

    fireEvent.press(getByRole("button", { name: "swipe-right" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("calls onDelete when swiped left", () => {
    const onCopy = jest.fn();
    const onDelete = jest.fn();

    const { getByRole } = render(
      <SwipeableRow onCopy={onCopy} onDelete={onDelete}>
        <Text>Card content</Text>
      </SwipeableRow>,
    );

    fireEvent.press(getByRole("button", { name: "swipe-left" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("renders children", () => {
    const { getByText } = render(
      <SwipeableRow onCopy={() => {}} onDelete={() => {}}>
        <Text>My card</Text>
      </SwipeableRow>,
    );
    expect(getByText("My card")).toBeTruthy();
  });
});
