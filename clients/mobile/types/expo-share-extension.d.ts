/**
 * Minimal type declaration for expo-share-extension.
 *
 * The package is installed as a native dependency (requires Expo prebuild).
 * This declaration covers only the JS API surface used by the mobile client.
 * The package is mocked in jest (jest.setup.ts, virtual: true) so tests never
 * touch native code.
 */
declare module "expo-share-extension" {
  /** Dismiss the iOS Share Extension and return control to the host app. */
  export function close(): void;
}
