/**
 * App root — wraps in the required provider chain (Task 5):
 * GestureHandlerRootView → ThemeProvider → SyncProvider → NavigationContainer
 */
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { ThemeProvider } from "./theme/ThemeProvider";
import { SyncProvider } from "./sync/useSync";
import { RootNavigator } from "./nav/RootNavigator";

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SyncProvider>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </SyncProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
