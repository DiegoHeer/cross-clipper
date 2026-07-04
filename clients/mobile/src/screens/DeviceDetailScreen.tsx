/**
 * DeviceDetailScreen — placeholder skeleton (Task 5).
 * Full implementation in Task 8 (presence badge, rename, stats, revoke).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { useSync } from "../sync/useSync";
import type { DevicesStackParamList } from "../nav/RootNavigator";

type Props = NativeStackScreenProps<DevicesStackParamList, "DeviceDetail">;

export function DeviceDetailScreen({ route }: Props): React.JSX.Element {
  const tokens = useTheme();
  const { devices } = useSync();
  const device = devices.find((d) => d.id === route.params.deviceId);

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <Text style={[styles.heading, { color: tokens.text }]}>
        {device?.name ?? "Device"}
      </Text>
      <Text style={[styles.sub, { color: tokens.textMuted }]}>
        {device?.platform ?? "unknown"} · {device?.online ? "online" : "offline"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 24, fontWeight: "600", marginBottom: 8 },
  sub: { fontSize: 14 },
});
