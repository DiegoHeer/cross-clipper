/**
 * SignInStep — Step 2 of onboarding: sign in or create account.
 *
 * Mirrors extension popup/onboarding/SignInStep.tsx semantics.
 * Uses Platform.OS for the `platform` field and expo-device for device name suggestion.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import * as ExpoDevice from "expo-device";
import { ApiClient } from "@crossclipper/core";
import { useTheme } from "../theme/ThemeProvider";
import { CLIENT_VERSION } from "../sync/SyncController";
import { saveAuth } from "./authPersist";

// ─── Device name suggestion ───────────────────────────────────────────────────

/** Suggest a device name from expo-device. Falls back to a sensible default. */
export function suggestDeviceName(): string {
  const model = ExpoDevice.modelName;
  if (model) return model;
  return Platform.OS === "ios" ? "My iPhone" : "My Android";
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface SignInStepProps {
  baseUrl: string;
  mode: "signin" | "create" | "reauth";
  notice?: string;
  onDone(): void;
}

export function SignInStep({ baseUrl, mode, notice, onDone }: SignInStepProps): React.JSX.Element {
  const tokens = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(suggestDeviceName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const heading = mode === "create" ? "Create your account" : "Sign in";
  const cta = mode === "create" ? "Create account" : "Sign in";

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const client = new ApiClient({ baseUrl, clientVersion: CLIENT_VERSION });
      if (mode === "create") await client.register(email, password);
      const login = await client.login({
        email,
        password,
        device_name: deviceName,
        platform: Platform.OS === "ios" ? "ios" : "android",
      });
      await saveAuth({
        baseUrl,
        token: login.token,
        deviceId: login.device_id,
        deviceName,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const s = styles(tokens);

  return (
    <View style={s.container}>
      <Text style={s.heading}>{heading}</Text>

      {notice && (
        <Text style={s.warning} accessibilityRole="alert">
          {notice}
        </Text>
      )}

      <Text style={s.serverLabel}>{baseUrl.replace(/^https?:\/\//, "")}</Text>

      <Text style={s.label}>Email</Text>
      <TextInput
        testID="signin-email"
        style={s.input}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={tokens.textMuted}
        placeholder="you@example.com"
      />

      <Text style={s.label}>Password</Text>
      <TextInput
        testID="signin-password"
        style={s.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholderTextColor={tokens.textMuted}
        placeholder="••••••••"
      />

      <Text style={s.label}>Device name</Text>
      <TextInput
        testID="signin-device-name"
        style={s.input}
        value={deviceName}
        onChangeText={setDeviceName}
        placeholderTextColor={tokens.textMuted}
      />

      {error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <TouchableOpacity
        style={[s.button, (busy || !email || !password) && s.buttonDisabled]}
        onPress={() => void submit()}
        disabled={busy || !email || !password}
        accessibilityRole="button"
        accessibilityLabel={cta}
      >
        {busy ? (
          <ActivityIndicator color={tokens.accentFg} />
        ) : (
          <Text style={s.buttonText}>{cta}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function styles(tokens: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      padding: tokens.space[4],
      backgroundColor: tokens.bg,
    },
    heading: {
      fontSize: 24,
      fontWeight: "700",
      color: tokens.text,
      marginBottom: tokens.space[2],
    },
    serverLabel: {
      fontSize: 13,
      color: tokens.textMuted,
      marginBottom: tokens.space[3],
    },
    label: {
      fontSize: 13,
      fontWeight: "600",
      color: tokens.text,
      marginBottom: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: tokens.radius.md,
      paddingHorizontal: tokens.space[3],
      paddingVertical: tokens.space[2],
      fontSize: 15,
      color: tokens.text,
      backgroundColor: tokens.surface,
      marginBottom: tokens.space[3],
    },
    warning: {
      fontSize: 13,
      color: "#b45309",
      marginBottom: tokens.space[2],
    },
    error: {
      fontSize: 13,
      color: tokens.danger,
      marginBottom: tokens.space[2],
    },
    button: {
      backgroundColor: tokens.accent,
      borderRadius: tokens.radius.md,
      paddingVertical: tokens.space[3],
      alignItems: "center",
      marginTop: tokens.space[2],
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: tokens.accentFg,
      fontSize: 16,
      fontWeight: "600",
    },
  });
}
