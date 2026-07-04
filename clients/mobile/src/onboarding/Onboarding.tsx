/**
 * Onboarding — 3-step flow: server probe → sign-in/create → appearance.
 *
 * Mirrors extension popup/onboarding/Onboarding.tsx semantics,
 * adapted for React Native.
 *
 * mode="fresh"   → steps 1 → 2 → 3
 * mode="reauth"  → skips to step 2 with server pre-filled (no retry loop)
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { ServerStep } from "./ServerStep";
import { SignInStep } from "./SignInStep";
import { AppearanceStep } from "./AppearanceStep";
import type { ProbeOk } from "./probe";

export interface OnboardingProps {
  mode?: "fresh" | "reauth";
  initialServer?: string;
  notice?: string;
  onComplete(): void;
}

export function Onboarding({
  mode = "fresh",
  initialServer,
  notice,
  onComplete,
}: OnboardingProps): React.JSX.Element {
  const tokens = useTheme();

  // Reauth with a known server starts at step 2 directly
  const [step, setStep] = useState(mode === "reauth" && initialServer ? 2 : 1);
  const [baseUrl, setBaseUrl] = useState(initialServer ?? "");
  const [signInMode, setSignInMode] = useState<"signin" | "create" | "reauth">(
    mode === "reauth" ? "reauth" : "signin",
  );

  const s = styles(tokens);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.logo}>⧉ CrossClipper</Text>
        <Text style={s.stepIndicator}>step {step}/3</Text>
      </View>

      {step === 1 && (
        <ServerStep
          initialUrl={baseUrl}
          onNext={(url: string, probe: ProbeOk) => {
            setBaseUrl(url);
            setSignInMode(
              probe.registrationOpen
                ? "create"
                : mode === "reauth"
                  ? "reauth"
                  : "signin",
            );
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <SignInStep
          baseUrl={baseUrl}
          mode={signInMode}
          notice={notice}
          onDone={() => setStep(3)}
        />
      )}

      {step === 3 && <AppearanceStep onFinish={onComplete} />}
    </SafeAreaView>
  );
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function styles(tokens: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: tokens.bg,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: tokens.space[4],
      paddingVertical: tokens.space[3],
      borderBottomWidth: 1,
      borderBottomColor: tokens.border,
    },
    logo: {
      fontSize: 18,
      fontWeight: "700",
      color: tokens.text,
    },
    stepIndicator: {
      fontSize: 13,
      color: tokens.textMuted,
    },
  });
}
