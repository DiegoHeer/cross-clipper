# CrossClipper Phase 4 — Mobile Client (iOS + Android, React Native) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React Native app for iOS + Android whose primary *send* path is the OS share sheet and whose primary in-app job is reading/copying the feed. Bottom tabs (Feed / Devices / Settings), full-text feed cards with swipe-right-to-copy / swipe-left-to-delete, an AirDrop-style share sheet implementing the notification-targeting policy, onboarding (server probe + sign-in), settings, and notification policy on live items. **WS-only delivery this phase** — APNs/FCM background push is Phase 5.

**Architecture:** The app is deliberately thin: it owns a single `@crossclipper/core` `SyncEngine` + `Outbox` instance driven by an `AppState` lifecycle (foreground → `engine.start()` reconnect+pull; background → `engine.stop()`; next foreground catches up via the one cursor-pull recovery path). Core is platform-agnostic already — it needs only globals RN provides (`fetch`, `WebSocket`, `setTimeout`) plus a `SyncStorage`. Phase 4 adds a **thin RN adapter layer** (AsyncStorage→`SyncStorage`, RN `WebSocket`→`SocketFactory`) and reuses core's `ApiClient`/`SyncEngine`/`Outbox`/`ItemCache` verbatim. Notification policy is ported from the extension's `AlertManager` into a **core-adjacent, platform-injected `AlertManager`** (same watermark/dedup semantics, RN local-notification sink). The iOS Share Extension is a **separate JS entry** (its own React root via `expo-share-extension`) that shares the auth token through an App Group and posts directly to the server, then dismisses — it never launches the main app. Android share uses `expo-share-intent` to route the shared payload into a transparent in-app A2 sheet.

**Tech Stack:** Expo SDK (managed workflow + Continuous Native Generation / prebuild), React Native, TypeScript, `expo-router` or `@react-navigation/bottom-tabs` (see decision 3), `react-native-gesture-handler` + `react-native-reanimated` (swipe rows), `@react-native-async-storage/async-storage` (persistence), `expo-clipboard`, `expo-notifications` (local, foreground banners; push in Phase 5), `expo-share-extension` (iOS custom-view share target), `expo-share-intent` (Android share intent), `jest` + `jest-expo` + `@testing-library/react-native`, `@crossclipper/core` (Phases 1–2). CI: GitHub Actions `ubuntu-latest` for jest/typecheck/lint (paths-filtered); iOS simulator/EAS builds and device distribution are **manual/gated** (decision 12).

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the specs.

