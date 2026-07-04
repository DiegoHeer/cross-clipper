/**
 * App root — wraps in the required provider chain (Task 5):
 * GestureHandlerRootView → ThemeProvider → SyncProvider → NavigationContainer
 *
 * Root gate (Task 10): renders Onboarding when the user is not authenticated
 * or when auth expired (authRequired). Uses the latched-gate pattern from the
 * extension: the `onboarding` flag is set ONCE at the first auth resolution
 * so that signing in (which emits authed=true) does NOT unmount the Onboarding
 * component before step 3 (Appearance) is shown.
 *
 * Latched gate logic:
 *   null  — auth not yet resolved (show nothing / loading)
 *   true  — user was not authed at first resolution → show Onboarding
 *   false — user was already authed → show main app
 *
 * authRequired (token expired / device revoked) overrides the latch to show
 * Onboarding in reauth mode WITHOUT waiting for a re-latch.
 */
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { ThemeProvider } from "./theme/ThemeProvider";
import { SyncProvider, useSync } from "./sync/useSync";
import { RootNavigator } from "./nav/RootNavigator";
import { Onboarding } from "./onboarding/Onboarding";

// ─── Inner gate (inside SyncProvider) ────────────────────────────────────────

function AppGate(): React.JSX.Element {
  const { authed, authRequired, baseUrl, onSignedIn } = useSync();

  // Latched onboarding flag — mirrors extension App.tsx exactly.
  // null = auth not yet resolved; true = show onboarding; false = skip onboarding.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    // Latch once: the first time `authed` is determined (either true or false).
    // After that we only update via onComplete (user finishes the 3-step flow).
    // SyncController emits after doWake() resolves — authedFlag is then stable.
    if (onboarding === null) {
      setOnboarding(!authed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // authRequired always overrides: show onboarding in reauth mode
  if (authRequired) {
    return (
      <Onboarding
        mode="reauth"
        initialServer={baseUrl ?? undefined}
        notice="Session expired or device revoked — sign in again."
        onComplete={() => {
          void onSignedIn();
        }}
      />
    );
  }

  // Still resolving — show nothing (avoids flash)
  if (onboarding === null) return <></>;

  if (onboarding) {
    return (
      <Onboarding
        mode="fresh"
        onComplete={() => {
          setOnboarding(false);
          void onSignedIn();
        }}
      />
    );
  }

  return (
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SyncProvider>
          <AppGate />
        </SyncProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
