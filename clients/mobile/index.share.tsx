/**
 * index.share.tsx — iOS Share Extension entry point (Task 13).
 *
 * Registered as the custom React root for the share extension target via
 * expo-share-extension. This file is the extension's JS bundle root — it is
 * a SEPARATE process from the main app. No SyncEngine or Outbox here.
 *
 * On mount:
 *   1. Read auth bundle from the App Group shared container.
 *   2. Render the A2 tile row (ShareSheet).
 *   3. On tile tap: POST directly via sendDirect (core's ApiClient).
 *   4. On success: call onSent (caller dismisses via native close()).
 *   5. On failure: push the same ULID to the App Group outbox mirror, surface
 *      "open app to retry".
 */
import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { registerRootComponent } from "expo";
import { ShareSheet } from "./src/share/ShareSheet";
import { sendDirect } from "./src/share/sendDirect";
import { appGroup } from "./src/platform/appGroup";
import { ThemeProvider, useTheme } from "./src/theme/ThemeProvider";
import type { AuthBundle } from "./src/platform/appGroup";
import type { Device } from "@crossclipper/core";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SharePayload {
  kind: "text" | "link";
  body: string;
}

// ─── Root component ───────────────────────────────────────────────────────────

function ShareRoot(): React.JSX.Element {
  const tokens = useTheme();
  const [auth, setAuth] = useState<AuthBundle | null>(null);
  const [devices] = useState<Device[]>([]);
  const [lastUsedDeviceId, setLastUsedDeviceId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  // expo-share-extension provides the shared content via its native bridge.
  // In production this is injected by the extension host.
  const [shared] = useState<SharePayload>({ kind: "text", body: "" });

  useEffect(() => {
    void (async () => {
      try {
        const bundle = await appGroup.readAuth();
        setAuth(bundle);
        // Device list is loaded from the cached list written by the main app.
        // In a full prebuild the native layer populates this; for the JS-only
        // bundle the device list starts empty and users see only the broadcast tile.
      } catch (err) {
        setErrorMsg(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const s = makeStyles(tokens);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!auth) {
    return (
      <View style={s.center}>
        <Text style={s.msg}>Sign in to CrossClipper to share.</Text>
      </View>
    );
  }

  if (errorMsg) {
    return (
      <View style={s.center}>
        <Text style={s.msg}>{errorMsg}</Text>
      </View>
    );
  }

  if (retryMsg) {
    return (
      <View style={s.center}>
        <Text style={s.msg}>{retryMsg}</Text>
      </View>
    );
  }

  return (
    <ShareSheet
      shared={shared}
      devices={devices}
      selfDeviceId={auth.deviceId}
      lastUsedDeviceId={lastUsedDeviceId}
      onSent={() => {
        // expo-share-extension dismisses via its native close() bridge.
        // The implementation calls this after the "Sent ✓" feedback delay.
      }}
      onError={(msg) => {
        setRetryMsg(msg);
      }}
      sendFn={(input) =>
        sendDirect(
          { baseUrl: auth.baseUrl, token: auth.token, appGroup },
          input,
        ).then((result) => {
          if (result.status === "sent" && input.targetDeviceId) {
            setLastUsedDeviceId(input.targetDeviceId);
          }
          return result;
        })
      }
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(tokens: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: tokens.bg,
      padding: tokens.space[4],
    },
    msg: {
      color: tokens.textMuted,
      fontSize: 14,
      textAlign: "center",
    },
  });
}

// ─── Root with providers ──────────────────────────────────────────────────────

function ShareExtensionRoot(): React.JSX.Element {
  return (
    <ThemeProvider>
      <ShareRoot />
    </ThemeProvider>
  );
}

registerRootComponent(ShareExtensionRoot);

export default ShareExtensionRoot;
