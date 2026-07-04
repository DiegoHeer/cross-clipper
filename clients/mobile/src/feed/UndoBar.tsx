/**
 * UndoBar — "Deleted · Undo" action bar shown after a swipe-left delete.
 *
 * Pressing Undo calls onUndo which cancels the pending delete timer.
 */
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

interface UndoBarProps {
  onUndo: () => void;
}

export function UndoBar({ onUndo }: UndoBarProps): React.JSX.Element {
  const tokens = useTheme();
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: tokens.surfaceRaised, borderTopColor: tokens.border },
      ]}
    >
      <Text style={[styles.label, { color: tokens.textMuted }]}>
        Deleted
      </Text>
      <TouchableOpacity
        onPress={onUndo}
        accessibilityRole="button"
        accessibilityLabel="Undo delete"
      >
        <Text style={[styles.undo, { color: tokens.accent }]}>Undo</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 14,
  },
  undo: {
    fontSize: 14,
    fontWeight: "600",
  },
});
