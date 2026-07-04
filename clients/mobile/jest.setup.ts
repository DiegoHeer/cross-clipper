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
