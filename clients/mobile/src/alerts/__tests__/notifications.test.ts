/**
 * notifications.ts — ensurePermission cache correctness.
 *
 * Bug: the original code cached `permissionRequested = true` regardless of the
 * grant result. After a DENIAL, subsequent calls short-circuit and return `true`
 * (stale), causing silent no-ops where a re-attempt could have worked.
 *
 * Fix: cache only when granted === true; when false, allow re-evaluation on the
 * next call.
 *
 * Uses jest.isolateModules() to get a fresh module instance per test so the
 * module-level cache variable is reset.
 */
import * as ExpoNotifications from "expo-notifications";

// jest.setup.ts mocks expo-notifications globally with status:"granted".
// Each test below overrides requestPermissionsAsync for its own scenario.

describe("ensurePermission — cache correctness (M1)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("denial does NOT cache true — scheduleNotificationAsync is skipped", (done) => {
    // expo-notifications requestPermissionsAsync returns DENIED.
    (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: "denied",
      granted: false,
      canAskAgain: true,
      expires: "never",
    });

    jest.isolateModules(() => {
      // Fresh module instance — cache starts clear.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { presentNotification } = require("../notifications") as typeof import("../notifications");

      void presentNotification({ title: "T", body: "B" }).then(() => {
        // With denial, scheduleNotificationAsync must NOT be called.
        expect(ExpoNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it("denial does NOT produce stale true — subsequent calls re-request", (done) => {
    // First request: DENIED.
    (ExpoNotifications.requestPermissionsAsync as jest.Mock)
      .mockResolvedValueOnce({
        status: "denied",
        granted: false,
        canAskAgain: true,
        expires: "never",
      })
      // Second request: GRANTED — only reached if the cache was not set to true.
      .mockResolvedValueOnce({
        status: "granted",
        granted: true,
        canAskAgain: true,
        expires: "never",
      });

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { presentNotification } = require("../notifications") as typeof import("../notifications");

      void presentNotification({ title: "T", body: "B" })
        .then(() => {
          // First call: denied — no notification.
          expect(ExpoNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
          return presentNotification({ title: "T2", body: "B2" });
        })
        .then(() => {
          // Second call: granted — notification must fire.
          // If denial was wrongly cached as true, requestPermissionsAsync would
          // only be called once and scheduleNotificationAsync would still be 0.
          expect(ExpoNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(2);
          expect(ExpoNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
          done();
        });
    });
  });

  it("grant IS cached — second call does not re-request permissions", (done) => {
    (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "granted",
      granted: true,
      canAskAgain: true,
      expires: "never",
    });

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { presentNotification } = require("../notifications") as typeof import("../notifications");

      void presentNotification({ title: "A", body: "1" })
        .then(() => presentNotification({ title: "B", body: "2" }))
        .then(() => {
          // Permission must only be requested ONCE for two calls.
          expect(ExpoNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
          expect(ExpoNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
          done();
        });
    });
  });
});
