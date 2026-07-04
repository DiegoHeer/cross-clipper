/**
 * AndroidShareModal.tsx — Transparent in-app modal rendering the A2 share sheet.
 *
 * Decision 8 (plan): Android share intent → transparent in-app modal using the
 * MAIN app's SyncController.send (outbox path), not sendDirect / ApiClient.
 *
 * Flow:
 *   1. RootNavigator detects a pending intent and pushes "AndroidShare" modal.
 *   2. Modal renders ShareSheet with the shared payload (passed as route.params).
 *   3. User taps a tile → adapted sendFn calls useSync().send → item queued in outbox.
 *   4. "Sent ✓" shown, then modal auto-dismisses via navigation.goBack().
 *
 * iOS: this screen is never registered in the navigator on iOS — the Platform.OS
 * guard in RootNavigator prevents it. As a belt-and-suspenders guard this component
 * also returns null when Platform.OS !== 'android'.
 */
import React, { useCallback } from "react";
import { Modal, Platform, StyleSheet, TouchableWithoutFeedback, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ShareSheet } from "./ShareSheet";
import { useSync } from "../sync/useSync";
import type { SendDirectInput, SendDirectResult } from "./sendDirect";
import type { RootStackParamList } from "../nav/RootNavigator";

// ─── Screen props ─────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, "AndroidShare">;

// ─── Component ───────────────────────────────────────────────────────────────

export function AndroidShareModal({ route, navigation }: Props): React.JSX.Element | null {
  if (Platform.OS !== "android") return null;

  const { send, devices, selfDeviceId } = useSync();
  const { shared } = route.params;

  const handleSent = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleError = useCallback((_message: string) => {
    // ShareSheet shows the retryHint toast; dismiss so user lands on main feed.
    navigation.goBack();
  }, [navigation]);

  // Adapt useSync().send signature to ShareSheet.sendFn shape.
  const sendFn = useCallback(
    async (input: SendDirectInput): Promise<SendDirectResult> => {
      try {
        await send(input.kind, input.body, input.targetDeviceId);
        return { status: "sent", item: {} };
      } catch {
        return {
          status: "queued",
          retryHint: "Couldn't send — open app to retry",
        };
      }
    },
    [send],
  );

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={() => navigation.goBack()}
    >
      <TouchableWithoutFeedback
        onPress={() => navigation.goBack()}
        accessibilityLabel="Dismiss share sheet"
      >
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={s.sheet}>
        <ShareSheet
          shared={shared}
          devices={devices}
          selfDeviceId={selfDeviceId ?? ""}
          onSent={handleSent}
          onError={handleError}
          sendFn={sendFn}
        />
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
});
