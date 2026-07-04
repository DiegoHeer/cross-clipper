/**
 * SwipeableRow — wraps children in a gesture-handler Swipeable.
 *
 * Right-swipe → onCopy (snap back after 600ms).
 * Left-swipe  → onDelete.
 */
import React, { useRef } from "react";
import { View } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";

export interface SwipeableRowProps {
  onCopy: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}

export function SwipeableRow({
  onCopy,
  onDelete,
  children,
}: SwipeableRowProps): React.JSX.Element {
  const ref = useRef<Swipeable>(null);

  const handleOpen = (direction: "left" | "right") => {
    if (direction === "right") {
      onCopy();
      // Snap back after brief confirmation window
      setTimeout(() => {
        ref.current?.close();
      }, 600);
    } else {
      onDelete();
    }
  };

  return (
    <Swipeable
      ref={ref}
      onSwipeableOpen={handleOpen}
      renderRightActions={() => <View />}
      renderLeftActions={() => <View />}
    >
      {children}
    </Swipeable>
  );
}
