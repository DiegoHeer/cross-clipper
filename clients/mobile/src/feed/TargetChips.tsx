/**
 * TargetChips — target-device chip row for the composer.
 *
 * System spec §4 notification policy: chips default to "Silent" (null).
 * Selecting a chip targets that device for notification only — never visibility.
 * Self device is excluded from the list.
 * Resets to Silent after each send (controlled externally via value/onChange).
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import type { Device } from "@crossclipper/core";
import { useTheme } from "../theme/ThemeProvider";
import { platformIcon } from "./format";

export interface TargetChipsProps {
  devices: Device[];
  selfDeviceId: string | null;
  value: string | null;
  onChange: (id: string | null) => void;
}

export function TargetChips({
  devices,
  selfDeviceId,
  value,
  onChange,
}: TargetChipsProps): React.JSX.Element {
  const tokens = useTheme();

  const others = devices.filter((d) => d.id !== selfDeviceId);

  const chipStyle = (active: boolean) => ({
    backgroundColor: active ? tokens.accent : tokens.surfaceRaised,
    borderColor: active ? tokens.accent : tokens.border,
  });

  const textStyle = (active: boolean) => ({
    color: active ? tokens.accentFg : tokens.text,
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {/* Silent (broadcast) chip */}
      <TouchableOpacity
        style={[styles.chip, chipStyle(value === null)]}
        accessibilityRole="button"
        accessibilityLabel="Silent"
        accessibilityState={{ selected: value === null }}
        onPress={() => onChange(null)}
      >
        <Text style={[styles.chipText, textStyle(value === null)]}>Silent</Text>
      </TouchableOpacity>

      {/* One chip per non-self device */}
      {others.map((device) => {
        const active = value === device.id;
        return (
          <TouchableOpacity
            key={device.id}
            style={[styles.chip, chipStyle(active)]}
            accessibilityRole="button"
            accessibilityLabel={device.name}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(device.id)}
          >
            <Text style={[styles.chipText, textStyle(active)]}>
              {platformIcon(device.platform)} {device.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
});
