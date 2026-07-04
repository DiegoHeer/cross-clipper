/**
 * ServerSection — server connection status card + sign out (Task 9).
 *
 * Sign-out is wired fully in Task 10 (onboarding). This renders the status
 * card; the sign-out button clears auth and triggers authRequired which the
 * onboarding flow handles.
 */
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "../theme/ThemeProvider";
import { useSync } from "../sync/useSync";

const AUTH_KEY = "cc.auth";

interface AuthInfo {
  baseUrl: string;
}

const STATUS_LABELS: Record<string, string> = {
  stopped: "Disconnected",
  connecting: "Connecting…",
  live: "Connected",
  reconnecting: "Reconnecting…",
};

export function ServerSection(): React.JSX.Element {
  const tokens = useTheme();
  const { status } = useSync();
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(AUTH_KEY)
      .then((raw) => {
        if (raw) setAuthInfo(JSON.parse(raw) as AuthInfo);
      })
      .catch(() => {});
  }, []);

  const isLive = status === "live";
  const statusLabel = STATUS_LABELS[status] ?? status;

  const handleSignOut = async () => {
    await AsyncStorage.removeItem(AUTH_KEY);
    await AsyncStorage.removeItem("cc.cursor");
    await AsyncStorage.removeItem("cc.devices");
    await AsyncStorage.removeItem("cc.items");
    await AsyncStorage.removeItem("cc.itemTombstones");
    // Task 10 will navigate to onboarding via authRequired flag.
  };

  return (
    <View style={styles.section}>
      {/* Status card */}
      <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.dot,
              { backgroundColor: isLive ? tokens.success : tokens.textMuted },
            ]}
          />
          <Text style={[styles.statusText, { color: tokens.text }]}>{statusLabel}</Text>
        </View>
        {authInfo && (
          <Text style={[styles.hostText, { color: tokens.textMuted }]}>{authInfo.baseUrl}</Text>
        )}
      </View>

      {/* Sign out */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        style={[styles.signOutBtn, { borderColor: tokens.danger }]}
        onPress={() => void handleSignOut()}
      >
        <Text style={[styles.signOutText, { color: tokens.danger }]}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {},
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 12,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, fontWeight: "500" },
  hostText: { fontSize: 13, marginTop: 6 },
  signOutBtn: {
    height: 44,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
  },
  signOutText: { fontSize: 15, fontWeight: "600" },
});
