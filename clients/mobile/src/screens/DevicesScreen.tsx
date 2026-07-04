/**
 * DevicesScreen — placeholder skeleton (Task 5).
 * Full implementation in Task 8 (presence, rename, revoke, detail).
 */
import React from "react";
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { useSync } from "../sync/useSync";
import type { DevicesStackParamList } from "../nav/RootNavigator";

type Props = NativeStackScreenProps<DevicesStackParamList, "DevicesList">;

export function DevicesScreen({ navigation }: Props): React.JSX.Element {
  const tokens = useTheme();
  const { devices } = useSync();

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <Text style={[styles.heading, { color: tokens.text }]}>Devices</Text>
      {devices.length === 0 ? (
        <Text style={[styles.sub, { color: tokens.textMuted }]}>No devices</Text>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(d) => d.id}
          renderItem={({ item: device }) => (
            <TouchableOpacity
              style={[styles.row, { borderBottomColor: tokens.border }]}
              onPress={() => navigation.push("DeviceDetail", { deviceId: device.id })}
            >
              <Text style={{ color: tokens.text }}>{device.name}</Text>
              <Text style={{ color: tokens.textMuted, fontSize: 12 }}>
                {device.platform} · {device.online ? "online" : "offline"}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  heading: { fontSize: 24, fontWeight: "600", marginBottom: 16 },
  sub: { fontSize: 14 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
