/**
 * FeedCard — renders a single feed item.
 *
 * - Full body text; bodies > 12 lines are capped with "Show more"/"Show less".
 * - link kind → tappable (opens in-app browser via expo-web-browser).
 * - unknown kind → "Unsupported item — update client" fallback.
 * - Origin device name + relative time shown in metadata row.
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { Item } from "@crossclipper/core";
import { useTheme } from "../theme/ThemeProvider";
import { relativeTime } from "./format";

const SHOW_MORE_THRESHOLD = 12;

export interface FeedCardProps {
  item: Item;
  originName: string;
  expanded: boolean;
  onToggleExpand: () => void;
}

export function FeedCard({
  item,
  originName,
  expanded,
  onToggleExpand,
}: FeedCardProps): React.JSX.Element {
  const tokens = useTheme();
  const { kind, body, created_at } = item;

  const lines = body.split("\n");
  const needsTruncation = lines.length > SHOW_MORE_THRESHOLD;
  const visibleBody =
    !expanded && needsTruncation
      ? lines.slice(0, SHOW_MORE_THRESHOLD).join("\n")
      : body;

  const timeLabel = relativeTime(created_at);

  // ─── Render body based on kind ──────────────────────────────────────────────

  let bodyNode: React.ReactNode;

  if (kind === "link") {
    bodyNode = (
      <TouchableOpacity
        accessibilityRole="link"
        accessibilityLabel={body}
        onPress={() => void WebBrowser.openBrowserAsync(body)}
      >
        <Text style={[styles.bodyLink, { color: tokens.accent }]}>{body}</Text>
      </TouchableOpacity>
    );
  } else if (kind === "text") {
    bodyNode = (
      <Text style={[styles.body, { color: tokens.text }]}>{visibleBody}</Text>
    );
  } else {
    // Unknown kind — graceful fallback
    bodyNode = (
      <Text style={[styles.fallback, { color: tokens.textMuted }]}>
        Unsupported item — update client
      </Text>
    );
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tokens.surface, borderColor: tokens.border },
      ]}
    >
      {/* Metadata row */}
      <View style={styles.meta}>
        <Text style={[styles.origin, { color: tokens.textMuted }]}>
          {originName}
        </Text>
        <Text style={[styles.time, { color: tokens.textMuted }]}>
          {timeLabel}
        </Text>
      </View>

      {/* Body */}
      {bodyNode}

      {/* Show more / Show less toggle */}
      {needsTruncation && kind !== "link" && kind !== ("image" as unknown) && kind !== ("file" as unknown) && (
        <TouchableOpacity
          onPress={onToggleExpand}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Show less" : "Show more"}
        >
          <Text style={[styles.toggle, { color: tokens.accent }]}>
            {expanded ? "Show less" : "Show more"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 4,
  },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  origin: {
    fontSize: 12,
    fontWeight: "500",
  },
  time: {
    fontSize: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  bodyLink: {
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: "underline",
  },
  fallback: {
    fontSize: 14,
    fontStyle: "italic",
  },
  toggle: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 6,
  },
});
