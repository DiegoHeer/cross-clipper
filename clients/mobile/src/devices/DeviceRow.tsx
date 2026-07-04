/**
 * DeviceRow — a single row in the Devices master list.
 *
 * Shows: platform icon (emoji placeholder), device name, presence dot,
 * "this device" badge, relative last-seen time, and a 14-day stale nudge.
 */
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { Device } from "@crossclipper/core";
import { useTheme } from "../theme/ThemeProvider";

const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

const PLATFORM_ICONS: Record<string, string> = {
  ios: "📱",
  android: "🤖",
  windows: "🖥",
  macos: "💻",
  linux: "🐧",
  extension: "🧩",
};

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export interface DeviceRowProps {
  device: Device;
  isSelf: boolean;
  onPress: () => void;
}

export function DeviceRow({ device, isSelf, onPress }: DeviceRowProps): React.JSX.Element {
  const tokens = useTheme();
  const isStale =
    !device.online &&
    Date.now() - new Date(device.last_seen_at).getTime() > STALE_THRESHOLD_MS;

  const icon = PLATFORM_ICONS[device.platform.toLowerCase()] ?? "📟";

  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={[styles.row, { borderBottomColor: tokens.border }]}
      onPress={onPress}
    >
      {/* Left: presence dot */}
      <View
        testID={device.online ? "presence-dot-online" : "presence-dot-offline"}
        style={[
          styles.dot,
          { backgroundColor: device.online ? tokens.success : tokens.border },
        ]}
      />

      {/* Center: name + sub-info */}
      <View style={styles.center}>
        <View style={styles.nameRow}>
          <Text style={[styles.icon]}>{icon}</Text>
          <Text style={[styles.name, { color: tokens.text }]}>{device.name}</Text>
          {isSelf && (
            <View style={[styles.badge, { backgroundColor: tokens.accentSoft }]}>
              <Text style={[styles.badgeText, { color: tokens.accent }]}>this device</Text>
            </View>
          )}
        </View>
        <Text style={[styles.sub, { color: tokens.textMuted }]}>
          {device.platform} ·{" "}
          {device.online ? "online now" : `last seen ${relativeTime(device.last_seen_at)}`}
        </Text>
        {isStale && (
          <Text style={[styles.stale, { color: tokens.danger }]}>
            Revoke? Not seen in over 14 days
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  center: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  icon: {
    fontSize: 16,
  },
  name: {
    fontSize: 16,
    fontWeight: "500",
  },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  sub: {
    fontSize: 13,
    marginTop: 2,
  },
  stale: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: "500",
  },
});
