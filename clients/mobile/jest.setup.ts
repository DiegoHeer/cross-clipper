import "react-native-gesture-handler/jestSetup";

jest.mock("react-native-reanimated", () =>
  require("react-native-reanimated/mock"),
);

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
  getStringAsync: jest.fn().mockResolvedValue(""),
}));

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }),
}));

jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("notif-id"),
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
}));

jest.mock("expo-device", () => ({
  modelName: "Test Device",
  isDevice: false,
}));

jest.mock("expo-share-extension", () => ({ close: jest.fn() }), { virtual: true });

// expo-share-intent uses a native module (ExpoShareIntentModule) that doesn't
// exist in the jest environment. Mock the whole package at the module boundary.
// Individual tests override this via jest.mock() with custom return values.
jest.mock("expo-share-intent", () => ({
  __esModule: true,
  useShareIntent: jest.fn().mockReturnValue({
    isReady: true,
    hasShareIntent: false,
    shareIntent: { files: null, text: null, webUrl: null, type: null },
    resetShareIntent: jest.fn(),
    error: null,
  }),
}));
