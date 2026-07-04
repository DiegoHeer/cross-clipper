/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["./jest.setup.ts"],
  moduleNameMapper: {
    // jest-expo 53 accesses NativeModules.default but RN 0.76 mock has no
    // .default property — shim it so jest-expo setup.js doesn't throw.
    "^react-native/Libraries/BatchedBridge/NativeModules$":
      "<rootDir>/jest-mocks/NativeModules.js",
  },
  // Override the preset's transformIgnorePatterns to include all expo-* packages
  // and @crossclipper scoped packages. The pattern excludes these from the
  // "don't transform" rule so babel-jest processes their source.
  transformIgnorePatterns: [
    "node_modules/(?!(" +
      "(jest-)?react-native" +
      "|@react-native(-community)?" +
      "|expo(-[^/]*)?" +
      "|@expo(-[^/]*)?" +
      "|@expo-google-fonts" +
      "|@unimodules" +
      "|unimodules" +
      "|sentry-expo" +
      "|native-base" +
      "|react-native-svg" +
      "|@crossclipper" +
      "|@react-navigation" +
      ")/)",
    // Also ignore the reanimated plugin
    "node_modules/react-native-reanimated/plugin/",
  ],
};
