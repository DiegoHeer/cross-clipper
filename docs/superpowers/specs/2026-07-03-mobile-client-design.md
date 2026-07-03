# CrossClipper — Mobile Client Design (iOS + Android)

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation
**Parent spec:** [2026-07-03-cross-clipper-design.md](2026-07-03-cross-clipper-design.md) (§6; notification policy §4 as amended 2026-07-03)
**Sibling specs:** [extension](2026-07-03-extension-client-design.md) (design language §2/§7 inherited), [desktop](2026-07-03-desktop-client-design.md)
**Scope:** Phase 4 of the build order — React Native app for iOS + Android. Push delivery (APNs/FCM) is phase 5; this app ships WS-only first.

## 1. Summary

A React Native app whose primary *send* path is the OS share sheet and whose primary in-app job is reading and copying the feed. Bottom-tab navigation (Feed / Devices / Settings), full-text feed cards with swipe gestures, and an AirDrop-style share sheet implementing the notification-targeting policy. All sync logic comes from `@crossclipper/core`; the app is UI + platform glue (share extension, clipboard, notifications), per the parent architecture.

## 2. Validated UI decisions

| Decision | Choice | Rejected alternatives |
|---|---|---|
| App structure | **Bottom tabs: Feed / Devices / Settings** | Single feed screen with ⚙; device-list home (messaging-style) |
| Compose | **B1 — docked composer** on the Feed tab (chips move to header) | FAB → bottom sheet; dedicated Send tab |
| Feed cards | **Full message text**, capped at ~12 lines with "Show more" expander; no buttons on cards | Truncated cards with buttons |
| Card actions | **Swipe right = copy** (snap back + "✓ Copied" chip); **swipe left = delete** (no confirm; brief "Deleted · Undo" bar — delete syncs everywhere) | Always-visible action buttons |
| Share sheet | **A2 — AirDrop-style round tiles**: silent-broadcast as accented first tile, device tiles with presence dots; **tapping a tile IS the send** (one tap); last-used target hoisted; auto-dismiss with "Sent ✓" | Confirm sheet with Send button; full compose screen; big-button/list layouts |
| Devices tab | **Master → detail**: list (presence, "this device" badge, 14-day stale nudge) → per-device page (rename, status/platform/stats, jump-to-filtered-feed, send test notification, revoke with one-line confirm) | Tabs; single page |
| Settings tab | Sections: Server (status card, sign out) · Appearance (theme + accent) · Notifications (policy surface) · About | — |
| Notifications | **Android:** banner with direct **COPY** action (clipboard set from the notification, app never opens) + OPEN APP. **iOS:** banner; tap → app opens on the item with **copy-on-open**; long-press Copy action where iOS allows | — |

Design language (slate chassis, system-adaptive light/dark, user accent defaulting to amber, token names from extension spec §7) and the 3-step onboarding (Server → Sign in → Appearance) are inherited as-is.

## 3. Notification policy surface

Per parent spec §4 (amended): visibility is always broadcast; alerting follows targeting.

- **Share sheet / composer target picker:** the A2 tile row (sheet) and its chip-row form (above the docked composer) both default to silent broadcast. Selecting a device makes it the item's `target_device_id`.
- **Incoming:** this device raises a notification when it is the item's target (always), or for any item when Settings → Notifications → "Notify on all new items" is on (default off). The Settings tab shows "When targeted at this device — Always ✓" as non-configurable text, making the policy legible.
- **Test notification** (Devices → detail) sends a tiny targeted item to that device — doubles as find-my-device and a live check of the (phase-5) push path; over WS-only it verifies the in-app banner path.

## 4. Platform mechanics

- **Share extension:** Android via send intents (headless send — true one-tap A2 sheet as the intent target UI). iOS via a Share Extension presenting the same A2 sheet; the extension posts directly to the server (its own token-sharing via App Group) and dismisses — it does not launch the main app.
- **Clipboard:** copy actions use the OS clipboard API in foreground contexts; Android's notification COPY uses a broadcast receiver (allowed background clipboard *write*). No clipboard reading beyond an explicit "paste" press (parent spec non-goals).
- **Sync lifecycle:** single core sync engine in the app runtime; on foreground → reconnect WS + pull from cursor (the parent's one recovery path). Backgrounded → nothing until push (phase 5) or next open. Item cache + outbox persisted (AsyncStorage/MMKV) so the feed renders instantly on open and offline sends deliver later.
- **Feed UX details:** new-items pill on scroll-back (as extension); unknown `kind` → graceful fallback card; links open in-app browser tab on tap.

## 5. Error & edge states

Inherits extension spec §8 (reconnect banner, 401 → re-onboard, empty feed, unsent retry, version skew), plus:

- **Share while offline:** extension/share sheet queues via outbox; the "Sent ✓" flash becomes "Queued — will sync"; item appears in feed as pending on next app open.
- **Swipe-delete undo** window (~5s) before the tombstone POST fires; after that, deletion is cross-device and final.
- **iOS share extension cannot reach the server** (no connectivity): item persisted to the shared outbox; main app flushes on next open.

## 6. Testing

- Component tests (vitest + RN testing library): feed card (full-text cap/expander, swipe action wiring), share-sheet tile row (target selection → payload), devices master/detail, settings toggles.
- Core sync/outbox behavior is already covered in `packages/core` — not re-tested here.
- One happy-path manual smoke per platform release (share → feed → swipe-copy → swipe-delete-undo; notification paths once push lands). Detox E2E is a later nicety.

## 7. Out of scope (this phase)

- APNs/FCM background push — phase 5 (this app ships WS-only; notification *policy* logic still applies to in-app/foreground banners).
- Media rendering/attach — media phase (protocol slots exist; attach button appears then).
- Android UnifiedPush option — phase 5.
- Tablet/iPad layouts; wearables; app-store submission mechanics (handled at phase release; needs the Apple developer account for TestFlight).
