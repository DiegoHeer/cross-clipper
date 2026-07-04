/**
 * FeedScreen — placeholder skeleton (Task 5).
 * Full implementation in Task 6 (cards, swipe gestures, composer).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { useSync } from "../sync/useSync";

export function FeedScreen(): React.JSX.Element {
  const tokens = useTheme();
  const { items } = useSync();

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <Text style={[styles.heading, { color: tokens.text }]}>Feed</Text>
      <Text style={[styles.sub, { color: tokens.textMuted }]}>
        {items.length === 0 ? "No items yet" : `${items.length} item(s)`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 24, fontWeight: "600", marginBottom: 8 },
  sub: { fontSize: 14 },
});
