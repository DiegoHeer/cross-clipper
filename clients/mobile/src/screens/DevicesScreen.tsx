/**
 * DevicesScreen — Devices master list (Task 8).
 *
 * Shows one DeviceRow per device. Tapping a row pushes DeviceDetail.
 */
import React from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { useSync } from "../sync/useSync";
import { DeviceRow } from "../devices/DeviceRow";
import type { DevicesStackParamList } from "../nav/RootNavigator";

type Props = NativeStackScreenProps<DevicesStackParamList, "DevicesList">;

export function DevicesScreen({ navigation }: Props): React.JSX.Element {
  const tokens = useTheme();
  const { devices, selfDeviceId } = useSync();

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      {devices.length === 0 ? (
        <Text style={[styles.empty, { color: tokens.textMuted }]}>No devices</Text>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(d) => d.id}
          renderItem={({ item: device }) => (
            <DeviceRow
              device={device}
              isSelf={device.id === selfDeviceId}
              onPress={() => navigation.push("DeviceDetail", { deviceId: device.id })}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
});
