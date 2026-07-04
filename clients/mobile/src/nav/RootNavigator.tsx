/**
 * RootNavigator — bottom-tab shell wrapped in a root stack for modal screens.
 *
 * Three tabs: Feed | Devices | Settings.
 * Devices uses a native stack (list → detail) so the detail screen is pushable.
 * Screens are placeholders; full content lands in Tasks 6–9.
 *
 * Task 14 (Android share intent): a root NativeStack wraps the tab navigator
 * and registers an "AndroidShare" transparentModal screen. On Android, when a
 * share intent is present on launch or foreground, RootNavigatorWithIntent
 * pushes that modal. On iOS the route is not registered (Platform.OS guard).
 */
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { FeedScreen } from "../screens/FeedScreen";
import { DevicesScreen } from "../screens/DevicesScreen";
import { DeviceDetailScreen } from "../screens/DeviceDetailScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { useSync } from "../sync/useSync";
import { useShareIntent } from "../share/useShareIntent";
import { AndroidShareModal } from "../share/AndroidShareModal";

// ─── Param lists ─────────────────────────────────────────────────────────────

export type DevicesStackParamList = {
  DevicesList: undefined;
  DeviceDetail: { deviceId: string };
};

export type RootTabParamList = {
  Feed: { originDeviceId?: string } | undefined;
  DevicesStack: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  AndroidShare: { shared: { kind: "text" | "link"; body: string } };
};

// ─── Navigators ───────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<RootTabParamList>();
const DevicesStack = createNativeStackNavigator<DevicesStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

function DevicesStackNavigator(): React.JSX.Element {
  return (
    <DevicesStack.Navigator>
      <DevicesStack.Screen
        name="DevicesList"
        component={DevicesScreen}
        options={{ title: "Devices" }}
      />
      <DevicesStack.Screen
        name="DeviceDetail"
        component={DeviceDetailScreen}
        options={{ title: "Device" }}
      />
    </DevicesStack.Navigator>
  );
}

// ─── Tab navigator (inner) ────────────────────────────────────────────────────

function TabNavigator(): React.JSX.Element {
  const tokens = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: tokens.accent,
        tabBarInactiveTintColor: tokens.textMuted,
        tabBarStyle: { backgroundColor: tokens.surface, borderTopColor: tokens.border },
        headerStyle: { backgroundColor: tokens.surface },
        headerTintColor: tokens.text,
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{ title: "Feed" }}
      />
      <Tab.Screen
        name="DevicesStack"
        component={DevicesStackNavigator}
        options={{ title: "Devices", headerShown: false }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
    </Tab.Navigator>
  );
}

// ─── Intent wiring (Android only) ────────────────────────────────────────────

/**
 * Inner component: runs inside RootStack.Navigator so it can call useNavigation().
 * Watches the share intent and opens the AndroidShare modal when one is present
 * and the user is authenticated. Resets the intent after navigation to prevent
 * re-opening on subsequent foregrounds.
 *
 * Unauthed + share intent: intent is ignored (modal not opened). The user lands
 * on the normal onboarding/auth flow. The intent is reset so it doesn't resurface
 * after the user signs in.
 */
/** Exported for unit testing only — do not use outside RootNavigator. */
export function TabsWithIntentWatcher(): React.JSX.Element {
  const { shared, reset } = useShareIntent();
  const { authed } = useSync();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shared) {
      // Intent cleared (reset() was called): allow the same body to be handled
      // again if the OS delivers a genuinely new intent later.
      handledRef.current = null;
      return;
    }

    // Stable key: body + kind. Deduplicate re-renders on the same live intent.
    const key = `${shared.kind}:${shared.body}`;
    if (handledRef.current === key) {
      // Belt-and-suspenders: the library's intent is still pending even though
      // we already handled it. Reset so it doesn't strand in the pending state.
      reset();
      return;
    }
    handledRef.current = key;

    if (!authed) {
      // Silently discard — user needs to sign in first.
      reset();
      return;
    }

    // Navigate to the transparent modal, then reset the intent so
    // re-foregrounding doesn't re-open it.
    navigation.navigate("AndroidShare", { shared });
    reset();
  }, [shared, authed, navigation, reset]);

  return <TabNavigator />;
}

// ─── Public navigator ─────────────────────────────────────────────────────────

export function RootNavigator(): React.JSX.Element {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="Tabs" component={TabsWithIntentWatcher} />
      {Platform.OS === "android" && (
        <RootStack.Screen
          name="AndroidShare"
          component={AndroidShareModal}
          options={{ presentation: "transparentModal", animation: "none" }}
        />
      )}
    </RootStack.Navigator>
  );
}
