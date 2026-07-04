/**
 * Composer — docked text input for sending new items (spec §2 B1).
 *
 * Grows to ~4 lines. Send button applies detectKind to classify body.
 * Empty/whitespace sends are ignored. Body and target reset after send.
 * Target is managed externally via TargetChips.
 */
import React, { useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "../theme/ThemeProvider";
import { detectKind } from "./format";

export interface ComposerProps {
  onSend: (kind: "text" | "link", body: string, target: string | null) => void;
  /** Optional external target override (from TargetChips). Defaults to null. */
  target?: string | null;
}

export function Composer({ onSend, target = null }: ComposerProps): React.JSX.Element {
  const tokens = useTheme();
  const [body, setBody] = useState("");

  const handleSend = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const kind = detectKind(trimmed);
    onSend(kind, trimmed, target);
    setBody("");
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setBody((prev) => prev + text);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: tokens.surface,
          borderTopColor: tokens.border,
        },
      ]}
    >
      <TextInput
        style={[
          styles.input,
          { color: tokens.text, backgroundColor: tokens.surfaceRaised },
        ]}
        value={body}
        onChangeText={setBody}
        placeholder="Type or paste…"
        placeholderTextColor={tokens.textMuted}
        multiline
        maxLength={65536}
        textAlignVertical="top"
      />
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={() => void handlePaste()}
          accessibilityRole="button"
          accessibilityLabel="Paste from clipboard"
          style={styles.pasteBtn}
        >
          <Text style={[styles.pasteBtnText, { color: tokens.textMuted }]}>
            Paste
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={[styles.sendBtn, { backgroundColor: tokens.accent }]}
        >
          <Text style={[styles.sendBtnText, { color: tokens.accentFg }]}>
            Send
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 8,
  },
  input: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 36,
    maxHeight: 88, // ~4 lines at 22px line height
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 6,
    gap: 8,
  },
  pasteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pasteBtnText: {
    fontSize: 14,
  },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  sendBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
