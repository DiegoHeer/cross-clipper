/**
 * ServerStep — Step 1 of onboarding: enter server URL and probe it.
 *
 * Mirrors extension popup/onboarding/ServerStep.tsx semantics.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { isInsecureHttp, normalizeServerUrl, probeServer } from "./probe";
import type { ProbeOk } from "./probe";

const ERRORS: Record<Exclude<ReturnType<typeof probeServer> extends Promise<infer R> ? R : never, { ok: true }>["reason"], string> = {
  unreachable: "Could not reach the server. Check the address and your network.",
  unhealthy: "Server is reachable but not healthy. Check server logs.",
  not_crossclipper: "The server did not identify itself as CrossClipper.",
  server_too_old:
    "Server version is too old for this app. Update your CrossClipper server.",
};

export interface ServerStepProps {
  initialUrl?: string;
  onNext(baseUrl: string, probe: ProbeOk): void;
}

export function ServerStep({ initialUrl = "", onNext }: ServerStepProps): React.JSX.Element {
  const tokens = useTheme();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalized = normalizeServerUrl(url);
  const insecure = normalized !== null && isInsecureHttp(normalized);

  const next = async () => {
    setError(null);
    setFound(null);
    if (!normalized) {
      setError("Enter your server address, e.g. https://clip.example.com");
      return;
    }
    setBusy(true);
    try {
      const probe = await probeServer(normalized);
      if (!probe.ok) {
        setError(ERRORS[probe.reason]);
        return;
      }
      setFound(`✓ CrossClipper v${probe.version} found`);
      onNext(normalized, probe);
    } finally {
      setBusy(false);
    }
  };

  const s = styles(tokens);

  return (
    <View style={s.container}>
      <Text style={s.heading}>Your server</Text>
      <Text style={s.muted}>
        CrossClipper is self-hosted — point the app at your server.
      </Text>

      <TextInput
        testID="server-url-input"
        style={s.input}
        value={url}
        placeholder="https://clip.example.com"
        placeholderTextColor={tokens.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setUrl}
        onSubmitEditing={() => void next()}
      />

      {insecure && (
        <Text style={s.warning} accessibilityRole="alert">
          ⚠ Plain http:// to a non-local address sends your clipboard and password unencrypted.
          Put TLS in front of your server.
        </Text>
      )}

      {error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      {found && <Text style={s.success}>{found}</Text>}

      <TouchableOpacity
        style={[s.button, busy && s.buttonDisabled]}
        onPress={() => void next()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Next"
      >
        {busy ? (
          <ActivityIndicator color={tokens.accentFg} />
        ) : (
          <Text style={s.buttonText}>Next</Text>
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
    muted: {
      fontSize: 14,
      color: tokens.textMuted,
      marginBottom: tokens.space[3],
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
      marginBottom: tokens.space[2],
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
    success: {
      fontSize: 13,
      color: tokens.success,
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