- **The app consumes `@crossclipper/core`, never reimplements sync logic** (system spec §2 principle 2). Sync state machine, reconnect/backoff, cursor, outbox, dedup, tombstones all come from core. Mobile code is UI + platform glue (share intake, clipboard write, local notifications, AppState lifecycle, storage/socket adapters) only. Resist adding any sync logic to the client.
- Sync source of truth is always `GET /items?cursor=<opaque next_cursor>` (core's `SyncEngine.start()` pulls on WS-open). WS is a nudge channel, live only while foregrounded; push (Phase 5) is a content-free wake ping. **One recovery path** covers cold start, reconnect, and (later) push-wake. Never add mobile state that depends on not missing a WS event. Clients never parse cursors.
- **No passive clipboard watching on any platform** (system spec §1 non-goals; impossible on iOS, restricted on Android — do not attempt). Capture is deliberate: OS share sheet + in-app compose. Clipboard is *read* only on an explicit "paste" press; *written* only on an explicit copy action (foreground) or Android notification COPY broadcast (Phase 5).
- **Notification policy** (system spec §4 amended): visibility is always broadcast; alerting follows targeting. (1) Targeted item → only the target device raises a banner, always, regardless of toggle; all others sync silently. (2) Untargeted → silent everywhere by default; each device has a local **"Notify on all new items"** toggle (default **off**). (3) Own-origin items → never alert self. Dedup across restarts/re-pulls via a persisted ULID watermark. The device list is a view filter, NOT an address book; `target_device_id` is for notification targeting only, never visibility.
- **Presence** (system spec §4 amended): server-computed `online: bool` on `GET /devices` (device online ⇔ ≥1 open WS in the Hub). Server broadcasts the existing `device_changed` event on presence transitions; the app re-fetches devices on that event (core emits `devices_changed`). A missed event self-corrects on the next devices fetch. No client-side freshness heuristics.
- **Design tokens** (extension spec §7): the token **names** are the cross-client contract; mobile **re-implements them natively (no CSS)** as a typed JS theme object consumed via a `ThemeProvider`/`useTheme()` hook. Neutrals (slate): `bg`, `surface`, `surfaceRaised`, `border`, `text`, `textMuted` (light + dark). Accent (user setting): `accent`, `accentFg`, `accentSoft`, derived at runtime from the chosen color (default amber `#d97706`). **`accentFg` is picked at the WCAG equal-contrast crossover (relative luminance 0.179)** — whichever of dark/white text yields the higher contrast (on amber → dark text, 6.6:1). Semantic: `success` (presence, health), `danger` (revoke, delete); radii + spacing scale. Theme = light/dark system-adaptive (`useColorScheme`) with a manual override.
- **UI per mobile spec §2:** bottom tabs Feed / Devices / Settings. Feed = docked composer (B1) with target chip-row in header; full-message cards capped ~12 lines with "Show more"; swipe right = copy (snap back + "✓ Copied" chip), swipe left = delete (no confirm; "Deleted · Undo" bar; delete syncs everywhere). Share sheet = A2 round tiles: silent-broadcast accented first tile, device tiles with presence dots, tapping a tile IS the send (one tap), last-used target hoisted, auto-dismiss with "Sent ✓". Devices = master→detail (presence, "this device" badge, 14-day stale nudge → rename / status / jump-to-filtered-feed / send test notification / revoke with one-line confirm). Settings = Server (status card, sign out) · Appearance (theme + accent) · Notifications (policy surface) · About. New-items pill on scroll-back; unknown `kind` → graceful fallback card; links open in an in-app browser tab.
- **Auth token** persisted via AsyncStorage (main app) and duplicated into the App Group container so the iOS Share Extension can read it. 401 → one re-auth prompt to onboarding sign-in with server pre-filled — never a retry loop (core's `Outbox` halts on 401 with a single `auth_required`; `SyncEngine` emits `auth_failed`).
- No E2EE claims anywhere (trust model: TLS + own server). Push payloads (Phase 5) are content-free wake pings — clipboard content never transits Apple/Google.
- TDD (superpowers:test-driven-development): failing test first, watch it fail, then implement. Conventional Commits; atomic commits; **PRs ≤ ~600 LOC soft cap** (source and tests counted separately; generated files, lockfiles, and prebuilt native `ios/`+`android/` dirs exempt — CNG keeps them generated, not committed); merge commits only.
- JS commands run from repo root with `npm run <script> --workspace @crossclipper/mobile`; Expo commands from `clients/mobile/` (`npx expo …`).

## Workflow note (Diego's global workflow)

Execute in a git worktree off `main`. Commits are made locally per task as written below. **At each PR checkpoint: STOP, present the diff for Diego's review, and only push + open the PR after sign-off.** Merge with merge commits; monitor CI after opening each PR. PRs are sequential (each branches from the merged result of the previous one). Retarget any stacked child PR to `main` before deleting a merged base branch.

## Phase dependency gate

Phase 4 is fully **downstream** of merged code. Verified state at plan time: Phases 1–2 are merged — `@crossclipper/core` (`ApiClient`, `SyncEngine`, `Outbox`, `ItemCache`, `SyncStorage`, `SocketFactory`/`WsLike`, generated types incl. `Device.online`) and the npm workspace root exist and are consumed by the extension. **No server work is in Phase 4.** Per system spec §10, the APNs/FCM push relay is **Phase 5** — this plan neither adds `/push/register` handling nor any relay endpoint. Everything Phase 4 needs on the wire already shipped (items/devices/WS/presence/`target_device_id`/`/health` identity). If any of that is missing at execution time, STOP and surface it — do not invent server changes.

## Spec ambiguities resolved by this plan

Decisions made where the specs were silent or in tension (flag to Diego at review; each is cheap to change). Load-bearing tooling decisions are called out separately below.

1. **`SyncStorage` is sufficient for mobile; no core change needed.** Core's `SyncStorage` is `{ get, set }` (extension also uses `remove`, added by its adapter). AsyncStorage provides `getItem`/`setItem`/`removeItem` — a 20-line adapter satisfies both. **Core requires no RN-specific changes**: `engine.ts`/`socket.ts`/`api/client.ts`/`cache.ts`/`outbox.ts` import only `ulidx` and use `fetch`/`WebSocket`/`setTimeout`, all of which RN provides as globals. This is verified in Task 2's adapter test (core imports resolve and run under `jest-expo`).
2. **`AlertManager` is ported, not shared from core (yet).** The extension's `AlertManager` lives in `clients/extension` and depends on extension `Prefs`. Rather than lift it into `packages/core` now (YAGNI — desktop/Phase-5 will motivate the shared-alerts extraction), Phase 4 re-implements the **identical policy + ULID-watermark dedup** with an RN sink (`expo-notifications` local + badge). The watermark key (`cc.alert.watermark`), own-origin skip, targeted-always/untargeted-toggle logic, and "targeted elsewhere → silent" branch are copied verbatim in behavior and covered by ported tests. Flagged for a future `packages/core` extraction.
3. **Navigation: `@react-navigation/bottom-tabs` (bare React Navigation), not `expo-router`.** Three static tabs with a master→detail stack under Devices is a fixed, shallow tree; React Navigation is the smaller, better-documented, more testable surface (React Navigation's own testing guide targets it) and avoids file-routing indirection. `expo-router` (file-based) was considered and rejected as over-structured for three screens. Both are Expo-compatible.
4. **Feed cache/persistence mirrors the extension's `FeedStore` pattern**, ported to AsyncStorage (`cc.items`, capped at 1000 newest). Core's `ItemCache` is in-memory; the cursor pull only returns *new* items after a cold start, so the app persists rendered items itself for instant-open + offline render. This is persistence glue, not sync logic — dedup/ordering/tombstones of live data stay in core's `ItemCache`, which the store is rebuilt from on each engine event.
5. **Compose kind detection** matches the extension: a trimmed body that is a single `http(s)://` URL → `kind: "link"`, else `"text"` (reuse core/extension `detectKind` semantics; port the pure function).
6. **Target picker excludes the current device** (self-notify is a no-op) and resets to silent-broadcast after each send (silent-by-default policy). Last-used target is *hoisted* in the share sheet ordering (spec §2) but the *default selection* is still silent broadcast.
7. **iOS Share Extension shares the token via App Group, posts directly, dismisses.** `expo-share-extension` renders a custom React root inside the extension target (bundle id `<app>.ShareExtension`) with App Group access (`group.<bundle>`). On mount it reads the token + device id + cached device list from the App Group container, renders the A2 sheet, POSTs the item on tile tap using core's `ApiClient` (its own instance, its own `fetch`), then calls `close()`. It does **not** use core's `Outbox`/`SyncEngine` (no persistent queue in the extension process) — a single POST with the client-ULID as idempotency key; on failure it surfaces "couldn't send — open app to retry" and hands the payload to the main app via the App Group outbox mirror (`appGroup.pushToMainOutbox(entry)`) where `entry.id` is the **same client ULID** generated for the failed POST. The main app's `Outbox` drains the mirror next foreground using `createItem({id: entry.id, ...})` — reusing the original ULID, never a fresh one — so the server's ULID idempotency (system spec §8) makes the handoff double-send-safe even if the network eventually delivered the extension's POST.
8. **Android share = transparent in-app A2 sheet, not a separate headless target.** The mobile spec §4 says "Android via send intents (headless send)". `expo-share-intent` handles Android by routing the shared payload into the main app; a *separate* headless JS bundle on Android carries the same "second RN bundle" cost the ecosystem explicitly avoids. Resolution: the shared payload deep-links to a **transparent modal route** that renders the identical A2 sheet component and sends through the main app's already-running `Outbox` (or cold-boots it). UX is still one-tap-per-tile with auto-dismiss; it just runs in the app process. **ESCALATED to Diego for explicit UX sign-off (validated-mockup deviation); Task 14 does not execute until resolved.**
9. **Both share mechanisms require a custom dev client / EAS build (no Expo Go).** `expo-share-extension` and `expo-share-intent` are config plugins that add native targets during prebuild (CNG). Development uses `npx expo run:ios` / `run:android` (simulator/emulator dev client). Expo Go is never usable for this app. `ios/` and `android/` are prebuild artifacts, gitignored (`.gitignore` add).
10. **Theme is a typed JS object + `useTheme()` hook**, not CSS. `resolveTheme(setting, systemScheme)`, `accentForeground(hex)` (the 0.179-luminance crossover, port of the extension's `accentForeground`), `accentSoft(hex, alpha)`, and a `tokens(scheme, accent)` builder returning the named token object. Appearance persisted in AsyncStorage; applied via `ThemeProvider` (no pre-paint flash concern — RN has no FOUC, so no `localStorage` mirror is needed, unlike the extension).
11. **"Send test notification"** (Devices → detail) sends a tiny targeted item to that device (a normal targeted `Outbox.send`). Over WS-only it verifies the in-app banner path on the *target* device; it doubles as find-my-device and (Phase 5) a live push-path check. No new endpoint.
12. **CI splits testable-on-Linux from device-gated work.** jest (RNTL) unit/component tests, typecheck, and lint run on `ubuntu-latest` (paths-filtered `clients/mobile/**`) as the required check. iOS simulator builds need a macOS runner + EAS credentials + Apple developer account (not yet available) and are **out of automated CI this phase**; a **scripted manual smoke checklist** (below) is the release gate instead. Maestro/Detox E2E is deferred (mobile spec §6 calls it "a later nicety"; CI device farms are flaky/costly). Decision recorded; revisit when the Apple account lands (Phase 5).
13. **Apple developer account gating.** Everything except (a) real-device runs, (b) TestFlight/App Store distribution, and (c) APNs push (Phase 5) proceeds in the **iOS Simulator** with a free personal signing profile. Tasks that need the account are marked **[needs Apple account]** and are release-time, not implementation-time; no implementation task is blocked by its absence. Android has no equivalent gate (emulator + local APK).
14. **Onboarding reuses the extension's semantics, ported.** Step 1 server probe → `ApiClient.health()` (`{status, app, version, registration_open}`); "not a CrossClipper server" and "server reports registration open → offer create" detection identical to extension. Warn loudly on plain `http://` for non-localhost/non-private hosts. Step 2 sign-in/create (`LoginIn`/`RegisterIn`). Step 3 appearance (theme + accent), skippable. 401 anywhere → one redirect to sign-in with server pre-filled.
15. **`ItemsPage` responses carry only items**; device names for card origins come from the cached device list (unknown origin → "Unknown device"), mirroring the extension.

## Load-bearing tooling decisions (research-backed)

Recorded as numbered decisions with rejected alternatives; chosen minimal and elegant. Research sources are in the final report.

- **D-A. Expo (managed + CNG/prebuild), not bare React Native.** In 2026 Expo is the default even for apps needing native targets: CNG lets you stay in the managed workflow and add any native code via config plugins, with `ios/`/`android/` generated on demand. Both share-sheet libraries we need are Expo config plugins. Bare RN would mean hand-maintaining two native projects and share-extension boilerplate for no benefit. **Rejected:** bare RN (`npx @react-native-community/cli init`) — more native maintenance, no ecosystem win here.
- **D-B. iOS share = `expo-share-extension`; Android share = `expo-share-intent`.** `expo-share-extension` is the only maintained plugin that renders a **custom React view inside the iOS extension** with App Group token sharing and a `close()`/`openHostApp()` API — exactly the spec's A2 "extension posts directly and dismisses" model. `expo-share-intent` **explicitly refuses** iOS custom views (it would need a second full RN bundle) but is the clean path for **Android** send intents. So: `expo-share-intent` with `disableIOS: true` for Android, `expo-share-extension` for iOS. **Rejected:** `expo-share-intent` for iOS (no custom view → can't render A2 in-extension); hand-rolled native extensions (bare RN territory, high maintenance).
- **D-C. `@react-native-async-storage/async-storage` for persistence** (satisfies core's `SyncStorage` with a trivial adapter; ships with Expo; battle-tested). MMKV was considered for speed but adds a native module and buys nothing at our data sizes (cursor, outbox, ≤1000 items). **Rejected:** `react-native-mmkv` (YAGNI perf).
- **D-D. `jest` + `jest-expo` preset + `@testing-library/react-native`**, mocking `react-native-gesture-handler`/`react-native-reanimated` per their jest setups. Matches the project's TDD discipline; runs on Linux CI. Core stays the tested brain (its vitest suite is unchanged). **Rejected:** re-testing sync logic in the app (duplication; core owns it).
- **D-E. WS lifecycle via `AppState`.** RN kills WS on background; the accepted 2026 pattern is `AppState.addEventListener` → connect on `active`, disconnect on `background`/`inactive`, reconnect with jittered backoff — which is precisely core's `ReconnectingSocket` + the one cursor-pull recovery path. Foreground → `engine.start()`; background → `engine.stop()`. No background-timer hacks (Phase 5 push replaces any such need). **Rejected:** keeping WS alive in background (battery drain, unreliable, and contradicts the pull-first design).

## PR sequence (9 PRs)

| PR | Branch | Title (conventional) | Tasks | Est. LOC (src/test) |
|----|--------|----------------------|-------|---------------------|
| 1 | `feat/mobile-scaffold` | `feat(mobile): Expo RN workspace scaffold, jest + CI` | 1 | ~180 / ~70 |
| 2 | `feat/mobile-core-adapters` | `feat(mobile): AsyncStorage + WebSocket adapters over @crossclipper/core` | 2 | ~140 / ~180 |
| 3 | `feat/mobile-theme` | `feat(mobile): native design-token theme engine + provider` | 3 | ~200 / ~160 |
| 4 | `feat/mobile-app-shell` | `feat(mobile): AppState sync controller, tab navigation shell, feed store` | 4–5 | ~320 / ~260 |
| 5 | `feat/mobile-feed` | `feat(mobile): feed cards, swipe copy/delete, docked composer + target picker` | 6–7 | ~430 / ~340 |
| 6 | `feat/mobile-devices-settings` | `feat(mobile): devices master/detail and settings tabs` | 8–9 | ~420 / ~300 |
| 7 | `feat/mobile-onboarding-alerts` | `feat(mobile): onboarding probe/sign-in, 401 flow, notification policy on live items` | 10–11 | ~400 / ~340 |
| 8 | `feat/mobile-ios-share` | `feat(mobile): iOS Share Extension (A2 sheet, App Group token, direct send)` | 12–13 | ~300 / ~150 |
| 9 | `feat/mobile-android-share` | `feat(mobile): Android share intent → in-app A2 sheet` | 14 | ~180 / ~120 |

Est. total ≈ 2570 src / 1920 test across 14 tasks. PRs 5–7 sit near the cap; if a subagent's implementation overruns, split the composer (Task 7) or the alerts wiring (Task 11) into its own follow-up PR.

---

## PR 1 — Expo RN workspace scaffold, jest + CI

**Needs:** npm workspace root + `@crossclipper/core` (merged ✓).

### Task 1: `clients/mobile` Expo scaffold + jest + CI job

**Files:**
- Modify: `package.json` (root — `clients/mobile` is already covered by `clients/*` workspace glob; add nothing unless the glob is absent).
- Create: `clients/mobile/package.json`, `clients/mobile/app.json` (Expo config: name, slug, `scheme: "crossclipper"`, bundleIdentifier `com.crossclipper.app`, package `com.crossclipper.app`, plugins list placeholder), `clients/mobile/tsconfig.json`, `clients/mobile/babel.config.js`, `clients/mobile/metro.config.js` (monorepo-aware: `watchFolders` = repo root, `nodeModulesPaths` include root `node_modules`, resolve `@crossclipper/core` to its `src/index.ts`), `clients/mobile/jest.config.js` (`preset: "jest-expo"`, `transformIgnorePatterns` allowing RN/Expo/`@crossclipper`, `setupFilesAfterEnv`), `clients/mobile/jest.setup.ts` (gesture-handler + reanimated mocks), `clients/mobile/App.tsx` (placeholder root), `clients/mobile/index.ts` (registerRootComponent).
- Create: `clients/mobile/src/__tests__/scaffold.test.tsx`.
- Create: `.github/workflows/mobile.yml`.
- Modify: `.gitignore` (add `clients/mobile/ios/`, `clients/mobile/android/`, `clients/mobile/.expo/`, `clients/mobile/dist/`).

**Interfaces:**
- Consumes: npm workspace root; `@crossclipper/core` (type-only for now).
- Produces: workspace `@crossclipper/mobile` with scripts `start`, `ios`, `android`, `test`, `typecheck`, `lint`, `prebuild`; a jest+RNTL harness with native-module mocks that every later test relies on.

**TDD steps:**
- [ ] **Step 1: Write the failing test.** `clients/mobile/src/__tests__/scaffold.test.tsx`:
  ```tsx
  import { render, screen } from "@testing-library/react-native";
  import App from "../../App";

  describe("app scaffold", () => {
    it("renders the placeholder root", () => {
      render(<App />);
      expect(screen.getByText("CrossClipper")).toBeTruthy();
    });
  });
  ```
- [ ] **Step 2: Watch it fail** — `npm run test --workspace @crossclipper/mobile` fails (no `App`, no jest preset).
- [ ] **Step 3: Implement.** Scaffold Expo app (`App.tsx` renders `<Text>CrossClipper</Text>`), jest config with `jest-expo` preset, `jest.setup.ts`:
  ```ts
  import "react-native-gesture-handler/jestSetup";
  jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
  jest.mock("@react-native-async-storage/async-storage", () =>
    require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
  );
  ```
  Metro `resolver` maps `@crossclipper/core` → `../../packages/core/src/index.ts`; add `unstable_enableSymlinks` if needed for the workspace.
- [ ] **Step 4: Watch it pass.** Add `.github/workflows/mobile.yml` — job `mobile (typecheck + lint + test)`, `runs-on: ubuntu-latest`, `paths: ['clients/mobile/**', 'package.json', 'package-lock.json', '.github/workflows/mobile.yml']`, `concurrency` group, steps: checkout → setup-node lts → `npm ci` → typecheck → lint → test (mirrors `extension.yml` house style; **no build step** — the RN build needs native tooling not on the Linux runner).

---

## PR 2 — Core adapters (AsyncStorage + WebSocket)

**Needs:** `@crossclipper/core` (`SyncStorage`, `SocketFactory`, `WsLike`) merged ✓; PR 1.

### Task 2: RN `SyncStorage` + `SocketFactory` adapters

**Files:**
- Create: `clients/mobile/src/platform/storage.ts`, `clients/mobile/src/platform/socket.ts`.
- Test: `clients/mobile/src/platform/__tests__/storage.test.ts`, `clients/mobile/src/platform/__tests__/socket.test.ts`.

**Interfaces:**
- Consumes: `SyncStorage`, `SocketFactory`, `WsLike` from `@crossclipper/core`; `@react-native-async-storage/async-storage`; RN global `WebSocket`.
- Produces:
  - `class AsyncStorageAdapter implements SyncStorage` with `get(k)→Promise<string|null>`, `set(k,v)`, `remove(k)` (matching the extension adapter's superset).
  - `wsUrl(baseUrl: string, token: string): string` (`http→ws`, `/api/v1/ws?token=`) — identical to the extension's `wsUrl`.
  - `const rnSocketFactory: SocketFactory` — wraps RN `WebSocket` into `WsLike` (`send`/`close`/`onopen`/`onmessage(string)`/`onclose`), exactly like the extension's `browserSocketFactory` (RN's `WebSocket` API is the same shape; `ev.data` → `String(ev.data)`).

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `storage.test.ts`: set→get roundtrips a string; get of a missing key → `null`; remove deletes. Use the AsyncStorage jest mock. `socket.test.ts`: inject a fake `WebSocket` constructor; assert `rnSocketFactory(url)` returns a `WsLike` whose `onopen`/`onmessage`/`onclose` fire when the underlying socket's events fire, that `send` and `close` delegate, and that `onmessage` receives a `string`:
  ```ts
  it("adapts RN WebSocket to WsLike", () => {
    let inst: any;
    class FakeWS { onopen: any; onmessage: any; onclose: any;
      constructor(public url: string) { inst = this; }
      send = jest.fn(); close = jest.fn(); }
    const factory = makeRnSocketFactory(FakeWS as any);
    const like = factory("ws://x/api/v1/ws?token=t");
    const got: unknown[] = [];
    like.onmessage = (d) => got.push(d);
    inst.onmessage({ data: '{"type":"pong"}' });
    expect(got).toEqual(['{"type":"pong"}']);
    like.send("hi"); expect(inst.send).toHaveBeenCalledWith("hi");
  });
  ```
  (Factory takes the `WebSocket` ctor as an injectable default = global, for testability — same pattern as core's injected `fetchFn`.)
- [ ] **Step 2: Watch them fail.**
- [ ] **Step 3: Implement** both adapters; keep them dependency-injectable (ctor arg defaults to the real AsyncStorage / global `WebSocket`).
- [ ] **Step 4: Watch pass.** This task's green run **is** the proof that core resolves and executes under `jest-expo` (decision 1) — no core change required.

---

## PR 3 — Native design-token theme engine

**Needs:** PR 1.

### Task 3: Theme tokens + `accentForeground` crossover + `ThemeProvider`

**Files:**
- Create: `clients/mobile/src/theme/tokens.ts`, `clients/mobile/src/theme/theme.ts`, `clients/mobile/src/theme/ThemeProvider.tsx`.
- Test: `clients/mobile/src/theme/__tests__/theme.test.ts`.

**Interfaces:**
- Produces (names are the cross-client contract, extension spec §7):
  - `type ThemeSetting = "light" | "dark" | "auto"`; `interface Appearance { theme: ThemeSetting; accent: string }`; `DEFAULT_APPEARANCE = { theme: "auto", accent: "#d97706" }`.
  - `interface Tokens { bg; surface; surfaceRaised; border; text; textMuted; accent; accentFg; accentSoft; success; danger; radius: {sm,md,lg}; space: {…} }` (string colors).
  - `resolveTheme(setting, systemScheme): "light" | "dark"`; `hexToRgb(hex): [r,g,b]|null`; `relativeLuminance(rgb): number`; `accentForeground(hex): string` (returns dark or white at the **0.179 luminance crossover / higher-contrast-ratio** rule — verbatim port of the extension's amended logic); `accentSoft(hex, alpha?): string`; `buildTokens(scheme, accent): Tokens`.
  - `ThemeProvider` (reads `Appearance` from AsyncStorage, subscribes to `useColorScheme`, provides `Tokens` + `appearance` + `setAppearance`); `useTheme(): Tokens`; `useAppearance()`.

**TDD steps:**
- [ ] **Step 1: Write failing tests.** Assert: `resolveTheme("auto","dark")==="dark"`; `resolveTheme("light","dark")==="light"`; `accentForeground("#d97706")` returns the dark token (the amber crossover case — same assertion the extension makes: dark text, ~6.6:1, white rejected at 3.2:1); `accentForeground("#1e3a8a")` (dark blue) returns white; `buildTokens("dark", accent).accentFg === accentForeground(accent)`; light vs dark produce different `bg`.
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement** the pure functions (port the extension's `hexToRgb`/luminance/`accentForeground`/`accentSoft` math to return RN color strings) and the provider.
- [ ] **Step 4: Watch pass.**

---

## PR 4 — Sync controller, navigation shell, feed store

**Needs:** PRs 2–3; core `SyncEngine`/`Outbox`/`ItemCache`/`ApiClient`.

### Task 4: `SyncController` — owns core engine + outbox, AppState lifecycle

**Files:**
- Create: `clients/mobile/src/sync/feedStore.ts`, `clients/mobile/src/sync/SyncController.ts`, `clients/mobile/src/sync/useSync.ts` (React hook/context exposing snapshot + actions).
- Test: `clients/mobile/src/sync/__tests__/feedStore.test.ts`, `clients/mobile/src/sync/__tests__/syncController.test.ts`.

**Interfaces:**
- Consumes: `ApiClient`, `SyncEngine`, `Outbox`, `SyncEngineEvent`, `OutboxEvent`, `SyncStatus`, `Item`, `Device` from core; `AsyncStorageAdapter`, `rnSocketFactory`, `wsUrl` (PR 2); RN `AppState`.
- Produces:
  - `class FeedStore` (AsyncStorage `cc.items` + `cc.itemTombstones`, capped 1000 newest, `init()`/`upsert(item)`/`remove(id)`/`list()` — port of extension `FeedStore`). `remove(id)` records a tombstone in `cc.itemTombstones` so a subsequent cursor re-pull cannot resurrect an item the user deleted; on `upsert`, tombstoned ids are silently dropped.
  - `class SyncController` (ctor deps: `storage`, `socketFactory`, `fetchFn?`, `appState?` injectable). Owns one `ApiClient` + `SyncEngine` + `Outbox`. Methods: `wake()` (idempotent boot: load auth, build client/engine/outbox, `engine.start()`, `outbox.flush()`), `sleep()` (`engine.stop()`, `outbox.stop()`), `attachAppState()` (subscribe: `active`→`wake()`, `background`/`inactive`→`sleep()`), `send(kind, body, targetDeviceId?)`, `remove(id)` (calls `ApiClient.deleteItem` + local tombstone), `snapshot()` (`{status, items, devices, pendingIds, failedIds}`), `onChange(cb)`. Wires `engine.onEvent` → update `FeedStore` + emit change; `devices_changed` → refetch `GET /devices`; `auth_failed`/`auth_required` → emit an `authRequired` flag.
  - `useSync()` React context hook consumed by every screen.

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `feedStore.test.ts`: upsert dedups by id, orders by ULID desc, caps at 1000, remove tombstones; upsert of a tombstoned id is silently dropped (re-pull cannot resurrect). `syncController.test.ts` (fake `ApiClient` via injected `fetchFn`, `MemoryStorage`, a controllable fake socket + fake `AppState`):
  - on `wake()` with stored auth → engine starts, snapshot status transitions to `live` after the fake socket opens + a stubbed `GET /items` resolves; items land in the feed.
  - `AppState` → `background` calls `engine.stop()` (status `stopped`); returning to `active` re-pulls (assert `GET /items?cursor=` fired again — the one recovery path).
  - `send()` enqueues via `Outbox`; a `delivered` event upserts the item and clears its pending id.
  - a 401 from the fake server → snapshot `authRequired === true`, no retry loop (assert the fake fetch is not hammered).
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement.** Keep ALL sync semantics in core; `SyncController` is wiring only. `remove(id)` calls `ApiClient.deleteItem(id)` + records a local tombstone in `FeedStore`. `SyncEngineDeps.wsUrl` expects `() => string`; wire it as `wsUrl: () => wsUrl(auth.baseUrl, auth.token)` (the `wsUrl(baseUrl, token): string` helper from PR 2). Other confirmed core API: `ApiClient.listItems(params)`, `ApiClient.createItem({id?, kind, body, target_device_id?})`, `Outbox.send(kind, body, targetDeviceId?)`.
- [ ] **Step 4: Watch pass.**

### Task 5: Bottom-tab navigation shell + empty screens

**Files:**
- Create: `clients/mobile/src/nav/RootNavigator.tsx` (bottom tabs Feed/Devices/Settings; Devices is a native stack: list → detail), `clients/mobile/src/screens/{FeedScreen,DevicesScreen,DeviceDetailScreen,SettingsScreen}.tsx` (skeletons wired to `useSync`/`useTheme`), update `App.tsx` (wrap in `GestureHandlerRootView` → `ThemeProvider` → `SyncProvider` → `NavigationContainer`).
- Test: `clients/mobile/src/nav/__tests__/rootNavigator.test.tsx`.

**Interfaces:** Consumes `useSync`, `useTheme`. Produces the navigable shell; tabs are the spec's three; Devices detail is pushable.

**TDD steps:**
- [ ] **Step 1: Write failing test.** Render `RootNavigator` inside test providers; assert the three tab labels render; pressing "Devices" then a device row navigates to the detail screen (use RNTL `fireEvent.press` + `findByText`).
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement** tabs + stack; screens render themed placeholders reading `useSync().snapshot()`.
- [ ] **Step 4: Watch pass.**

---

## PR 5 — Feed: cards, swipe gestures, composer + target picker

**Needs:** PR 4.

### Task 6: `FeedCard` (full text, Show more, unknown-kind fallback) + swipe row

**Files:**
- Create: `clients/mobile/src/feed/format.ts` (`detectKind`, relative-time, origin-name lookup — port), `clients/mobile/src/feed/FeedCard.tsx`, `clients/mobile/src/feed/SwipeableRow.tsx` (gesture-handler `Swipeable`: right→`onCopy`, left→`onDelete`), `clients/mobile/src/feed/CopiedChip.tsx`, `clients/mobile/src/feed/UndoBar.tsx`.
- Test: `clients/mobile/src/feed/__tests__/{format,feedCard,swipeableRow}.test.tsx`.

**Interfaces:**
- Produces: `FeedCard({ item, originName, expanded, onToggleExpand })` — full body capped ~12 lines with "Show more"/"Show less"; `link` kind → tappable (opens in-app browser via `expo-web-browser`); unknown kind → "Unsupported item — update client" fallback. `SwipeableRow({ onCopy, onDelete, children })` — right-swipe reveals copy affordance and fires `onCopy` (snap back), left-swipe fires `onDelete`. `detectKind(body)` (decision 5).

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `format.test.ts`: `detectKind` link vs text. `feedCard.test.tsx`: >12-line body shows "Show more"; press expands; unknown kind renders the fallback string; `link` body is pressable. `swipeableRow.test.tsx`: simulate right-swipe → `onCopy` called once; left-swipe → `onDelete` called once (drive via the `Swipeable` `onSwipeableOpen(direction)` handler with `fireEvent`).
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch pass.**

### Task 7: `FeedScreen` — list + docked composer + header target chips

**Files:**
- Create: `clients/mobile/src/feed/Composer.tsx` (docked B1: grows to ~4 lines, send button, paste button), `clients/mobile/src/feed/TargetChips.tsx` (header chip-row, default silent broadcast, excludes self), rewrite `clients/mobile/src/screens/FeedScreen.tsx` (FlatList of `SwipeableRow`+`FeedCard`, inverted or new-items pill on scroll-back, copy → `expo-clipboard` + CopiedChip, delete → `SyncController.remove` + UndoBar with restore, empty-feed hint).
- Test: `clients/mobile/src/feed/__tests__/{composer,targetChips}.test.tsx`, `clients/mobile/src/screens/__tests__/feedScreen.test.tsx`.

**Interfaces:** Consumes `useSync`, `useTheme`, `expo-clipboard`, `FeedCard`, `SwipeableRow`, `TargetChips`, `Composer`. `Composer({ onSend })`; `TargetChips({ devices, selfDeviceId, value, onChange })`.

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `targetChips.test.tsx`: self device is excluded; default selection is silent broadcast; selecting a device reports its id via `onChange`. `composer.test.tsx`: typing + send calls `onSend(kind, body, target)` with `detectKind` applied; empties after send. `feedScreen.test.tsx` (with a fake `SyncController`): a swipe-right on a card writes to `expo-clipboard` (mock) and shows "✓ Copied"; swipe-left removes the row optimistically and shows "Deleted · Undo" — but `SyncController.remove` is NOT yet called; pressing Undo within the window cancels the pending delete (item is restored, `remove` is never called — assert `mockRemove` call count is 0); without Undo the ~5s timer fires and `SyncController.remove` is called once; empty snapshot shows the first-use hint.
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement.** Copy path: `Clipboard.setStringAsync`. Delete path: swipe-left starts a ~5s `setTimeout`; the row is removed optimistically from the rendered list while the timer runs. Pressing Undo calls `clearTimeout` on the pending timer — the original item's ULID is untouched and it is restored to the list; `SyncController.remove` is never called. If the timer fires uninterrupted, `SyncController.remove(id)` is called then and the delete syncs everywhere (mobile spec §5 undo semantics).
- [ ] **Step 4: Watch pass.**

---

## PR 6 — Devices + Settings tabs

**Needs:** PR 4.

### Task 8: Devices master/detail

**Files:**
- Create: `clients/mobile/src/devices/DeviceRow.tsx` (presence dot, "this device" badge, 14-day stale nudge), rewrite `DevicesScreen.tsx` (list) + `DeviceDetailScreen.tsx` (rename, status/platform/stats, jump-to-filtered-feed, send test notification, revoke with one-line confirm).
- Test: `clients/mobile/src/devices/__tests__/{deviceRow,devicesScreen,deviceDetail}.test.tsx`.

**Interfaces:** Consumes `useSync` (`devices`, `selfDeviceId`, actions: `renameDevice`, `revokeDevice`, `sendTestNotification` → these call `ApiClient` device endpoints / a targeted `Outbox.send`), `useTheme`. `DeviceRow({ device, isSelf, onPress })`.

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `deviceRow.test.tsx`: online device shows the success-colored dot; self device shows the badge; `last_seen_at` >14 days shows the stale "Revoke?" nudge. `devicesScreen.test.tsx`: renders one row per device; press → navigates to detail. `deviceDetail.test.tsx`: rename submits via the injected action; revoke requires the one-line confirm then calls `revokeDevice`; "send test notification" calls the targeted-send action with that device id; "jump to feed" navigates to Feed filtered to that origin.
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement.** Presence is read from the cached `Device.online`; the list re-renders on `devices_changed` (Task 4 already refetches). Device actions use the confirmed core API: `ApiClient.renameDevice(id, name)`, `ApiClient.revokeDevice(id)`, `ApiClient.listDevices()`; test-notification uses `Outbox.send(kind, body, targetDeviceId?)`.
- [ ] **Step 4: Watch pass.**

### Task 9: Settings tab (Server / Appearance / Notifications / About)

**Files:**
- Create: `clients/mobile/src/settings/{ServerSection,AppearanceSection,NotificationsSection,AboutSection}.tsx`, `clients/mobile/src/settings/prefs.ts` (AsyncStorage `cc.prefs`: `{ notifyOnNewItems: boolean }` default off — port of extension `Prefs`), rewrite `SettingsScreen.tsx`.
- Test: `clients/mobile/src/settings/__tests__/{prefs,notificationsSection,appearanceSection}.test.tsx`.

**Interfaces:** Consumes `useSync` (status, sign out), `useAppearance` (theme + accent), `prefs`. Produces: Server = connection status card + "Sign out" (clears auth, App Group token, returns to onboarding); Appearance = theme toggle + accent swatches (writes `Appearance`); Notifications = the **policy surface** ("When targeted at this device — Always ✓" non-configurable text + "Notify on all new items" toggle, default off); About = version, self-hosting note, no-E2EE honesty.

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `prefs.test.ts`: default `notifyOnNewItems === false`; toggle persists. `notificationsSection.test.tsx`: renders the non-configurable "Always ✓" line; toggling the switch calls `savePrefs`. `appearanceSection.test.tsx`: selecting an accent calls `setAppearance` and the preview uses `accentForeground`.
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch pass.**

---

## PR 7 — Onboarding + notification policy on live items

**Needs:** PRs 4, 6; core `ApiClient.health/login/register`.

### Task 10: Onboarding (server probe → sign-in/create → appearance) + 401 flow

**Files:**
- Create: `clients/mobile/src/onboarding/{ServerStep,SignInStep,AppearanceStep,Onboarding}.tsx`, `clients/mobile/src/onboarding/probe.ts` (`probeServer(baseUrl)` → `ApiClient.health`, classify: not-a-crossclipper / ok / registration-open; `http://` warning for non-local hosts).
- Modify: `App.tsx` / a root gate — render `Onboarding` when unauthed or `authRequired`.
- Test: `clients/mobile/src/onboarding/__tests__/{probe,serverStep,signInStep,onboardingGate}.test.tsx`.

**Interfaces:** Consumes `ApiClient`, `useSync` (auth actions: `signIn`, `register` — persist token to AsyncStorage **and** App Group), `useAppearance`. Mirrors the extension's `Onboarding`/`ServerStep`/`SignInStep`/`AppearanceStep` semantics (decision 14). On login, `platform: "ios" | "android"` from `Platform.OS`, `device_name` from `expo-device`.

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `probe.test.ts` (fake fetch): CrossClipper health → ok+version; non-JSON/foreign → "not a CrossClipper server"; `registration_open:true` → offer create; plain `http://example.com` → warning, `http://localhost` → no warning. `serverStep.test.tsx`: invalid → error, valid → advances with the probe result. `signInStep.test.tsx`: submits `LoginIn` with the right `platform`; on success stores auth and advances. `onboardingGate.test.tsx`: unauthed snapshot → onboarding renders; `authRequired` → onboarding at sign-in with server pre-filled (assert no retry loop).
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch pass.**

### Task 11: `AlertManager` (notification policy) wired to live items

**Files:**
- Create: `clients/mobile/src/alerts/AlertManager.ts` (port of extension `AlertManager`: watermark dedup, own-origin skip, targeted-always / untargeted-toggle / targeted-elsewhere-silent), `clients/mobile/src/alerts/notifications.ts` (RN sink over `expo-notifications`: request permission, present a local banner; badge count).
- Modify: `SyncController` — call `AlertManager.onItem(item)` for each new engine `item` event (behind an injected sink so tests stay pure).
- Test: `clients/mobile/src/alerts/__tests__/alertManager.test.ts`.

**Interfaces:**
- `class AlertManager` deps: `storage`, `notifications: { present(opts) }`, `getPrefs()`, `getSelfDeviceId()`. Method `onItem(item)`. Constants `WATERMARK_KEY = "cc.alert.watermark"`. Same branch logic as the extension: `id <= watermark` → skip; own-origin → skip; targeted-at-me → always present; targeted-elsewhere → silent; untargeted → present only if `notifyOnNewItems`.

**TDD steps:**
- [ ] **Step 1: Write failing tests** (port the extension's `alerts.test.ts` verbatim in behavior against a fake notification sink + `MemoryStorage`):
  - item with `id <= watermark` → no present, no watermark move backward.
  - own-origin item → no present.
  - targeted-at-me → present, regardless of `notifyOnNewItems: false`.
  - targeted-elsewhere → no present (silent).
  - untargeted + `notifyOnNewItems: false` → no present; `true` → present.
  - re-delivering the same item after a cursor re-pull → presents exactly once (watermark).
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement** `AlertManager` + the `expo-notifications` sink (permission request on first foreground; local `scheduleNotificationAsync` for banners this phase — no remote push).
- [ ] **Step 4: Watch pass.**

---

## PR 8 — iOS Share Extension

**Needs:** PRs 2–4, 7 (auth + App Group token, `ApiClient`, theme). **Simulator-developable; [needs Apple account] only for device/TestFlight.**

### Task 12: `expo-share-extension` config plugin + App Group token bridge

**Files:**
- Modify: `clients/mobile/app.json` (add `expo-share-extension` plugin, App Group `group.com.crossclipper.app`, iOS entitlements; add `expo-share-intent` with `disableIOS: true` here too so Android config coexists — see PR 9), `clients/mobile/package.json` (deps).
- Create: `clients/mobile/src/platform/appGroup.ts` (read/write token + device id + cached device list + an outbound-outbox mirror in the App Group container via the plugin's shared-container API).
- Modify: `SyncController`/auth actions to **also** persist the token bundle into the App Group on sign-in and clear it on sign-out.
- Test: `clients/mobile/src/platform/__tests__/appGroup.test.ts`.

**Interfaces:** `appGroup.readAuth()`, `appGroup.writeAuth(bundle)`, `appGroup.clearAuth()`, `appGroup.pushToMainOutbox(entry)` (mirror for failed extension sends). Behind an injectable native shim so jest tests stay pure.

**TDD steps:**
- [ ] **Step 1: Write failing test.** `appGroup.test.ts` (fake native shim): `writeAuth`→`readAuth` roundtrips the bundle; `clearAuth` empties it; `pushToMainOutbox` appends an entry the main app can drain.
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement** the JS wrapper over `expo-share-extension`'s shared-container API; wire auth persistence.
- [ ] **Step 4: Watch pass.** (Native prebuild + simulator verification is in the manual smoke checklist, not jest.)

### Task 13: Share-extension A2 sheet root (custom view, direct send, dismiss)

**Files:**
- Create: `clients/mobile/index.share.tsx` (the extension's registered root, per `expo-share-extension`), `clients/mobile/src/share/ShareSheet.tsx` (the A2 tile row — silent-broadcast accented first tile, device tiles with presence dots, last-used hoisted, tap = send + "Sent ✓" + auto-dismiss), `clients/mobile/src/share/sendDirect.ts` (build `ApiClient` from App Group token, single POST with client-ULID, on failure → `appGroup.pushToMainOutbox` + "open app to retry").
- Modify: `app.json` to point the extension entry at `index.share.tsx`.
- Test: `clients/mobile/src/share/__tests__/{shareSheet,sendDirect}.test.tsx`.

**Interfaces:** `ShareSheet({ shared: { kind, body }, devices, selfDeviceId, onSent, onError })`. `sendDirect(baseUrl, token, item)`.

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `shareSheet.test.tsx`: first tile is silent broadcast (accented, no `target_device_id`); tapping a device tile sends with that `target_device_id`; self excluded; on success shows "Sent ✓". `sendDirect.test.tsx` (fake fetch): success → resolves with the created item; a network error → calls the `pushToMainOutbox` fallback and surfaces the retry hint; the client-ULID is the idempotency key (`id` in the POST body); **critically, assert that the ULID passed to `pushToMainOutbox(entry)` equals the `id` that was sent in the failed POST body** — this verifies the handoff reuses the original ULID so the main app's `createItem({id: entry.id, ...})` call is double-send-safe via server ULID idempotency (system spec §8).
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement.** Reuse core's `ApiClient` (its own instance, `fetch` global). No `SyncEngine`/`Outbox` in the extension process (decision 7). Generate the client ULID once before the POST; pass it as `id` in `createItem({id, ...})`; on failure pass the same `id` in the outbox mirror entry.
- [ ] **Step 4: Watch pass.**

---

## PR 9 — Android share intent → in-app A2 sheet

**Needs:** PR 8 (shares `ShareSheet`); `expo-share-intent`.

### Task 14: Android share-intent route → transparent A2 sheet in-app

**Files:**
- Modify: `clients/mobile/app.json` (`expo-share-intent` `androidIntentFilters: ["text/*"]` + URL scheme already set in PR 1; `disableIOS: true`), `clients/mobile/package.json`.
- Create: `clients/mobile/src/share/useShareIntent.ts` (hook over `expo-share-intent` — receive shared text/URL when Android launches the app via a send intent), `clients/mobile/src/share/AndroidShareModal.tsx` (transparent modal route rendering `ShareSheet`, sending through the **main app's** `SyncController.send`, auto-dismiss).
- Modify: `RootNavigator` — register the transparent modal; open it when a share intent is present on launch/foreground.
- Test: `clients/mobile/src/share/__tests__/{useShareIntent,androidShareModal}.test.tsx`.

**Interfaces:** `useShareIntent(): { shared: {kind, body} | null, reset() }`. `AndroidShareModal` consumes `useSync().send`, `ShareSheet`.

**TDD steps:**
- [ ] **Step 1: Write failing tests.** `useShareIntent.test.tsx` (fake `expo-share-intent`): a text share yields `{kind:"text", body}`; a URL yields `{kind:"link"}` via `detectKind`; `reset()` clears. `androidShareModal.test.tsx`: renders `ShareSheet` with the shared payload; tapping a tile calls `SyncController.send` with the right target; then dismisses.
- [ ] **Step 2: Watch fail.**
- [ ] **Step 3: Implement** per decision 8 (in-app, not a separate headless bundle).
- [ ] **Step 4: Watch pass.**

---

## Manual smoke checklist (release gate — replaces device CI this phase)

Run once per platform per release build (mobile spec §6; decision 12). Simulator/emulator is sufficient for all of it except the two **[needs Apple account]** device-only items.

**iOS Simulator (free signing) + Android emulator:**
1. Onboarding: enter server URL → probe shows version; sign in; land on Feed.
2. Foreground sync: item sent from another device (extension) appears live; background the app, send another from the extension, foreground → it catches up via cursor pull.
3. Compose: type text → send → appears; paste → send. Target a chip → the *target* device (extension) banners; others silent.
4. Feed gestures: swipe right on a card → "✓ Copied" (paste elsewhere confirms clipboard); swipe left → "Deleted · Undo"; Undo restores; without Undo the delete syncs to the extension.
5. Devices: presence dot flips when the extension connects/disconnects; rename; send test notification → this device banners; revoke a device (confirm).
6. Settings: toggle "Notify on all new items" → untagged items now banner; theme + accent change applies live; sign out returns to onboarding.
7. Android share: share text from another app → in-app A2 sheet → tap a tile → "Sent ✓" → appears in Feed.
8. iOS share: share text from Safari → the extension's A2 sheet → tap a tile → "Sent ✓", the main app is NOT launched → open app, item is in the Feed.

**[needs Apple account] (release-time, not implementation):**
9. Real-device run + TestFlight internal distribution.
10. (Deferred to Phase 5) APNs push wake path.

---

## Coverage self-review (performed while writing)

- **Mobile spec §1 (summary / architecture):** thin client, core owns sync → global constraints + Task 2/4; UI + platform glue split enforced throughout.
- **Mobile spec §2 (validated UI):** bottom tabs → Task 5; docked composer B1 → Task 7; full-text cards + Show more + no buttons → Task 6; swipe right=copy / left=delete + Undo → Tasks 6–7; A2 share sheet (tiles, presence dots, tap=send, last-used hoist, auto-dismiss) → Tasks 13 (iOS) + 14 (Android); devices master→detail (presence, this-device badge, 14-day nudge, rename/stats/jump/test-notif/revoke) → Task 8; settings sections → Task 9; Android COPY notification action → **Phase 5** (needs the notification-action + broadcast-receiver path that lands with push; foreground banner ships now).
- **Mobile spec §3 (notification policy surface):** target picker default silent → Tasks 7/13/14; incoming targeted-always / untargeted-toggle / own-never → Task 11; "Always ✓" non-configurable text → Task 9; test notification → Task 8/11.
- **Mobile spec §4 (platform mechanics):** iOS Share Extension (custom view, App Group token, direct post, no app launch) → Tasks 12–13; Android send intents → Task 14; clipboard foreground write/paste-only → Tasks 7/6 (no passive watch anywhere); sync lifecycle (foreground reconnect+pull, background stop, persisted cache+outbox) → Tasks 2/4; new-items pill / unknown-kind fallback / in-app link browser → Tasks 6–7.
- **Mobile spec §5 (design language inherited):** native token re-implementation with the §7 names + amended `accentFg` crossover → Task 3.
- **Mobile spec §6 (testing):** jest + RNTL component tests (feed card, swipe wiring, share tiles → payload, devices master/detail, settings toggles) → Tasks 3–14; core not re-tested; manual smoke per release → checklist above; Detox/Maestro deferred (decision 12).
- **Mobile spec §7 (out of scope):** APNs/FCM push, media rendering/attach, Android UnifiedPush, tablet layouts, app-store submission → all excluded here; push explicitly Phase 5 (dependency gate) and needs the Apple account.
- **System spec §4 (protocol):** pull-from-cursor one-recovery-path → Task 4; presence computed `online` + `device_changed` nudge→refetch → Tasks 4/8; notification policy → Task 11; push-as-content-free-wake-ping → deferred to Phase 5.
- **System spec §8 (error spine):** offline-first outbox + ULID idempotency (core) → Tasks 4/13; reconnect discipline (core) → Tasks 2/4; single 401 re-auth, no retry loop → Tasks 4/10; structured `{code,message}` errors surfaced (unknown kind, oversized, revoked) → rendered by the feed/compose glue.
- **Type-consistency check:** `SyncStorage`/`SocketFactory`/`WsLike`/`ApiClient`/`SyncEngine`/`Outbox`/`Item`/`Device` come straight from `@crossclipper/core` and are used identically in Tasks 2/4/8/11/13; storage keys `cc.cursor`/`cc.outbox` (core), `cc.items`/`cc.itemTombstones`/`cc.alert.watermark`/`cc.prefs` (mobile, matching extension names — `cc.itemTombstones` ensures re-pulls cannot resurrect deleted items, mirroring the extension's semantics); `Appearance`/`ThemeSetting`/`accentForeground` token names match extension spec §7.
- **Explicit exclusions (deliberate, not gaps):** no server work (Phase 4 is client-only; push relay is Phase 5); no `packages/core` change (decision 1 — adapters live in `clients/mobile`; `AlertManager` ported not lifted, decision 2); no media/attach; no App Store/TestFlight automation; no Detox/Maestro E2E; iOS-simulator/EAS builds outside automated CI (decision 12); Android notification COPY action deferred to Phase 5 with push.
- **Known trade-offs (deliberate):** `AlertManager` duplicated from the extension until a shared-alerts extraction is motivated (decision 2); Android "headless send" reinterpreted as an in-app transparent sheet (decision 8); AsyncStorage over MMKV (decision C); the iOS extension does single-POST (no persistent outbox) with a main-app outbox mirror as the failure path (decision 7).
