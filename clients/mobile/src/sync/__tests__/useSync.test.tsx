/**
 * useSync — production wiring test.
 *
 * Regression for the "10th dead-wire" fix: the production SyncProvider must
 * pass the `appGroup` singleton into SyncController's deps so the App Group
 * drain path (SyncController.ts ~218-245) is live in the real app.
 *
 * Strategy: constructor-spy variant.
 *   - Mock ../platform/appGroup so the module-level `appGroup` export is a
 *     known fake instance pre-populated with a mirror entry.
 *   - Spy on the SyncController constructor (via jest.mock) to capture the
 *     deps object it received.
 *   - Render SyncProvider (no injected controller) and assert that the deps
 *     passed to SyncController include the appGroup reference.
 *
 * This test fails before the fix because useSync.ts did not import or forward
 * `appGroup` — the constructor received { storage, socketFactory, appState,
 * alertSink } with no appGroup key.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { Text } from "react-native";

// Captured constructor calls — populated by the SpySyncController below.
const capturedDeps: unknown[] = [];

// ─── Mock platform/appGroup ───────────────────────────────────────────────────
// Note: jest.mock factories must NOT reference outer-scope variables; inline
// the fake so Babel's hoisting can resolve it safely.
jest.mock("../../platform/appGroup", () => {
  const actual = jest.requireActual<typeof import("../../platform/appGroup")>(
    "../../platform/appGroup",
  );
  return {
    ...actual,
    appGroup: {
      readAuth: jest.fn().mockResolvedValue(null),
      writeAuth: jest.fn().mockResolvedValue(undefined),
      clearAuth: jest.fn().mockResolvedValue(undefined),
      pushToMainOutbox: jest.fn().mockResolvedValue(undefined),
      peekMainOutbox: jest.fn().mockResolvedValue([
        { id: "mirror-01", kind: "text", body: "pending share", targetDeviceId: null },
      ]),
      clearMainOutbox: jest.fn().mockResolvedValue(undefined),
      drainMainOutbox: jest.fn().mockResolvedValue([]),
    },
  };
});

// ─── Spy on SyncController constructor ───────────────────────────────────────
jest.mock("../SyncController", () => {
  const actual = jest.requireActual<typeof import("../SyncController")>(
    "../SyncController",
  );
  const OrigCtrl = actual.SyncController;

  class SpySyncController extends OrigCtrl {
    constructor(deps: ConstructorParameters<typeof OrigCtrl>[0]) {
      capturedDeps.push(deps);
      super(deps);
    }
  }

  return { ...actual, SyncController: SpySyncController };
});

// ─── Imports AFTER mocks ──────────────────────────────────────────────────────
import { SyncProvider } from "../useSync";
import { appGroup as fakeAppGroup } from "../../platform/appGroup";

// ─── Test ─────────────────────────────────────────────────────────────────────

describe("SyncProvider — production wiring (appGroup)", () => {
  beforeEach(() => {
    capturedDeps.length = 0;
  });

  it("passes the appGroup singleton into SyncController deps", () => {
    render(
      <SyncProvider>
        <Text>child</Text>
      </SyncProvider>,
    );

    expect(capturedDeps).toHaveLength(1);
    // The critical assertion: appGroup must be wired — not undefined/missing.
    const deps = capturedDeps[0] as Record<string, unknown>;
    expect(deps["appGroup"]).toBe(fakeAppGroup);
  });
});
