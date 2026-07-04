/**
 * DeviceDetailScreen — Device detail (Task 8).
 *
 * Actions: rename (text input + submit), revoke with one-line confirm guard,
 * send test notification (targeted Outbox.send), jump to feed filtered to origin.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { useSync } from "../sync/useSync";
import type { DevicesStackParamList } from "../nav/RootNavigator";

type Props = NativeStackScreenProps<DevicesStackParamList, "DeviceDetail">;

export function DeviceDetailScreen({ route, navigation }: Props): React.JSX.Element {
  const tokens = useTheme();
  const { devices, selfDeviceId, renameDevice, revokeDevice, send } = useSync();
  const device = devices.find((d) => d.id === route.params.deviceId);

  const [renameText, setRenameText] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!device) {
    return (
      <View style={[styles.centered, { backgroundColor: tokens.bg }]}>
        <Text style={[styles.notFound, { color: tokens.textMuted }]}>Device not found.</Text>
      </View>
    );
  }

  const isSelf = device.id === selfDeviceId;

  const handleRename = async () => {
    const name = renameText.trim();
    if (!name) return;
    setBusy(true);
    try {
      await renameDevice(device.id, name);
      setRenameText("");
    } catch (err) {
      Alert.alert("Rename failed", String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = () => {
    setConfirmRevoke(true);
  };

  const handleConfirmRevoke = async () => {
    setBusy(true);
    try {
      await revokeDevice(device.id);
      navigation.goBack();
    } catch (err) {
      Alert.alert("Revoke failed", String(err));
    } finally {
      setBusy(false);
      setConfirmRevoke(false);
    }
  };

  const handleSendTestNotification = async () => {
    try {
      await send("text", "CrossClipper test notification", device.id);
    } catch (err) {
      Alert.alert("Send failed", String(err));
    }
  };

  const handleJumpToFeed = () => {
    // Navigate to Feed tab filtered to this device's origin.
    // React Navigation bubbles the call up to the parent tab navigator.
    (navigation as unknown as { navigate(screen: string, params: Record<string, unknown>): void }).navigate(
      "Feed",
      { originDeviceId: device.id },
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: tokens.bg }}
      contentContainerStyle={styles.container}
    >
      {/* Heading */}
      <Text style={[styles.heading, { color: tokens.text }]}>{device.name}</Text>
      {isSelf && (
        <Text style={[styles.selfBadge, { color: tokens.accent }]}>This device</Text>
      )}

      {/* Status card */}
      <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <StatRow label="Platform" value={device.platform} tokens={tokens} />
        <StatRow label="Status" value={device.online ? "Online now" : "Offline"} tokens={tokens} />
        <StatRow label="Last seen" value={new Date(device.last_seen_at).toLocaleString()} tokens={tokens} />
        <StatRow label="Registered" value={new Date(device.created_at).toLocaleString()} tokens={tokens} />
      </View>

      {/* Rename */}
      <Text style={[styles.sectionTitle, { color: tokens.textMuted }]}>Rename</Text>
      <View style={styles.renameRow}>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
              color: tokens.text,
            },
          ]}
          placeholder="New name"
          placeholderTextColor={tokens.textMuted}
          value={renameText}
          onChangeText={setRenameText}
          returnKeyType="done"
          onSubmitEditing={handleRename}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Rename"
          style={[styles.btn, { backgroundColor: tokens.accent }]}
          onPress={handleRename}
          disabled={busy || !renameText.trim()}
        >
          <Text style={[styles.btnText, { color: tokens.accentFg }]}>Rename</Text>
        </TouchableOpacity>
      </View>

      {/* Actions */}
      <Text style={[styles.sectionTitle, { color: tokens.textMuted }]}>Actions</Text>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Jump to feed"
        style={[styles.actionBtn, { borderColor: tokens.border, backgroundColor: tokens.surface }]}
        onPress={handleJumpToFeed}
      >
        <Text style={[styles.actionBtnText, { color: tokens.text }]}>Jump to feed</Text>
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Send test notification"
        style={[styles.actionBtn, { borderColor: tokens.border, backgroundColor: tokens.surface }]}
        onPress={handleSendTestNotification}
      >
        <Text style={[styles.actionBtnText, { color: tokens.text }]}>Send test notification</Text>
      </TouchableOpacity>

      {/* Revoke — disabled for the current device (cannot self-revoke) */}
      {!confirmRevoke ? (
        <>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Revoke"
            style={[styles.actionBtn, { borderColor: isSelf ? tokens.border : tokens.danger, backgroundColor: tokens.surface }]}
            onPress={handleRevoke}
            disabled={busy || isSelf}
          >
            <Text style={[styles.actionBtnText, { color: isSelf ? tokens.textMuted : tokens.danger }]}>Revoke device</Text>
          </TouchableOpacity>
          {isSelf && (
            <Text style={[styles.selfRevokeHint, { color: tokens.textMuted }]}>
              Cannot revoke the current device.
            </Text>
          )}
        </>
      ) : (
        <View style={styles.confirmContainer}>
          <Text style={[styles.confirmText, { color: tokens.danger }]}>
            This will sign out and de-register this device.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Confirm revoke"
            style={[styles.btn, { backgroundColor: tokens.danger }]}
            onPress={handleConfirmRevoke}
            disabled={busy}
          >
            <Text style={[styles.btnText, { color: "#ffffff" }]}>Confirm revoke</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cancel revoke"
            onPress={() => setConfirmRevoke(false)}
          >
            <Text style={[styles.cancelText, { color: tokens.textMuted }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface StatRowProps {
  label: string;
  value: string;
  tokens: ReturnType<typeof useTheme>;
}

function StatRow({ label, value, tokens }: StatRowProps): React.JSX.Element {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color: tokens.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: tokens.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  selfBadge: { fontSize: 13, fontWeight: "600", marginBottom: 16 },
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 20,
  },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  statLabel: { fontSize: 14 },
  statValue: { fontSize: 14, fontWeight: "500" },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 8,
  },
  renameRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    fontSize: 15,
  },
  btn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  btnText: { fontSize: 14, fontWeight: "600" },
  actionBtn: {
    height: 44,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  actionBtnText: { fontSize: 15, fontWeight: "500" },
  confirmContainer: { gap: 8, marginTop: 4 },
  confirmText: { fontSize: 14, marginBottom: 4 },
  cancelText: { fontSize: 14, textAlign: "center", marginTop: 4 },
  notFound: { fontSize: 16, textAlign: "center" },
  selfRevokeHint: { fontSize: 12, textAlign: "center", marginTop: 4, marginBottom: 6 },
});
