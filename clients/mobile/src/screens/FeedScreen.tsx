/**
 * FeedScreen — full implementation (Tasks 6 + 7).
 *
 * - FlatList of SwipeableRow + FeedCard items (newest-first via ULID sort).
 * - Swipe right → copy to clipboard + show "✓ Copied" chip briefly.
 * - Swipe left → optimistic remove + UndoBar; defer SyncController.remove 5s.
 *   Amendment A5: Undo cancels the timer (no delete); timer fires → one remove call.
 * - Docked Composer (B1) at bottom with TargetChips header row.
 * - Empty-feed hint when no items.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Item, Device } from "@crossclipper/core";

import { useTheme } from "../theme/ThemeProvider";
import { useSync } from "../sync/useSync";
import { FeedCard } from "../feed/FeedCard";
import { SwipeableRow } from "../feed/SwipeableRow";
import { CopiedChip } from "../feed/CopiedChip";
import { UndoBar } from "../feed/UndoBar";
import { Composer } from "../feed/Composer";
import { TargetChips } from "../feed/TargetChips";

const UNDO_DELAY_MS = 5000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingDelete {
  item: Item;
  timerId: ReturnType<typeof setTimeout>;
}

// ─── FeedScreen ───────────────────────────────────────────────────────────────

export function FeedScreen(): React.JSX.Element {
  const tokens = useTheme();
  const { items, devices, selfDeviceId, send, remove } = useSync();

  // Expanded state keyed by item id
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Copied chip: id of item just copied
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Pending deletes: items optimistically hidden while undo is available
  const pendingDeletes = useRef<Map<string, PendingDelete>>(new Map());
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  // UndoBar state: which item is in the undo window (latest delete only)
  const [undoItemId, setUndoItemId] = useState<string | null>(null);

  // Target chip selection (resets to null after send)
  const [target, setTarget] = useState<string | null>(null);

  // Build device map for origin name lookup
  const deviceMap = new Map<string, Device>(devices.map((d) => [d.id, d]));

  // ─── Visible items ──────────────────────────────────────────────────────────

  // Items already sorted newest-first by ULID from FeedStore.
  // Exclude items currently in the optimistic-delete set.
  const visibleItems = items.filter((i) => !deletedIds.has(i.id));

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleCopy = useCallback(
    async (item: Item) => {
      await Clipboard.setStringAsync(item.body);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1800);
    },
    [],
  );

  const handleDelete = useCallback(
    (item: Item) => {
      // Show undo bar for this item
      setUndoItemId(item.id);

      // Optimistic remove from visible list
      setDeletedIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });

      // Schedule actual server delete after undo window
      const timerId = setTimeout(() => {
        pendingDeletes.current.delete(item.id);
        setUndoItemId((cur) => (cur === item.id ? null : cur));
        void remove(item.id);
      }, UNDO_DELAY_MS);

      pendingDeletes.current.set(item.id, { item, timerId });
    },
    [remove],
  );

  const handleUndo = useCallback(
    (itemId: string) => {
      const pending = pendingDeletes.current.get(itemId);
      if (!pending) return;

      // Cancel the deferred delete
      clearTimeout(pending.timerId);
      pendingDeletes.current.delete(itemId);

      // Restore item in visible list
      setDeletedIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });

      setUndoItemId(null);
    },
    [],
  );

  const handleSend = useCallback(
    (kind: "text" | "link", body: string, t: string | null) => {
      void send(kind, body, t ?? undefined);
      setTarget(null); // reset to silent after send
    },
    [send],
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ─── Render item ────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      const originDevice = deviceMap.get(item.origin_device_id);
      const originName = originDevice?.name ?? "Unknown device";

      return (
        <View>
          <SwipeableRow
            onCopy={() => void handleCopy(item)}
            onDelete={() => handleDelete(item)}
          >
            <FeedCard
              item={item}
              originName={originName}
              expanded={!!expanded[item.id]}
              onToggleExpand={() => handleToggleExpand(item.id)}
            />
          </SwipeableRow>
          {copiedId === item.id && (
            <View style={styles.copiedOverlay}>
              <CopiedChip />
            </View>
          )}
        </View>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceMap, expanded, copiedId, handleCopy, handleDelete, handleToggleExpand],
  );

  // ─── Empty state ────────────────────────────────────────────────────────────

  const emptyComponent = (
    <View style={styles.empty}>
      <Text style={[styles.emptyText, { color: tokens.textMuted }]}>
        Nothing here yet — send something from another device!
      </Text>
    </View>
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: tokens.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Target chips header */}
      <TargetChips
        devices={devices}
        selfDeviceId={selfDeviceId}
        value={target}
        onChange={setTarget}
      />

      {/* Feed list */}
      <FlatList
        style={styles.list}
        data={visibleItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={emptyComponent}
        contentContainerStyle={
          visibleItems.length === 0 ? styles.emptyContainer : undefined
        }
      />

      {/* Undo bar */}
      {undoItemId && (
        <UndoBar onUndo={() => handleUndo(undoItemId)} />
      )}

      {/* Docked composer */}
      <Composer onSend={handleSend} target={target} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  copiedOverlay: {
    position: "relative",
  },
});
