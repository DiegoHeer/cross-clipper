/**
 * SettingsScreen — full settings tab (Task 9).
 *
 * Sections: Server · Appearance · Notifications · About.
 * Per spec §2: sections layout (not tabs).
 */
import React from "react";
import { ScrollView, Text, View, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { ServerSection } from "../settings/ServerSection";
import { AppearanceSection } from "../settings/AppearanceSection";
import { NotificationsSection } from "../settings/NotificationsSection";
import { AboutSection } from "../settings/AboutSection";

export function SettingsScreen(): React.JSX.Element {
  const tokens = useTheme();

  return (
    <ScrollView
      style={{ backgroundColor: tokens.bg }}
      contentContainerStyle={styles.container}
    >
      <SectionHeader title="Server" tokens={tokens} />
      <ServerSection />

      <SectionHeader title="Appearance" tokens={tokens} />
      <AppearanceSection />

      <SectionHeader title="Notifications" tokens={tokens} />
      <NotificationsSection />

      <SectionHeader title="About" tokens={tokens} />
      <AboutSection />
    </ScrollView>
  );
}

interface HeaderProps {
  title: string;
  tokens: ReturnType<typeof useTheme>;
}

function SectionHeader({ title, tokens }: HeaderProps): React.JSX.Element {
  return (
    <Text style={[styles.sectionHeader, { color: tokens.textMuted }]}>{title.toUpperCase()}</Text>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 8,
  },
});
