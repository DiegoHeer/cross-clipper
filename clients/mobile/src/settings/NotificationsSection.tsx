/**
 * NotificationsSection — notification policy surface (Task 9).
 *
 * Per spec §3:
 * - Targeted items: always alert, non-configurable (shown as "Always ✓").
 * - Untargeted items: user toggle "Notify on all new items" (default off).
 * - Own-origin items: never alert (handled by AlertManager, not configurable here).
 */
import React, { useEffect, useState } from "react";
import { View, Text, Switch, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { loadPrefs, savePrefs, DEFAULT_PREFS, type Prefs } from "./prefs";

export function NotificationsSection(): React.JSX.Element {
  const tokens = useTheme();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    void loadPrefs().then(setPrefs);
  }, []);

  const handleToggle = async (value: boolean) => {
    const next: Prefs = { ...prefs, notifyOnNewItems: value };
    setPrefs(next);
    await savePrefs(next);
  };

  return (
    <View style={styles.section}>
      {/* Targeted — always on, non-configurable */}
      <View style={[styles.row, { borderBottomColor: tokens.border }]}>
        <View style={styles.labelCol}>
          <Text style={[styles.label, { color: tokens.text }]}>
            When targeted at this device
          </Text>
          <Text style={[styles.sub, { color: tokens.textMuted }]}>
            Always alert, not configurable
          </Text>
        </View>
        <Text style={[styles.alwaysTag, { color: tokens.success }]}>Always ✓</Text>
      </View>

      {/* All new items toggle */}
      <View style={[styles.row, { borderBottomColor: tokens.border }]}>
        <View style={styles.labelCol}>
          <Text style={[styles.label, { color: tokens.text }]}>
            Notify on all new items
          </Text>
          <Text style={[styles.sub, { color: tokens.textMuted }]}>
            Alert for every untargeted item (default off)
          </Text>
        </View>
        <Switch
          testID="notify-all-switch"
          value={prefs.notifyOnNewItems}
          onValueChange={(v) => void handleToggle(v)}
          trackColor={{ false: tokens.border, true: tokens.accent }}
          thumbColor={prefs.notifyOnNewItems ? tokens.accentFg : tokens.surface}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labelCol: { flex: 1 },
  label: { fontSize: 15, fontWeight: "500" },
  sub: { fontSize: 13, marginTop: 2 },
  alwaysTag: { fontSize: 14, fontWeight: "600" },
});
