/**
 * CopiedChip — brief "✓ Copied" confirmation overlay shown after a swipe-right copy.
 */
import React from "react";
import { Text, StyleSheet, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

export function CopiedChip(): React.JSX.Element {
  const tokens = useTheme();
  return (
    <View
      style={[styles.chip, { backgroundColor: tokens.success }]}
      accessibilityLabel="Copied to clipboard"
    >
      <Text style={[styles.text, { color: "#ffffff" }]}>✓ Copied</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    zIndex: 10,
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
});
