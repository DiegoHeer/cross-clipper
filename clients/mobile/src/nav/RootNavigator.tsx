/**
 * RootNavigator — bottom-tab shell (Task 5, plan decision 3).
 *
 * Three tabs: Feed | Devices | Settings.
 * Devices uses a native stack (list → detail) so the detail screen is pushable.
 * Screens are placeholders; full content lands in Tasks 6–9.
 */
import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeProvider";
import { FeedScreen } from "../screens/FeedScreen";
import { DevicesScreen } from "../screens/DevicesScreen";
import { DeviceDetailScreen } from "../screens/DeviceDetailScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

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

// ─── Navigators ───────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<RootTabParamList>();
const DevicesStack = createNativeStackNavigator<DevicesStackParamList>();

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

export function RootNavigator(): React.JSX.Element {
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
