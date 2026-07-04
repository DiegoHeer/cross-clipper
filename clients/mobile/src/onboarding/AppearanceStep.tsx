/**
 * AppearanceStep — Step 3 of onboarding: pick theme and accent colour.
 *
 * Amber (#d97706) is the default accent — pre-selected in the preview.
 * Mirrors extension popup/onboarding/AppearanceStep.tsx semantics,
 * adapted for React Native primitives.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useTheme, useAppearance } from "../theme/ThemeProvider";
import type { Appearance, ThemeSetting } from "../theme/theme";
import { DEFAULT_APPEARANCE } from "../theme/theme";

export interface AppearanceStepProps {
  onFinish(): void;
}

const ACCENT_OPTIONS = [
  { label: "Amber", value: "#d97706" },
  { label: "Sky", value: "#0284c7" },
  { label: "Violet", value: "#7c3aed" },
  { label: "Rose", value: "#e11d48" },
  { label: "Emerald", value: "#059669" },
];

const THEME_OPTIONS: { label: string; value: ThemeSetting }[] = [
  { label: "System", value: "auto" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export function AppearanceStep({ onFinish }: AppearanceStepProps): React.JSX.Element {
  const tokens = useTheme();
  const { setAppearance } = useAppearance();
  const [draft, setDraft] = useState<Appearance>(DEFAULT_APPEARANCE);

  const updateDraft = (patch: Partial<Appearance>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    // Apply live so the preview responds immediately
    setAppearance(next);
  };

  const finish = (persist: boolean) => {
    if (!persist) {
      // Reset to default if skipping
      setAppearance(DEFAULT_APPEARANCE);
    }
    onFinish();
  };

  const s = styles(tokens);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.heading}>Appearance</Text>

      {/* Theme selector */}
      <Text style={s.sectionLabel}>Theme</Text>
      <View style={s.row}>
        {THEME_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            testID={`theme-${opt.value}`}
            style={[s.chip, draft.theme === opt.value && s.chipSelected]}
            onPress={() => updateDraft({ theme: opt.value })}
            accessibilityRole="button"
            accessibilityLabel={`Theme ${opt.label}`}
          >
            <Text style={[s.chipText, draft.theme === opt.value && s.chipTextSelected]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Accent selector */}
      <Text style={s.sectionLabel}>Accent colour</Text>
      <View style={s.row}>
        {ACCENT_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            testID={`accent-${opt.value}`}
            style={[s.accentSwatch, { backgroundColor: opt.value }]}
            onPress={() => updateDraft({ accent: opt.value })}
            accessibilityRole="button"
            accessibilityLabel={`Accent ${opt.label}`}
          >
            {draft.accent === opt.value && (
              <Text style={{ color: "#ffffff", fontSize: 16 }}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Live preview card */}
      <View
        style={[
          s.previewCard,
          { backgroundColor: tokens.surface, borderColor: tokens.border },
        ]}
        accessibilityLabel="Preview"
      >
        <Text style={[s.previewMeta, { color: tokens.textMuted }]}>just now</Text>
        <Text style={[s.previewBody, { color: tokens.text }]}>
          Hello from CrossClipper — this is how your feed will look.
        </Text>
        <TouchableOpacity
          style={[s.previewButton, { backgroundColor: tokens.accent }]}
          accessibilityRole="button"
          accessibilityLabel="Copy preview"
        >
          <Text style={{ color: tokens.accentFg, fontSize: 12 }}>Copy</Text>
        </TouchableOpacity>
      </View>

      {/* Actions */}
      <View style={s.actions}>
        <TouchableOpacity
          style={s.skipButton}
          onPress={() => finish(false)}
          accessibilityRole="button"
          accessibilityLabel="Skip"
        >
          <Text style={[s.skipText, { color: tokens.textMuted }]}>Skip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.finishButton, { backgroundColor: tokens.accent }]}
          onPress={() => finish(true)}
          accessibilityRole="button"
          accessibilityLabel="Start using CrossClipper"
        >
          <Text style={[s.finishText, { color: tokens.accentFg }]}>
            Start using CrossClipper
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function styles(tokens: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg },
    content: { padding: tokens.space[4] },
    heading: {
      fontSize: 24,
      fontWeight: "700",
      color: tokens.text,
      marginBottom: tokens.space[3],
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: tokens.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: tokens.space[2],
      marginTop: tokens.space[3],
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space[2] },
    chip: {
      paddingHorizontal: tokens.space[3],
      paddingVertical: tokens.space[1],
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.border,
      backgroundColor: tokens.surface,
    },
    chipSelected: {
      borderColor: tokens.accent,
      backgroundColor: tokens.accentSoft,
    },
    chipText: { fontSize: 14, color: tokens.text },
    chipTextSelected: { color: tokens.accent, fontWeight: "600" },
    accentSwatch: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    previewCard: {
      marginTop: tokens.space[4],
      padding: tokens.space[3],
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
    },
    previewMeta: { fontSize: 11, marginBottom: 4 },
    previewBody: { fontSize: 13, marginBottom: tokens.space[2] },
    previewButton: {
      alignSelf: "flex-start",
      paddingHorizontal: tokens.space[2],
      paddingVertical: 2,
      borderRadius: tokens.radius.sm,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: tokens.space[5],
      gap: tokens.space[2],
    },
    skipButton: {
      paddingVertical: tokens.space[3],
      paddingHorizontal: tokens.space[3],
    },
    skipText: { fontSize: 15 },
    finishButton: {
      flex: 1,
      paddingVertical: tokens.space[3],
      borderRadius: tokens.radius.md,
      alignItems: "center",
    },
    finishText: { fontSize: 15, fontWeight: "600" },
  });
}
