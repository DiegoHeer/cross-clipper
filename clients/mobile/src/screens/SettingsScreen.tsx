/**
 * SettingsScreen — placeholder skeleton (Task 5).
 * Full implementation in Task 9 (theme/accent/server settings).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

export function SettingsScreen(): React.JSX.Element {
  const tokens = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <Text style={[styles.heading, { color: tokens.text }]}>Settings</Text>
      <Text style={[styles.sub, { color: tokens.textMuted }]}>
        Configuration coming soon
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 24, fontWeight: "600", marginBottom: 8 },
  sub: { fontSize: 14 },
});
