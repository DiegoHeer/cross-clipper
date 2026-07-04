/**
 * AppearanceSection — theme toggle + accent swatches + custom color (Task 9).
 *
 * Mirrors the extension ThemeControls. Uses setAppearance from ThemeProvider.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useTheme, useAppearance } from "../theme/ThemeProvider";
import { accentForeground } from "../theme/theme";
import type { ThemeSetting } from "../theme/theme";

// Accent presets mirrored from extension ThemeControls (cross-client contract).
export const ACCENT_PRESETS: string[] = [
  "#d97706", // amber (default)
  "#2563eb", // blue
  "#16a34a", // green
  "#dc2626", // red
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#ea580c", // orange
];

const THEME_OPTIONS: { label: string; value: ThemeSetting }[] = [
  { label: "Light", value: "light" },
  { label: "Auto", value: "auto" },
  { label: "Dark", value: "dark" },
];

export function AppearanceSection(): React.JSX.Element {
  const tokens = useTheme();
  const { appearance, setAppearance } = useAppearance();
  const [customHex, setCustomHex] = useState("");

  const handleTheme = (theme: ThemeSetting) => {
    setAppearance({ ...appearance, theme });
  };

  const handleAccent = (accent: string) => {
    setAppearance({ ...appearance, accent });
  };

  const handleCustomAccent = () => {
    const trimmed = customHex.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      handleAccent(trimmed);
    }
  };

  const previewFg = accentForeground(appearance.accent);

  return (
    <View style={styles.section}>
      {/* Theme toggle */}
      <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>Theme</Text>
      <View style={[styles.themeRow, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        {THEME_OPTIONS.map(({ label, value }) => {
          const active = appearance.theme === value;
          return (
            <TouchableOpacity
              key={value}
              accessibilityRole="button"
              style={[
                styles.themeBtn,
                active && { backgroundColor: tokens.accent },
              ]}
              onPress={() => handleTheme(value)}
            >
              <Text
                style={[
                  styles.themeBtnText,
                  { color: active ? previewFg : tokens.text },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Accent preview */}
      <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>Accent color</Text>
      <View
        testID="accent-preview"
        style={[styles.preview, { backgroundColor: appearance.accent }]}
      >
        <Text style={[styles.previewText, { color: previewFg }]}>CrossClipper</Text>
      </View>

      {/* Accent swatches */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swatchScroll}>
        {ACCENT_PRESETS.map((color) => {
          const selected = appearance.accent === color;
          const fg = accentForeground(color);
          return (
            <TouchableOpacity
              key={color}
              testID={`swatch-${color}`}
              accessibilityRole="button"
              accessibilityLabel={`Accent color ${color}`}
              style={[
                styles.swatch,
                { backgroundColor: color },
                selected && { borderWidth: 3, borderColor: tokens.text },
              ]}
              onPress={() => handleAccent(color)}
            >
              {selected && (
                <Text style={[styles.swatchCheck, { color: fg }]}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Custom hex input */}
      <View style={styles.customRow}>
        <TextInput
          style={[
            styles.customInput,
            {
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
              color: tokens.text,
            },
          ]}
          placeholder="#rrggbb"
          placeholderTextColor={tokens.textMuted}
          value={customHex}
          onChangeText={setCustomHex}
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={handleCustomAccent}
        />
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.customBtn, { backgroundColor: tokens.accent }]}
          onPress={handleCustomAccent}
        >
          <Text style={[styles.customBtnText, { color: previewFg }]}>Apply</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 12,
  },
  themeRow: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 4,
  },
  themeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  themeBtnText: { fontSize: 14, fontWeight: "500" },
  preview: {
    height: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  previewText: { fontSize: 16, fontWeight: "600" },
  swatchScroll: { marginBottom: 12 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchCheck: { fontSize: 16, fontWeight: "700" },
  customRow: { flexDirection: "row", gap: 8 },
  customInput: {
    flex: 1,
    height: 40,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  customBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  customBtnText: { fontSize: 14, fontWeight: "600" },
});
