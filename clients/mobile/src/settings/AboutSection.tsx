/**
 * AboutSection — version, self-hosting note, no-E2EE honesty (Task 9).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { CLIENT_VERSION } from "../sync/SyncController";

export function AboutSection(): React.JSX.Element {
  const tokens = useTheme();

  return (
    <View style={styles.section}>
      <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <Row label="Version" value={CLIENT_VERSION} tokens={tokens} />
        <View style={styles.noteRow}>
          <Text style={[styles.noteText, { color: tokens.textMuted }]}>
            CrossClipper is a self-hosted tool. Your data lives on your own server.
            There is no end-to-end encryption — traffic is protected by TLS between
            your devices and your server.
          </Text>
        </View>
      </View>
    </View>
  );
}

interface RowProps {
  label: string;
  value: string;
  tokens: ReturnType<typeof useTheme>;
}

function Row({ label, value, tokens }: RowProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: tokens.textMuted }]}>{label}</Text>
      <Text style={[styles.value, { color: tokens.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {},
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: "500" },
  noteRow: { marginTop: 8 },
  noteText: { fontSize: 13, lineHeight: 19 },
});
