/**
 * ShareSheet.tsx — A2 AirDrop-style share sheet (Task 13).
 *
 * Tile row layout:
 *   [Broadcast] [last-used?] [device1] [device2] …
 *
 * Broadcast tile: accent bg + accentFg text — silent send (no target_device_id).
 * Device tiles: presence dot (green) when online.
 * Self device excluded.
 * Last-used device hoisted to second position.
 * Tap = send + "Sent ✓" feedback + onSent callback.
 * On queued result (offline) = onError with retry hint.
 *
 * Theming: uses design tokens from ThemeProvider (lean import — no RootNavigator).
 */
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import type { Device } from "@crossclipper/core";
import type { SendDirectInput, SendDirectResult } from "./sendDirect";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShareSheetProps {
  shared: { kind: "text" | "link"; body: string };
  devices: Device[];
  selfDeviceId: string;
  lastUsedDeviceId?: string;
  /** Called when a send succeeds. Caller should dismiss the sheet. */
  onSent(): void;
  /** Called with a user-facing message when a send is queued (offline). */
  onError(message: string): void;
  /** Injectable send function (production: sendDirect; tests: jest.fn). */
  sendFn(input: SendDirectInput): Promise<SendDirectResult>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ShareSheet({
  shared,
  devices,
  selfDeviceId,
  lastUsedDeviceId,
  onSent,
  onError,
  sendFn,
}: ShareSheetProps): React.JSX.Element {
  const tokens = useTheme();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Build the ordered tile list: self excluded, last-used hoisted.
  const others = devices.filter((d) => d.id !== selfDeviceId);
  const lastUsed = lastUsedDeviceId
    ? others.find((d) => d.id === lastUsedDeviceId)
    : undefined;
  const rest = others.filter((d) => d.id !== lastUsedDeviceId);
  const orderedDevices = lastUsed ? [lastUsed, ...rest] : rest;

  const handleSend = async (targetDeviceId?: string) => {
    if (sending || sent) return;
    setSending(true);
    try {
      const result = await sendFn({
        kind: shared.kind,
        body: shared.body,
        ...(targetDeviceId ? { targetDeviceId } : {}),
      });
      if (result.status === "sent") {
        setSent(true);
        onSent();
      } else {
        onError(result.retryHint);
      }
    } finally {
      setSending(false);
    }
  };

  const s = styles(tokens);

  if (sent) {
    return (
      <View style={s.sentContainer}>
        <Text style={s.sentText}>Sent ✓</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={s.heading}>Send to</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.row}>
        {/* Broadcast tile — always first, accent bg */}
        <TouchableOpacity
          style={[s.tile, s.broadcastTile]}
          onPress={() => void handleSend()}
          disabled={sending}
          accessibilityLabel="Everyone (broadcast)"
          accessibilityRole="button"
        >
          {sending ? (
            <ActivityIndicator size="small" color={tokens.accentFg} />
          ) : (
            <>
              <View style={[s.tileIcon, s.broadcastIcon]}>
                <Text style={s.broadcastIconText}>⬡</Text>
              </View>
              <Text style={[s.tileLabel, s.broadcastLabel]} numberOfLines={1}>
                Everyone
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Device tiles */}
        {orderedDevices.map((device) => (
          <TouchableOpacity
            key={device.id}
            style={s.tile}
            onPress={() => void handleSend(device.id)}
            disabled={sending}
            accessibilityLabel={device.name}
            accessibilityRole="button"
          >
            <View style={s.tileIconWrapper}>
              <View style={[s.tileIcon, s.deviceIcon]}>
                <Text style={s.deviceIconText}>{platformEmoji(device.platform)}</Text>
              </View>
              {device.online && (
                <View
                  testID={`presence-dot-${device.id}`}
                  style={s.presenceDot}
                />
              )}
            </View>
            <Text style={s.tileLabel} numberOfLines={1}>
              {device.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function platformEmoji(platform: string): string {
  switch (platform) {
    case "ios":
      return "📱";
    case "android":
      return "🤖";
    case "windows":
      return "🖥";
    case "extension":
      return "🌐";
    default:
      return "📦";
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function styles(tokens: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: {
      paddingVertical: tokens.space[3],
    },
    heading: {
      color: tokens.text,
      fontSize: 13,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: tokens.space[2],
      paddingHorizontal: tokens.space[4],
    },
    row: {
      paddingHorizontal: tokens.space[3],
    },
    tile: {
      alignItems: "center",
      width: 72,
      marginHorizontal: tokens.space[1],
    },
    broadcastTile: {
      // Accent background applied via broadcastIcon
    },
    tileIconWrapper: {
      position: "relative",
    },
    tileIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: tokens.surfaceRaised,
      borderWidth: 1,
      borderColor: tokens.border,
    },
    broadcastIcon: {
      backgroundColor: tokens.accent,
      borderColor: tokens.accent,
    },
    broadcastIconText: {
      fontSize: 22,
      color: tokens.accentFg,
    },
    deviceIcon: {},
    deviceIconText: {
      fontSize: 22,
    },
    presenceDot: {
      position: "absolute",
      bottom: 2,
      right: 2,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: "#22c55e", // green-500 — presence colour (semantic, not accented)
      borderWidth: 2,
      borderColor: tokens.bg,
    },
    tileLabel: {
      color: tokens.text,
      fontSize: 11,
      marginTop: tokens.space[1],
      textAlign: "center",
    },
    broadcastLabel: {
      color: tokens.text,
      fontWeight: "600",
    },
    sentContainer: {
      padding: tokens.space[5],
      alignItems: "center",
    },
    sentText: {
      color: tokens.success,
      fontSize: 18,
      fontWeight: "600",
    },
  });
}
