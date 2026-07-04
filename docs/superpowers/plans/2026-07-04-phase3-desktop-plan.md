# CrossClipper Phase 3 — Windows Desktop Client (Tauri + React) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 24/7 tray-resident Windows desktop app — Tauri v2 shell (global hotkey, tray, clipboard read/write, notifications, autostart, single-instance) around a React webview that reuses `@crossclipper/core` exactly as the extension does. Three surfaces: a **quick flyout**, a **full window** (feed / devices / settings), and a **capture toast** with 5s Undo. Its defining feature is deliberate, hotkey-triggered capture (Ctrl+Alt+C) — one keystroke syncs the clipboard to every device. There is no passive clipboard watching.

**Architecture:** The desktop app is deliberately thin, mirroring the extension's topology. Exactly **one** `@crossclipper/core` sync-engine instance lives in a **hidden always-running background window** (the `background` webview). The flyout and main windows are pure renderers fed over Tauri events (the mirror of extension popup ↔ service worker: `BackgroundController` + `WorkerEvent`/`PopupRequest` messaging survives here as a Tauri-events transport). The Rust shell does OS integration only and pushes captured clipboard text into the background webview as an event payload; all protocol logic stays in TS/core. Because the background window is never killed the way MV3 workers are, the WS stays genuinely live — desktop is the most real-time client.

**Tech Stack:** Tauri v2.11.x (Rust) · React 18.3 + TypeScript 5.5 · Vite 5 · vitest 4 + @testing-library/react (jsdom) · `@crossclipper/core` (Phase 1) · Rust `cargo test` for glue logic · GitHub Actions (ubuntu typecheck+test+cargo-test, `windows-latest` bundle build). Tauri plugins: `global-shortcut` 2.3.x, `notification` 2.3.x, `autostart` 2.5.x, `single-instance` 2.4.x (tray is **core**, `tray-icon` feature; updater deliberately deferred).

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the specs.

- **The desktop app consumes `@crossclipper/core`, never reimplements sync logic** (system spec §2 principle 2; desktop spec §5). Sync state machine, reconnect/backoff, cursor, outbox, dedup all come from core. Desktop code is UI + platform glue (global hotkey, tray, clipboard read on capture / write on copy, notifications, autostart, single-instance, window management) only. **Resist adding sync logic to the client.**
- Sync source of truth is always `GET /items?cursor=` (core's `SyncEngine`); WS is a nudge channel. Never add desktop state that depends on not missing a WS event. One recovery path (`start()` → pull from persisted cursor) covers cold start, reconnect, and hotkey-wake.
- **No passive clipboard watching on ANY platform** (system spec §1 non-goals, amended; desktop spec §2/§4). Capture is ONLY the deliberate global hotkey or manual paste/drag into the UI. There is no `clipboard-changed` listener anywhere in the Rust shell.
- **Capture pipeline** (desktop spec §4): on Ctrl+Alt+C — read clipboard (Rust), **sensitive-content guard** (Windows `ExcludeClipboardContentFromMonitoringProcessing` format → "not captured — marked sensitive" toast, stop, not configurable), text → normalize (trim trailing whitespace) + classify text/link + 256 KB client-side cap → core outbox (**always untargeted** on the speed path) → toast with 5s Undo on ack / "queued — offline" when not yet delivered; non-text clipboard → "images & files come in a later version" toast; empty → "clipboard is empty" toast.
- **Notification policy** (system spec §4; desktop spec §6): targeted item → the target device notifies **always**, regardless of local toggle. Untargeted → silent everywhere by default; per-device local **"notify me on new items"** toggle (default **off**). Own items (`origin_device_id === selfDeviceId`) → **never** notify. Mirror the extension's `AlertManager` semantics, including a **persisted ULID watermark** (`cc.alert.watermark`) so re-pulls never re-notify and closed-app targeted items notify exactly once.
- **Presence is server truth** (system spec §4 amended): `GET /devices` carries `online: boolean`; the server broadcasts `device_changed` on presence transitions. Clients re-fetch the device list on `device_changed`. **Never derive presence from `last_seen_at` client-side.** `last_seen_at` is display-only ("last seen …") for offline devices. **Event-name note:** the wire event from the server is `device_changed`; core's `SyncEngine` surfaces it to consumers as `devices_changed`. The `BackgroundController` handles `devices_changed` — do not "fix" the name at implementation time.
- **Push payloads are content-free** (system spec §4). Not exercised this phase (no APNs/FCM on desktop), but any future wake-ping must never carry clipboard content. Desktop notifications are raised locally from synced item data — clipboard content never transits a third party.
- **Design tokens** (extension spec §7 — the cross-client contract): token **names** are binding and reused verbatim — `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`; `--accent`, `--accent-fg`, `--accent-soft` (default amber `#d97706`); `--success`, `--danger`; `--radius-sm/-md`; `--space-1..5`; `--font-ui`. Slate neutral chassis, system-adaptive light/dark, user-selectable accent. **Amended `--accent-fg` rule (2026-07-04):** picked at the WCAG equal-contrast crossover (relative luminance **0.179**) — whichever of dark/white text yields the higher contrast; default amber therefore uses **dark** text (`#1c1917`, 6.6:1), not white.
- No E2EE claims anywhere. Media (image/file) drop-zone ships **visibly disabled** ("(media phase)") — no upload logic.
- TDD (superpowers:test-driven-development): failing test first, watch it fail, then implement. Conventional Commits; atomic commits; **PRs ≤ ~600 LOC soft cap** (source and tests counted separately; generated files and lockfiles exempt); merge commits only.
- JS commands from repo root: `npm run <script> --workspace @crossclipper/desktop`. Rust commands from `clients/desktop/src-tauri/` with `cargo test` / `cargo fmt` / `cargo clippy`.

## Workflow note (Diego's global workflow)

Execute in a git worktree off `main`. Commits are made locally per task as written below. **At each PR checkpoint: STOP, present the diff for Diego's review, and only push + open the PR after sign-off.** Merge with merge commits; monitor CI after opening each PR. PRs are **independent** wherever possible (see the sequencing note) — each branches from `main`, not from the previous PR, so a stall on one does not block the others.

## Dependency gate

Phase 3 depends only on fully-merged Phase 1 + Phase 2 artifacts (all on `main` at plan time): `@crossclipper/core` with `ApiClient.health()`, `SyncEngine`, `Outbox.send(kind, body, targetDeviceId?)`, `SyncStorage`, `MemoryStorage`, and the `Device.online` / `HealthOut` types. No Rust exists in the repo yet; no `packages/ui` exists (tokens still live in `clients/extension/src/theme/` — this plan re-implements the token **names** in `clients/desktop`, per spec §5's "extraction to `packages/ui` when built" deferral).

## Sequencing note (independent PRs preferred)

PRs 1–8 are ordered by natural build-up but are **not stacked** — each is designed to branch from `main`:

- PR 1 (scaffold + tokens) is the only hard prerequisite for the webview PRs (3, 4, 5, 6, 7).
- PR 2 (Rust shell: tray/hotkey/clipboard/single-instance) touches only `src-tauri/` and depends only on PR 1's scaffold.
- PRs 3–7 touch only `clients/desktop/src/` (webview) and stack conceptually but each is self-contained if authored after PR 1 lands. If executed truly in parallel, retarget-before-merge is unnecessary because they share no files across PR boundaries except `App.tsx`/`main.tsx` (which each PR fully owns for its slice — see the file-ownership table). Prefer landing PR 1 first, then 2 and 3 in parallel, then 4–8 in order.
- PR 8 (CI + packaging) can land any time after PR 1 but is most useful once PR 2 exists (it builds the Rust bundle).

**File ownership across the webview PRs** (prevents merge collisions if parallelized): `main.tsx` created final in PR 3; `App.tsx` created final in PR 5 (routes) and only appended to in PR 6/7 via new route branches; `theme/` owned by PR 1; `shared/` owned by PR 3; `background/` (controller/bridge) owned by PR 4; `flyout/` owned by PR 5; `main/` (full window) owned by PR 6; onboarding+settings owned by PR 7.

## Spec ambiguities resolved by this plan

Decisions made where the specs were silent or in tension. **[LB]** marks load-bearing choices (flag to Diego at review; each is cheap to change). Rejected alternatives given where the decision was non-obvious.

1. **[LB] Transport between the background webview and the flyout/main webviews = Tauri events, wrapping the extension's exact `WorkerEvent`/`PopupRequest` message contract.** The extension already defines `StateSnapshot`, `PopupRequest`, `WorkerEvent`, `PendingSend` and the `BackgroundController` reducer/broadcast pattern. We reuse those types **verbatim** (copied into `clients/desktop/src/shared/messages.ts`), swapping the browser `runtime.connect(port)` transport for Tauri's `emit`/`listen`. A renderer emits a `PopupRequest` on the `cc:req` event and awaits a correlated reply; the background emits `WorkerEvent`s on the `cc:evt` event that all renderers `listen` to. Rejected: a Rust-side sync engine (violates "core owns sync"); `invoke` commands into Rust that proxy to a Node process (no Node at runtime — core runs in the webview). Rejected: `localStorage`/`BroadcastChannel` between windows (Tauri webviews are isolated origins per label; not reliable cross-window).
2. **[LB] Persistence uses a Tauri store file, exposed to core as `SyncStorage`.** Core needs `get(key)`/`set(key)` returning strings. We back it with `@tauri-apps/plugin-store` (a JSON k/v file under the app-data dir) via a `TauriStorage implements SyncStorage` adapter. `SyncStorage` has **no `remove`** (confirmed in core) — sign-out clears keys by writing `""`/`"[]"` exactly as the extension controller does. Rejected: raw `fs` writes (no atomic k/v semantics); `localStorage` (per-window, not shared with the background window reliably, size-capped).
3. **[LB] The capture hotkey path never opens a picker** (desktop spec §4 step 3: "Hotkey captures are always untargeted"). Rust reads the clipboard, runs the sensitive-format guard, and emits `cc:capture { text }` to the background webview; the background calls `outbox.send(kind, body)` (no target) and emits a `cc:capture-result` back to Rust so Rust can raise the correct toast. The toast lives in a **dedicated `toast` webview** (bottom-right, undecorated, always-on-top) — not a native notification — because it needs an interactive Undo button and a 5s countdown (desktop spec §3). Rejected: native OS notification for the capture toast (no reliable inline action button + countdown on Windows toasts).
4. **Undo semantics** (desktop spec §3/§6): Undo of an **acked** capture calls `DELETE /items/{id}` (standard tombstone; disappears everywhere). Undo of a **queued (unsent)** capture cancels it locally with no server round-trip. The background tracks the outbox id → item id mapping to route Undo to the right path.
5. **[LB] Sensitive-content guard is Rust-side, behind a trait** (desktop spec §7 "the Windows API is mockable"). `trait ClipboardReader { fn read(&self) -> ClipboardRead }` where `ClipboardRead = Empty | Sensitive | Text(String) | Unsupported`. The Windows implementation checks for the `ExcludeClipboardContentFromMonitoringProcessing` clipboard format before reading text. A `FakeClipboard` drives `cargo test` for the classification/guard logic. Text classification (text vs link, trailing-whitespace trim, 256 KB cap) is done in **TS** (reuse core/extension `detectKind` logic) — Rust only distinguishes empty/sensitive/text/unsupported. Rejected: doing text classification in Rust (duplicates TS logic; the 256 KB cap and link detection already have a home in the webview).
6. **Default hotkeys and pause** (desktop spec §2/§3): capture `Ctrl+Alt+C`, flyout `Ctrl+Alt+V`, both configurable. "Pause 1 hour" (tray) and "Capture hotkey enabled ✓" toggle both call `global_shortcut().unregister(...)` / `register(...)`; pause sets a Rust timer that re-registers after the interval and updates the tray icon. Hotkey bindings persist in the Tauri store under `cc.hotkeys`.
7. **[LB] Hotkey-conflict handling** (desktop spec §6): the global-shortcut plugin has **no conflict-detection API** (confirmed 2026) — `register()` fails or no-ops when the combo is owned by another app. We treat a failed `register()` as "combo taken" and raise a non-blocking notification linking to Settings → Capture to rebind. Rejected: pre-flight "is this combo free" probe (no such API exists).
8. **Launch at login defaults ON** (desktop spec §5). The autostart plugin has no install-time "default on" flag (confirmed) — the background webview calls `autostart.enable()` **once on first successful onboarding**, guarded by a `cc.autostartInitialized` store flag, and Settings → Capture toggles it thereafter. Autostart launches with a `--minimized` arg so the app starts into the tray without showing a window.
9. **Windows packaging = NSIS + MSI, `downloadBootstrapper` WebView2 mode** (the Tauri v2 default). Win10 (Apr-2018+)/Win11 ship WebView2 in-OS, so the +0 MB download bootstrapper is correct for a modern-Windows target. MVP ships **unsigned** (SmartScreen warning documented in the README); code signing is orthogonal and addable later via `certificateThumbprint`/`signCommand` with no code change. Rejected: `fixedVersion` runtime (+180 MB, unnecessary for Win10/11); MSI-only (WiX v3 is per-machine/admin; NSIS gives current-user install).
10. **Updater deferred** (desktop spec §8 "signed GitHub-Releases installer" — installer, not auto-update). `tauri-plugin-updater` is omitted entirely for MVP; it is opt-in and addable without architectural change. Recorded so the choice is explicit.
11. **[LB] E2E is a webview-component-tests + `windows-latest` build-smoke + scripted manual checklist, NOT a WebDriver suite in CI.** WebDriver for Tauri (`@wdio/tauri-service` / `tauri-driver`) is viable on Windows runners in 2026, but it is slower and flakier than component tests and cannot drive the load-bearing native paths (global-hotkey capture while another app is focused, real Windows toasts, autostart registry). Per desktop spec §7 ("`tauri-driver` E2E is a later nicety") we deliberately do **not** stand up flaky WebDriver CI this phase. CI proves: vitest (webview logic), `cargo test` (Rust glue), and a `windows-latest` job that *builds the bundle* (proving it compiles and packages). A **scripted manual smoke checklist** (Task 18) is the release gate for native behavior. Rejected: WebDriver E2E in CI now (spec explicitly defers it; would be the flaky-CI antipattern the constraints forbid).
12. **Single background window is created at startup and never shown**; `skipTaskbar: true`, `visible: false`. It is the app's lifecycle owner: closing the main/flyout windows hides them (app keeps running); the tray "Quit" is the only exit. Rejected: running core inside the main window (main window close would kill sync).
13. **Window close = hide** (desktop spec §3): main and flyout `WindowEvent::CloseRequested` is intercepted → `hide()` + `prevent_close()`. Only the tray Quit item calls `app.exit(0)`.
14. **CLIENT_VERSION `"0.1.0"`**, sent via `ApiClient.clientVersion` (matches the extension), so the 426 version-skew path (system spec §8) works identically.
15. **Toast auto-dismiss + queued state:** the capture toast shows for 5s with a live countdown; a "queued — offline" toast shows until the outbox flushes (the background emits `cc:capture-result { state: "queued" | "synced" | ... }` and later a `cc:toast-update` when a queued item delivers). Multiple rapid captures replace the toast content (single toast window, latest wins) rather than stacking.

## PR sequence (8 PRs)

| PR | Branch | Title (conventional) | Tasks | Est. LOC (src/test) |
|----|--------|----------------------|-------|---------------------|
| 1 | `feat/desktop-scaffold` | `feat(desktop): tauri v2 + react scaffold, design tokens and theme engine` | 1–2 | ~300 (+conf/rust ~150) / ~90 |
| 2 | `feat/desktop-rust-shell` | `feat(desktop): rust shell — tray, global hotkey, clipboard guard, single-instance` | 3–4 | ~340 rust / ~130 rust |
| 3 | `feat/desktop-webview-plumbing` | `feat(desktop): storage adapter, settings, message contract and event bridge` | 5–6 | ~360 / ~330 |
| 4 | `feat/desktop-background-controller` | `feat(desktop): background window owning the core sync engine and outbox` | 7 | ~380 / ~330 |
| 5 | `feat/desktop-flyout` | `feat(desktop): flyout surface — feed cards, compose, capture toast` | 8–9 | ~470 / ~340 |
| 6 | `feat/desktop-full-window` | `feat(desktop): full window — rail, feed, live wiring and reconnect banner` | 10–11 | ~430 / ~300 |
| 7 | `feat/desktop-onboarding-settings` | `feat(desktop): onboarding, settings (incl. Capture tab) and notification policy` | 12–14 | ~520 / ~360 |
| 8 | `ci/desktop-build` | `ci: desktop build workflow (ubuntu test + windows bundle) and manual smoke checklist` | 15–16 | ~30 yaml + ~40 md / — |

## File structure (end state)

```
cross-clipper/
├── .github/workflows/
│   └── desktop.yml                      # Task 15 — one workflow per concern, paths-filtered
├── package.json                         # Modified Task 1 (clients/* already in workspaces glob)
├── .gitignore                           # Modified Task 1 (dist, src-tauri/target)
└── clients/desktop/
    ├── package.json                     # Task 1
    ├── tsconfig.json                    # Task 1
    ├── vite.config.ts                   # Task 1
    ├── vitest.config.ts                 # Task 1
    ├── index.html                       # Task 1 (main window entry)
    ├── flyout.html                      # Task 5 (flyout window entry)
    ├── toast.html                       # Task 9 (toast window entry)
    ├── background.html                  # Task 7 (hidden background window entry)
    ├── docs/manual-smoke-checklist.md   # Task 16 — release gate
    ├── src/
    │   ├── theme/
    │   │   ├── tokens.css               # Task 2 — token NAMES = cross-client contract
    │   │   └── theme.ts                 # Task 2 — reuse of extension theme engine (amended crossover)
    │   ├── shared/
    │   │   ├── model.ts                 # Task 5 — DeviceView, platformIcon (windows 💻), parseUtc
    │   │   ├── format.tsx               # Task 5 — relativeTime, detectKind, linkify, capByBytes
    │   │   ├── storage.ts               # Task 5 — TauriStorage implements SyncStorage
    │   │   ├── settings.ts              # Task 5 — auth/prefs/appearance/hotkeys persistence
    │   │   ├── messages.ts              # Task 5 — StateSnapshot/PopupRequest/WorkerEvent + guards
    │   │   └── bridge.ts                # Task 6 — Tauri-events transport (emit/listen, request/reply)
    │   ├── ui/
    │   │   ├── FeedCard.tsx             # Task 8
    │   │   ├── DeviceRail.tsx           # Task 10
    │   │   ├── TargetPicker.tsx         # Task 8
    │   │   ├── Compose.tsx              # Task 8 (+ disabled drop zone)
    │   │   ├── Feed.tsx                 # Task 10
    │   │   ├── Banner.tsx               # Task 10
    │   │   └── ui.css                   # Task 8 (token-driven; shared by all windows)
    │   ├── background/
    │   │   ├── main.tsx                 # Task 7 — background window bootstrap
    │   │   ├── controller.ts            # Task 7 — BackgroundController (core owner)
    │   │   ├── feedStore.ts             # Task 7 — persisted feed (reuse of extension FeedStore)
    │   │   ├── alerts.ts                # Task 14 — AlertManager (policy + watermark)
    │   │   └── socket.ts                # Task 7 — tauri WebSocket adapter + wsUrl
    │   ├── flyout/
    │   │   ├── main.tsx                 # Task 5
    │   │   └── Flyout.tsx               # Task 8 (last-5 cards + compose + drop zone)
    │   ├── toast/
    │   │   ├── main.tsx                 # Task 9
    │   │   └── Toast.tsx                # Task 9 (synced/queued/sensitive/empty/unsupported + Undo)
    │   ├── main/
    │   │   ├── main.tsx                 # Task 3 (bootstrap) → routes Task 11
    │   │   ├── App.tsx                  # Task 11 (routes: loading / onboarding / main / settings)
    │   │   ├── useBridge.ts             # Task 11 — reducer over WorkerEvent + api
    │   │   ├── app.css                  # Task 11
    │   │   ├── onboarding/
    │   │   │   ├── probe.ts             # Task 12 (reuse of extension probe)
    │   │   │   ├── Onboarding.tsx       # Task 12
    │   │   │   ├── ServerStep.tsx       # Task 12
    │   │   │   ├── SignInStep.tsx       # Task 12
    │   │   │   └── AppearanceStep.tsx   # Task 12
    │   │   └── settings/
    │   │       ├── Settings.tsx         # Task 13 (tabs: Devices/Look/General/Capture)
    │   │       ├── DevicesTab.tsx       # Task 13
    │   │       ├── LookTab.tsx          # Task 13
    │   │       ├── GeneralTab.tsx       # Task 13
    │   │       └── CaptureTab.tsx       # Task 13 (desktop-only: hotkeys, toast, autostart)
    │   └── main.tsx                     # (per-window entries above; no single root)
    ├── tests/
    │   ├── setup.ts                     # Task 1 (jest-dom, matchMedia + Tauri IPC stub)
    │   ├── tauriMock.ts                 # Task 5 (fake @tauri-apps/api event + store)
    │   ├── theme.test.ts                # Task 2
    │   ├── model.test.tsx               # Task 5
    │   ├── format.test.tsx              # Task 5
    │   ├── storage.test.ts              # Task 5
    │   ├── settings.test.ts             # Task 5
    │   ├── messages.test.ts             # Task 5
    │   ├── bridge.test.ts               # Task 6
    │   ├── controller.test.ts           # Task 7
    │   ├── feedCard.test.tsx            # Task 8
    │   ├── composeTarget.test.tsx       # Task 8
    │   ├── toast.test.tsx               # Task 9
    │   ├── feedRail.test.tsx            # Task 10
    │   ├── useBridge.test.tsx           # Task 11
    │   ├── app.test.tsx                 # Task 11
    │   ├── probe.test.ts                # Task 12
    │   ├── onboarding.test.tsx          # Task 12
    │   ├── settings.test.tsx            # Task 13
    │   └── alerts.test.ts               # Task 14
    └── src-tauri/
        ├── Cargo.toml                   # Task 1
        ├── build.rs                     # Task 1
        ├── tauri.conf.json              # Task 1 (windows: background/main/flyout/toast)
        ├── capabilities/default.json    # Task 1/2 (permission grants)
        ├── icons/*                      # Task 1 (generated placeholder icons)
        └── src/
            ├── main.rs                  # Task 1 (thin: calls lib run())
            ├── lib.rs                   # Task 2 (Builder: plugins, tray, hotkeys, events)
            ├── clipboard.rs             # Task 3 — ClipboardReader trait + Windows impl + FakeClipboard
            ├── tray.rs                  # Task 4 — tray menu + flyout positioning
            └── hotkeys.rs               # Task 4 — register/unregister/pause
```

---

# PR 1 — Scaffold + design tokens

**Needs:** Phase 1/2 merged (they are). Nothing depends on this PR except the webview PRs.

## Task 1: Tauri v2 + React workspace scaffold

**Files:**
- Modify: root `package.json` (workspaces already glob `clients/*`; no change needed unless the glob is literal — verify) and `.gitignore`
- Create: `clients/desktop/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`
- Create: `clients/desktop/src/main/main.tsx` (placeholder), `clients/desktop/tests/setup.ts`, `clients/desktop/tests/scaffold.test.tsx`
- Create: `clients/desktop/src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`, `src/lib.rs` (minimal run), placeholder `icons/`

**Interfaces:**
- Consumes: npm workspace root; `@crossclipper/core`.
- Produces: workspace `@crossclipper/desktop` with scripts `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`), `typecheck`, `tauri` (`tauri`); a Tauri v2 app that builds a hidden `background`, a `main`, later a `flyout`/`toast` window; vitest jsdom config with a `@tauri-apps/api` mock alias.

- [ ] **Step 1: Write the failing test**

`clients/desktop/tests/scaffold.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/main/main";

describe("scaffold", () => {
  it("renders the app name", () => {
    render(<App />);
    expect(screen.getByText("CrossClipper")).toBeInTheDocument();
  });
});
```

(Export a placeholder `App` from `main/main.tsx` for this test; it becomes the real bootstrap in Task 3/11.)

- [ ] **Step 2: Create the JS workspace**

`clients/desktop/package.json` (versions mirror the extension; accept `npm install` resolution):

```json
{
  "name": "@crossclipper/desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "@crossclipper/core": "*",
    "@tauri-apps/api": "^2.1.0",
    "@tauri-apps/plugin-store": "^2.1.0",
    "@tauri-apps/plugin-global-shortcut": "^2.2.0",
    "@tauri-apps/plugin-notification": "^2.2.0",
    "@tauri-apps/plugin-autostart": "^2.2.0",
    "@tauri-apps/plugin-clipboard-manager": "^2.2.0",
    "@tauri-apps/plugin-opener": "^2.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.1.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^4.0.0"
  }
}
```

`clients/desktop/tsconfig.json` (copy the extension's, adding the Tauri window HTML entries to `include`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

`clients/desktop/vite.config.ts` (multi-page: one entry per window; Tauri serves the built `dist/`):

```ts
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Tauri expects a fixed dev port and no HMR clobbering.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5183, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        flyout: resolve(__dirname, "flyout.html"),
        toast: resolve(__dirname, "toast.html"),
        background: resolve(__dirname, "background.html"),
      },
    },
  },
});
```

(`flyout.html`, `toast.html`, `background.html` are created in their respective tasks; for PR 1 create `index.html` only and add the other inputs when those files land — or create all four HTML stubs now to keep the build config stable. Prefer creating all four stubs in PR 1.)

`clients/desktop/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Tauri APIs throw outside a real window; tests use the fake (Task 5).
      "@tauri-apps/api/event": path.resolve(__dirname, "tests/tauriMock.ts"),
      "@tauri-apps/plugin-store": path.resolve(__dirname, "tests/tauriMock.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
```

`clients/desktop/index.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>CrossClipper</title></head>
  <body><div id="root"></div><script type="module" src="/src/main/main.tsx"></script></body>
</html>
```

Create `flyout.html`, `toast.html`, `background.html` as copies pointing at `/src/flyout/main.tsx`, `/src/toast/main.tsx`, `/src/background/main.tsx` respectively (the referenced `main.tsx` files land in later tasks — Vite tolerates missing entries only at build; to keep PR 1 building, point all four at a shared placeholder `/src/main/main.tsx` and repoint in later tasks. **Chosen: point each at its own path and stub each `main.tsx` as a one-line placeholder in PR 1**, so the build config never changes again).

`clients/desktop/src/main/main.tsx` (placeholder App export for the scaffold test):

```tsx
export default function App() {
  return (
    <div>
      <header>
        <span aria-hidden>⧉</span> <span>CrossClipper</span>
      </header>
    </div>
  );
}
```

`clients/desktop/tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
```

- [ ] **Step 3: Create the Tauri shell (minimal, buildable)**

`clients/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "crossclipper-desktop"
version = "0.1.0"
edition = "2021"
rust-version = "1.77.2"

[lib]
name = "crossclipper_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri-plugin-notification = "2"

[target.'cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))'.dependencies]
tauri-plugin-global-shortcut = "2"
tauri-plugin-autostart = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-opener = "2"

[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = ["Win32_System_DataExchange", "Win32_System_Memory", "Win32_Foundation"] }
```

`clients/desktop/src-tauri/build.rs`: `fn main() { tauri_build::build() }`

`clients/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    crossclipper_desktop_lib::run();
}
```

`clients/desktop/src-tauri/src/lib.rs` (minimal; expanded in Task 2):

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running CrossClipper");
}
```

`clients/desktop/src-tauri/tauri.conf.json` (v2 schema — note `app.windows`, top-level `bundle`; the background window is hidden and lifecycle-owning per decision 12):

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "CrossClipper",
  "version": "0.1.0",
  "identifier": "com.crossclipper.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5183",
    "beforeDevCommand": "npm run dev --workspace @crossclipper/desktop",
    "beforeBuildCommand": "npm run build --workspace @crossclipper/desktop"
  },
  "app": {
    "windows": [
      { "label": "background", "url": "background.html", "visible": false, "skipTaskbar": true },
      { "label": "main", "title": "CrossClipper", "url": "index.html", "width": 900, "height": 620, "minWidth": 640, "minHeight": 480, "visible": false },
      { "label": "flyout", "url": "flyout.html", "decorations": false, "alwaysOnTop": true, "skipTaskbar": true, "resizable": false, "shadow": true, "width": 360, "height": 480, "visible": false },
      { "label": "toast", "url": "toast.html", "decorations": false, "alwaysOnTop": true, "skipTaskbar": true, "resizable": false, "focus": false, "transparent": true, "shadow": false, "width": 360, "height": 96, "visible": false }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"],
    "windows": { "webviewInstallMode": { "type": "downloadBootstrapper", "silent": true } }
  }
}
```

`clients/desktop/src-tauri/capabilities/default.json` (grows in Task 2; start minimal):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "CrossClipper desktop capabilities",
  "windows": ["main", "flyout", "toast", "background"],
  "permissions": [
    "core:default",
    "notification:default"
  ]
}
```

Generate placeholder icons: `npm run tauri --workspace @crossclipper/desktop -- icon` needs a source PNG; instead commit a simple amber 512×512 source and run `tauri icon`, OR reuse the extension's `make-icons` approach. **Chosen:** add a tiny `scripts/make-icons.mjs` (copied from the extension, emitting `32x32.png`, `128x128.png`, and a minimal `.ico`) so CI needs no design assets. Icons are LOC-exempt.

- [ ] **Step 4: Install, run test, verify Rust compiles**

```bash
npm install
npm run test --workspace @crossclipper/desktop        # scaffold test PASSES
npm run typecheck --workspace @crossclipper/desktop
(cd clients/desktop/src-tauri && cargo build)         # Rust shell compiles (downloads Tauri crates)
```

Expected: vitest green; `cargo build` succeeds (on the dev machine — CI proves this on `windows-latest` in PR 8).

- [ ] **Step 5: .gitignore + commit**

Add to `.gitignore`: `clients/desktop/dist/`, `clients/desktop/src-tauri/target/`, `clients/desktop/src-tauri/gen/`.

```bash
git add clients/desktop package.json package-lock.json .gitignore
git commit -m "feat(desktop): scaffold tauri v2 + react workspace with multi-window shell"
```

## Task 2: Design tokens + theme engine (reuse, amended crossover)

The token **names** are the cross-client contract (extension spec §7). We re-implement them in `clients/desktop/src/theme/` (no `packages/ui` yet — decision per spec §5). The `--accent-fg` derivation uses the **amended WCAG crossover (luminance 0.179)**.

**Files:**
- Create: `clients/desktop/src/theme/tokens.css`, `clients/desktop/src/theme/theme.ts`
- Test: `clients/desktop/tests/theme.test.ts`

**Interfaces:** identical to the extension's theme module — `ThemeSetting`, `Appearance`, `DEFAULT_APPEARANCE = { theme: "auto", accent: "#d97706" }`, `APPEARANCE_MIRROR_KEY = "cc.appearance"`, `resolveTheme`, `hexToRgb`, `accentForeground`, `accentSoft`, `applyAppearance`, `loadAppearanceSync`, `initTheme`.

- [ ] **Step 1: Write the failing tests**

`clients/desktop/tests/theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  accentForeground,
  accentSoft,
  applyAppearance,
  hexToRgb,
  resolveTheme,
} from "../src/theme/theme";

describe("theme resolution", () => {
  it("auto follows the system scheme; manual overrides win", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("accent derivation (amended WCAG crossover at luminance 0.179)", () => {
  it("parses hex", () => {
    expect(hexToRgb("#d97706")).toEqual([217, 119, 6]);
    expect(hexToRgb("nonsense")).toBeNull();
  });
  it("default amber gets DARK foreground (crossover rule); light-on-dark accents get white", () => {
    expect(accentForeground("#d97706")).toBe("#1c1917"); // amber luminance > 0.179 → dark text
    expect(accentForeground("#1e3a8a")).toBe("#ffffff"); // dark blue → white text
    expect(accentForeground("#fde047")).toBe("#1c1917"); // light yellow → dark text
  });
  it("soft accent is a translucent tint", () => {
    expect(accentSoft("#d97706")).toBe("rgba(217, 119, 6, 0.14)");
  });
});

describe("applyAppearance", () => {
  it("sets data-theme and the three accent custom properties", () => {
    const root = document.createElement("div");
    applyAppearance({ theme: "dark", accent: "#2563eb" }, root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--accent")).toBe("#2563eb");
    expect(root.style.getPropertyValue("--accent-fg")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--accent-soft")).toBe("rgba(37, 99, 235, 0.14)");
  });
  it("falls back to default amber on an unparseable accent", () => {
    const root = document.createElement("div");
    applyAppearance({ theme: "light", accent: "garbage" }, root);
    expect(root.style.getPropertyValue("--accent")).toBe(DEFAULT_APPEARANCE.accent);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test --workspace @crossclipper/desktop` → module not found.

- [ ] **Step 3: Implement**

`clients/desktop/src/theme/tokens.css` — copy the extension's `tokens.css` verbatim (token names + values + dark overrides + radii/spacing/`--font-ui`). The only deviation from the extension's committed file is that the default `--accent-fg` in `:root` should be `#1c1917` (dark) to match the amended crossover for the default amber — though runtime `applyAppearance` always overrides it, so keep the static default consistent with the runtime result.

`clients/desktop/src/theme/theme.ts` — copy the extension's `theme.ts`, with `accentForeground` using the **crossover threshold 0.179**:

```ts
/** WCAG relative luminance → readable text color on the accent.
 *  Amended 2026-07-04: crossover at luminance 0.179 (equal-contrast point);
 *  default amber (#d97706, luminance ≈ 0.23) therefore gets DARK text. */
export function accentForeground(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? "#1c1917" : "#ffffff";
}
```

The rest (`resolveTheme`, `hexToRgb`, `accentSoft`, `applyAppearance`, `loadAppearanceSync`, `initTheme`, types, constants) is identical to the extension. **Verify the amber test value:** amber luminance ≈ 0.229 > 0.179 → `#1c1917`. If the computed value drifts, the plan's expected test value stands (the spec fixes the crossover, not the exact hex); adjust only if amber genuinely crosses 0.179 (it does not).

- [ ] **Step 4: Run tests to verify they pass** — `npm run test && npm run typecheck --workspace @crossclipper/desktop`.

- [ ] **Step 5: Commit**

```bash
git add clients/desktop/src/theme clients/desktop/tests/theme.test.ts
git commit -m "feat(desktop): design tokens and theme engine with amended WCAG accent crossover"
```

### PR 1 checkpoint

- [ ] vitest + typecheck green; `cargo build` green locally.
- [ ] **STOP — Diego review**, then push + PR `feat(desktop): tauri v2 + react scaffold, design tokens and theme engine`.

---

# PR 2 — Rust shell (tray, hotkey, clipboard guard, single-instance)

**Needs:** PR 1's scaffold. Touches only `src-tauri/`.

## Task 3: Clipboard reader trait + sensitive-content guard

**Files:**
- Create: `clients/desktop/src-tauri/src/clipboard.rs`
- Modify: `clients/desktop/src-tauri/src/lib.rs` (`mod clipboard;`)

**Interfaces:**
- Produces: `enum ClipboardRead { Empty, Sensitive, Text(String), Unsupported }`; `trait ClipboardReader { fn read(&self) -> ClipboardRead }`; `struct WindowsClipboard` (real impl, `#[cfg(windows)]`); `struct FakeClipboard { pub next: ClipboardRead }` for tests. The guard checks the `ExcludeClipboardContentFromMonitoringProcessing` format **before** reading text (desktop spec §4 step 2).

- [ ] **Step 1: Write the failing tests** (in `clipboard.rs`, `#[cfg(test)]`):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    struct FakeClipboard { r: fn() -> ClipboardRead }
    impl ClipboardReader for FakeClipboard { fn read(&self) -> ClipboardRead { (self.r)() } }

    #[test]
    fn sensitive_content_is_never_read_as_text() {
        let fake = FakeClipboard { r: || ClipboardRead::Sensitive };
        assert!(matches!(fake.read(), ClipboardRead::Sensitive));
    }

    #[test]
    fn empty_text_and_unsupported_are_distinct() {
        assert!(matches!(FakeClipboard { r: || ClipboardRead::Empty }.read(), ClipboardRead::Empty));
        assert!(matches!(FakeClipboard { r: || ClipboardRead::Text("hi".into()) }.read(), ClipboardRead::Text(_)));
        assert!(matches!(FakeClipboard { r: || ClipboardRead::Unsupported }.read(), ClipboardRead::Unsupported));
    }
}
```

(These tests pin the enum/trait shape that the webview capture pipeline depends on. The Windows-format detection itself is exercised by the manual smoke checklist — Task 16 — since it needs a real clipboard; the trait boundary is what makes the rest mockable, per spec §7.)

- [ ] **Step 2: Run to verify failure** — `cd clients/desktop/src-tauri && cargo test` → `clipboard` module missing.

- [ ] **Step 3: Implement**

Define the enum + trait; implement `WindowsClipboard` behind `#[cfg(windows)]` using the `windows` crate: open the clipboard, enumerate formats, and if the registered format `"ExcludeClipboardContentFromMonitoringProcessing"` is present return `Sensitive` immediately; else read `CF_UNICODETEXT` → `Text`, empty → `Empty`, non-text formats → `Unsupported`. Provide a non-Windows stub impl (returns `Unsupported`) so the crate compiles on ubuntu CI. Keep classification (text-vs-link, trim, 256 KB) OUT of Rust (decision 5).

- [ ] **Step 4: Run tests** — `cargo test` green; `cargo clippy -- -D warnings` clean.

- [ ] **Step 5: Commit**

```bash
git add clients/desktop/src-tauri/src/clipboard.rs clients/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): clipboard reader trait with sensitive-content guard"
```

## Task 4: Tray, global hotkeys, single-instance, window management, capture event

**Files:**
- Create: `clients/desktop/src-tauri/src/tray.rs`, `clients/desktop/src-tauri/src/hotkeys.rs`
- Modify: `clients/desktop/src-tauri/src/lib.rs` (wire plugins, tray, hotkey handler, window-close interception, capture→event emission, IPC commands), `capabilities/default.json` (add permission strings)

**Interfaces:**
- Produces (Rust):
  - `single-instance` plugin registered **first** (decision 12): second launch focuses/show the `main` window.
  - `global-shortcut` plugin with a handler: on the capture combo (default `Ctrl+Alt+C`) → read clipboard → map `ClipboardRead` to a `cc:capture` event payload (`{ kind: "text" | "empty" | "sensitive" | "unsupported", text?: string }`) emitted to the `background` window; on the flyout combo (default `Ctrl+Alt+V`) → show/position the flyout.
  - `autostart` plugin initialized with `--minimized` (enable/disable driven from the webview via commands).
  - `notification` plugin (already in PR 1).
  - Tray (core `tray-icon`): left-click toggles the flyout (positioned near the tray via the click event rect); right-click menu — Open CrossClipper · Capture hotkey enabled ✓ · Pause 1 hour · Settings · Quit. Menu ids: `open`, `toggle_capture`, `pause`, `settings`, `quit`. `set_icon` swaps a normal/paused/pending icon.
  - Window-close interception: `main`/`flyout` `CloseRequested` → `hide()` + `prevent_close()`; only `quit` calls `app.exit(0)`.
  - Tauri **commands** callable from the webview: `register_hotkeys(capture: String, flyout: String) -> Result<(), String>` (returns Err on registration failure → decision 7), `pause_capture(minutes: u64)`, `set_capture_enabled(enabled: bool)`, `show_flyout()`, `show_main()`, `hide_window(label: String)`. Commands are thin — they call `tray.rs`/`hotkeys.rs` helpers.
- `capabilities/default.json` gains: `global-shortcut:allow-register`, `global-shortcut:allow-unregister`, `global-shortcut:allow-is-registered`, `autostart:allow-enable`, `autostart:allow-disable`, `autostart:allow-is-enabled`, `clipboard-manager:allow-write-text`, `opener:allow-open-url`, `store:default`, `event:default`, `core:window:allow-show`, `core:window:allow-hide`, `core:window:allow-set-focus`, `core:window:allow-set-position`, plus the `notification:default` already present.

- [ ] **Step 1: Write the failing tests** (Rust unit tests for the pure logic — accelerator parsing/validation and pause-timer bookkeeping; the OS-bound tray/register calls are covered by the manual checklist):

`hotkeys.rs` tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_capture_combo() {
        let sc = parse_accelerator("Ctrl+Alt+C").expect("valid");
        assert_eq!(describe(&sc), "Ctrl+Alt+C");
    }

    #[test]
    fn rejects_garbage_accelerator() {
        assert!(parse_accelerator("not a combo!!").is_none());
    }

    #[test]
    fn distinct_capture_and_flyout_combos_are_allowed() {
        assert!(parse_accelerator("Ctrl+Alt+C").is_some());
        assert!(parse_accelerator("Ctrl+Alt+V").is_some());
    }
}
```

- [ ] **Step 2: Run to verify failure** — `cargo test` → `hotkeys` helpers missing.

- [ ] **Step 3: Implement**

`hotkeys.rs`: `parse_accelerator(s: &str) -> Option<Shortcut>` (wrap the plugin's `Shortcut::from_str`/`Modifiers`+`Code` parsing), `describe(&Shortcut) -> String`, and a `HotkeyState` struct holding the current capture/flyout shortcuts + a pause deadline. `register_all(app, capture, flyout) -> Result<(), String>` returns `Err` when the plugin's `register()` fails (decision 7).

`tray.rs`: `build_tray(app) -> Result<TrayIcon>` with the menu ids above and `show_menu_on_left_click(false)`; `position_flyout_near(app, rect)` computes a bottom-right anchor and calls `set_position`; `set_tray_state(app, State)` swaps the icon (`Normal`/`Paused`/`Pending`).

`lib.rs`: assemble the Builder — `single-instance` first, then `global-shortcut` (with the capture/flyout handler reading via `WindowsClipboard` and emitting `cc:capture`), `autostart`, `notification`, `store`; `.setup(|app| { build_tray(app)?; register default hotkeys; Ok(()) })`; `.on_window_event(...)` for close-interception + flyout blur-hide (`WindowEvent::Focused(false)` on the flyout → hide, guarded against the tray-toggle race per the research caveat); `.invoke_handler(tauri::generate_handler![...])` for the commands.

- [ ] **Step 4: Run tests + build** — `cargo test` green; `cargo build` green; `cargo fmt --check` and `cargo clippy -- -D warnings` clean.

- [ ] **Step 5: Commit**

```bash
git add clients/desktop/src-tauri
git commit -m "feat(desktop): tray, global hotkeys, single-instance and capture event emission"
```

### PR 2 checkpoint

- [ ] `cargo test`/`fmt`/`clippy` green; `cargo build` green. Manual: run `npm run tauri dev`, confirm tray appears, Ctrl+Alt+C emits (log in the background window console), Ctrl+Alt+V shows the flyout.
- [ ] **STOP — Diego review**, then push + PR `feat(desktop): rust shell — tray, global hotkey, clipboard guard, single-instance`.

---

# PR 3 — Webview plumbing (storage, settings, messages, event bridge)

**Needs:** PR 1. Touches only `src/shared/` + tests.

## Task 5: TauriStorage, settings, model/format, message contract

**Files:**
- Create: `clients/desktop/src/shared/storage.ts`, `settings.ts`, `model.ts`, `format.tsx`, `messages.ts`
- Create: `clients/desktop/tests/tauriMock.ts`
- Test: `clients/desktop/tests/storage.test.ts`, `settings.test.ts`, `model.test.tsx`, `format.test.tsx`, `messages.test.ts`

**Interfaces:**
- `storage.ts`: `class TauriStorage implements SyncStorage` over `@tauri-apps/plugin-store` (a `Store` instance keyed by JSON entries); constructor accepts an injectable store for tests (`constructor(store?: StoreLike)`). Keys used verbatim: core owns `cc.cursor`/`cc.outbox`; this store also holds `cc.items`, `cc.itemTombstones`, `cc.devices`, `cc.auth`, `cc.prefs`, `cc.appearanceStored`, `cc.serverVersion`, `cc.hotkeys`, `cc.alert.watermark`, `cc.autostartInitialized`.
- `settings.ts`: reuse the extension's shapes verbatim — `AuthState { baseUrl, token, deviceId, deviceName }`, `Prefs { notifyOnNewItems: boolean; }` (drop `contextMenuSend` — no context menu on desktop; **add** `captureToastEnabled: boolean; captureToastDurationMs: number; launchAtLogin: boolean`), `DEFAULT_PREFS`, `Hotkeys { capture: string; flyout: string }`, `DEFAULT_HOTKEYS = { capture: "Ctrl+Alt+C", flyout: "Ctrl+Alt+V" }`; `loadAuth/saveAuth/clearAuth`, `loadPrefs/savePrefs`, `loadHotkeys/saveHotkeys`, `saveAppearance/loadAppearanceStored`. `saveAppearance` mirrors to `localStorage` (per-window pre-paint) AND applies immediately.
- `model.ts`, `format.tsx`: copy the extension's `model.ts` (`DeviceView`, `parseUtc`, `toDeviceView`, `platformIcon` — confirmed handles `"windows" → 💻`) and `format.tsx` (`relativeTime`, `detectKind`, `linkify`), **adding** `capByBytes(body: string, max = 262144): { body: string; capped: boolean }` (256 KB client-side cap, spec §4 step 3 — count UTF-8 bytes via `TextEncoder`).
- `messages.ts`: copy the extension's `messages.ts` shapes verbatim — `StateSnapshot`, `PopupRequest`, `WorkerEvent`, `PendingSend`, `isPopupRequest`, `isWorkerEvent` — **dropping** the `rename_device`/context-menu concerns only if desktop keeps them (desktop DOES have a devices tab with rename/revoke → **keep them**). Replace `EVENTS_PORT` with the Tauri event names `REQ_EVENT = "cc:req"`, `EVT_EVENT = "cc:evt"`, `REPLY_EVENT = "cc:reply"`. **Add** a capture-result event to `WorkerEvent`: `{ type: "capture_result"; state: "synced" | "queued" | "sensitive" | "empty" | "unsupported"; snippet?: string; outboxId?: string }` and `{ type: "toast_update"; outboxId: string; state: "synced" }`.

- [ ] **Step 1: Write the failing tests**

`clients/desktop/tests/tauriMock.ts` (aliased for `@tauri-apps/api/event` and `@tauri-apps/plugin-store`):

```ts
// Fake Tauri event bus + store for vitest. Mutable, reset per test.
type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Set<Handler>>();

export async function listen(name: string, cb: Handler): Promise<() => void> {
  const set = handlers.get(name) ?? new Set();
  set.add(cb);
  handlers.set(name, set);
  return () => set.delete(cb);
}
export async function emit(name: string, payload?: unknown): Promise<void> {
  for (const cb of handlers.get(name) ?? []) cb({ payload });
}
export function __resetEvents(): void {
  handlers.clear();
}

// plugin-store fake: in-memory JSON k/v with load/get/set/save.
export class Store {
  private data = new Map<string, unknown>();
  static async load(_path: string): Promise<Store> {
    return new Store();
  }
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async save(): Promise<void> {}
}
```

`clients/desktop/tests/storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Store } from "./tauriMock";
import { MemoryStorage } from "@crossclipper/core";
import { TauriStorage } from "../src/shared/storage";

describe("TauriStorage implements SyncStorage", () => {
  it("round-trips string values and returns null for missing keys", async () => {
    const s = new TauriStorage(new Store());
    expect(await s.get("cc.cursor")).toBeNull();
    await s.set("cc.cursor", "abc");
    expect(await s.get("cc.cursor")).toBe("abc");
  });
  it("is substitutable for MemoryStorage (same contract)", async () => {
    const impls = [new TauriStorage(new Store()), new MemoryStorage()];
    for (const s of impls) {
      await s.set("k", "v");
      expect(await s.get("k")).toBe("v");
      expect(await s.get("missing")).toBeNull();
    }
  });
});
```

`clients/desktop/tests/settings.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "./tauriMock";
import {
  DEFAULT_HOTKEYS,
  DEFAULT_PREFS,
  loadAuth,
  loadHotkeys,
  loadPrefs,
  saveAuth,
  saveHotkeys,
  savePrefs,
  clearAuth,
  __setStore,
} from "../src/shared/settings";

describe("settings store", () => {
  beforeEach(() => {
    __setStore(new Store());
    localStorage.clear();
  });
  it("auth round-trips and clears", async () => {
    expect(await loadAuth()).toBeNull();
    const auth = { baseUrl: "http://s", token: "t", deviceId: "d", deviceName: "n" };
    await saveAuth(auth);
    expect(await loadAuth()).toEqual(auth);
    await clearAuth();
    expect(await loadAuth()).toBeNull();
  });
  it("prefs default and merge patches", async () => {
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
    await savePrefs({ notifyOnNewItems: true });
    expect((await loadPrefs()).notifyOnNewItems).toBe(true);
    expect((await loadPrefs()).captureToastEnabled).toBe(true);
  });
  it("hotkeys default to Ctrl+Alt+C / Ctrl+Alt+V and persist", async () => {
    expect(await loadHotkeys()).toEqual(DEFAULT_HOTKEYS);
    await saveHotkeys({ capture: "Ctrl+Shift+K", flyout: "Ctrl+Alt+V" });
    expect((await loadHotkeys()).capture).toBe("Ctrl+Shift+K");
  });
});
```

`clients/desktop/tests/model.test.tsx` + `format.test.tsx`: copy the extension's `format.test.tsx` (relativeTime buckets, detectKind, linkify, device view — `platformIcon("windows") === "💻"`, `toDeviceView` passes through `online`), **adding**:

```tsx
import { capByBytes } from "../src/shared/format";
describe("capByBytes", () => {
  it("passes short bodies through and caps oversized ones at 256 KB", () => {
    expect(capByBytes("hi")).toEqual({ body: "hi", capped: false });
    const big = "x".repeat(300_000);
    const out = capByBytes(big);
    expect(out.capped).toBe(true);
    expect(new TextEncoder().encode(out.body).length).toBeLessThanOrEqual(262_144);
  });
});
```

`clients/desktop/tests/messages.test.ts`: copy the extension's guard contract tests, **adding** the new `capture_result` / `toast_update` events to the `isWorkerEvent` accept-set.

- [ ] **Step 2: Run to verify failure** — modules missing.

- [ ] **Step 3: Implement** the five modules. `settings.ts` uses a module-level lazily-loaded `Store` with a `__setStore` test hook; `saveAppearance` mirrors to `localStorage` and calls `applyAppearance`. Copy `model.ts`/`format.tsx`/`messages.ts` from the extension and apply the additions above.

- [ ] **Step 4: Run tests + typecheck** green.

- [ ] **Step 5: Commit**

```bash
git add clients/desktop/src/shared clients/desktop/tests
git commit -m "feat(desktop): tauri storage adapter, settings, model/format and message contract"
```

## Task 6: Event bridge (Tauri emit/listen transport)

**Files:**
- Create: `clients/desktop/src/shared/bridge.ts`
- Test: `clients/desktop/tests/bridge.test.ts`

**Interfaces:**
- Produces:
  - `subscribeEvents(cb: (e: WorkerEvent) => void): Promise<() => void>` — renderers listen on `EVT_EVENT`, filtered by `isWorkerEvent`.
  - `requestBackground<T>(req: PopupRequest): Promise<T>` — emits `REQ_EVENT` with a correlation id and awaits a matching `REPLY_EVENT { id, result }` (with a timeout); this is the extension's `requestWorker` re-expressed over Tauri events.
  - `serveRequests(handler: (req: PopupRequest) => Promise<unknown>): Promise<() => void>` — the background window's side: listen on `REQ_EVENT`, run `handler`, emit the correlated `REPLY_EVENT`.
  - `broadcast(e: WorkerEvent): Promise<void>` — background emits `EVT_EVENT`.

- [ ] **Step 1: Write the failing test**

`clients/desktop/tests/bridge.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetEvents } from "./tauriMock";
import { broadcast, requestBackground, serveRequests, subscribeEvents } from "../src/shared/bridge";
import type { PopupRequest } from "../src/shared/messages";

describe("event bridge", () => {
  beforeEach(() => __resetEvents());

  it("delivers broadcast WorkerEvents to subscribers", async () => {
    const seen: unknown[] = [];
    await subscribeEvents((e) => seen.push(e));
    await broadcast({ type: "status", status: "live" });
    expect(seen).toEqual([{ type: "status", status: "live" }]);
  });

  it("request/reply round-trips through the handler with correlation", async () => {
    const handler = vi.fn(async (req: PopupRequest) =>
      req.type === "send" ? { outboxId: "01X" } : { ok: true },
    );
    await serveRequests(handler);
    const res = await requestBackground<{ outboxId: string }>({
      type: "send",
      kind: "text",
      body: "hi",
      targetDeviceId: null,
    });
    expect(res.outboxId).toBe("01X");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed WorkerEvents", async () => {
    const seen: unknown[] = [];
    await subscribeEvents((e) => seen.push(e));
    await broadcast({ type: "nonsense" } as never);
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `bridge.ts` using `listen`/`emit` from `@tauri-apps/api/event`, a `crypto.randomUUID()` correlation id, and a `Map<id, resolve>` for pending replies with a 10 s timeout.

- [ ] **Step 4: Run tests + typecheck** green.

- [ ] **Step 5: Commit**

```bash
git add clients/desktop/src/shared/bridge.ts clients/desktop/tests/bridge.test.ts
git commit -m "feat(desktop): tauri-events bridge for background↔renderer messaging"
```

### PR 3 checkpoint

- [ ] Suite + typecheck green.
- [ ] **STOP — Diego review**, then push + PR `feat(desktop): storage adapter, settings, message contract and event bridge`.

---

# PR 4 — Background window (core sync owner)

**Needs:** PR 3.

## Task 7: BackgroundController + socket adapter + feed store + background bootstrap

**Files:**
- Create: `clients/desktop/src/background/socket.ts`, `feedStore.ts`, `controller.ts`, `main.tsx`
- Test: `clients/desktop/tests/controller.test.ts`

**Interfaces:**
- `socket.ts`: `wsUrl(baseUrl, token)` → `ws(s)://…/api/v1/ws?token=…`; `tauriSocketFactory: SocketFactory` using the browser-global `WebSocket` (WebView2 provides it) → `WsLike`.
- `feedStore.ts`: copy the extension's `FeedStore` verbatim (persisted `cc.items`/`cc.itemTombstones`, `MAX_ITEMS = 1000`, newest-first, tombstone-wins).
- `controller.ts`: `BackgroundController` — copy the extension's controller structure (owns `ApiClient` + `SyncEngine` + `Outbox` + `FeedStore`, `wake()` idempotent boot, `handleRequest`, `snapshot`, `broadcast`), with these desktop-specific changes:
  - Broadcast/serve over the **bridge** (`broadcast`, `serveRequests`) instead of ports.
  - `ControllerDeps` gains `onNewItem?: (item: Item) => void` (alert hook, wired Task 14) and `onCaptureResult?: (r) => void` (Rust toast hook, wired Task 14).
  - `SyncEngine` emits `auth_failed` (confirmed core event) — the controller maps engine `auth_failed` **and** outbox `auth_required` to a broadcast `{ type: "auth_required" }`.
  - `SyncEngine` surfaces presence transitions as `devices_changed` (the wire event is `device_changed`; core translates the name). The controller handles `devices_changed` and re-fetches the device list. Do not "fix" the event name at implementation time.
  - **Capture handling:** a `handleCapture(payload: { kind; text? })` method: `empty`/`sensitive`/`unsupported` → `onCaptureResult({ state })` (no send); `text` → `capByBytes` + `detectKind` → `outbox.send(kind, body)` (untargeted, decision 3) → track `outboxId`; emit `onCaptureResult({ state: outbox delivered synchronously? "synced" : "queued", snippet, outboxId })`. On later `delivered`, emit `toast_update`.
  - **Undo:** `handleRequest({ type: "undo_capture"; outboxId })` — if still queued, cancel locally; if delivered, `client.deleteItem(itemId)` (decision 4). Add `undo_capture` to `PopupRequest` (Task 5's messages — fold in here if missed).
- `main.tsx`: bootstrap — construct `TauriStorage` (real store), `BackgroundController`, call `serveRequests(controller.handleRequest)`, `subscribe` to the Rust `cc:capture` event → `controller.handleCapture`, wire `onCaptureResult` → emit `cc:capture-result` back to Rust (via `emit`), call `controller.wake()`, and on first successful auth call `autostart.enable()` guarded by `cc.autostartInitialized`.

- [ ] **Step 1: Write the failing tests**

`clients/desktop/tests/controller.test.ts` — adapt the extension's `controller.test.ts` to the bridge transport (use the `tauriMock` event bus + a `FakeSocket` implementing `WsLike` + a `makeFetch` fake server returning items/devices/create/delete). Cover:

```ts
// (imports: MemoryStorage, Item from core; __resetEvents from tauriMock; FakeSocket + makeFetch helpers)

const AUTH = JSON.stringify({ baseUrl: "http://s", token: "tok", deviceId: "self", deviceName: "me" });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("BackgroundController (desktop)", () => {
  it("without auth, wake is a no-op and the snapshot is unauthenticated", async () => {
    const { controller } = await makeController({});
    await controller.wake();
    expect(FakeSocket.instances).toHaveLength(0);
    expect((await controller.snapshot()).authed).toBe(false);
  });

  it("with auth, wake starts the engine against the ws url with the token", async () => {
    const { controller } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    expect(FakeSocket.instances[0]!.url).toBe("ws://s/api/v1/ws?token=tok");
  });

  it("pulled items persist and fire the new-item hook once (WS echo does not re-fire)", async () => {
    const { controller, onNewItem } = await makeController({ "cc.auth": AUTH }, [[item("01A")]]);
    await controller.wake();
    FakeSocket.instances[0]!.open();
    await flush();
    expect((await controller.snapshot()).items.map((i) => i.id)).toEqual(["01A"]);
    expect(onNewItem).toHaveBeenCalledTimes(1);
    FakeSocket.instances[0]!.push({ type: "item_new", item: item("01A") });
    await flush();
    expect(onNewItem).toHaveBeenCalledTimes(1);
  });

  it("capture of text sends UNTARGETED through the outbox and reports a result", async () => {
    const { controller, created, captureResults } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    await controller.handleCapture({ kind: "text", text: "  captured note  " });
    await flush();
    expect(created[0]).toMatchObject({ body: "captured note" });
    expect("target_device_id" in created[0]!).toBe(false); // speed path is silent
    expect(captureResults[0]).toMatchObject({ state: expect.stringMatching(/synced|queued/) });
  });

  it("capture of sensitive/empty/unsupported clipboard sends nothing", async () => {
    const { controller, created, captureResults } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    for (const kind of ["sensitive", "empty", "unsupported"] as const) {
      await controller.handleCapture({ kind });
    }
    await flush();
    expect(created).toHaveLength(0);
    expect(captureResults.map((r) => r.state)).toEqual(["sensitive", "empty", "unsupported"]);
  });

  it("undo of a delivered capture deletes the item; sign_out wipes state", async () => {
    // ...delete asserted via the fake server DELETE hook; sign_out clears cc.items + cursor
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** the four files. Reuse the extension controller's proven event fan-out, `pendingList`, `fetchDevices`, `sign_out` reset (write `""`/`"[]"` — no `remove` on `SyncStorage`). Add capture + undo. Verify the `createItem` target field name is `target_device_id` (confirmed in core) and that untargeted `outbox.send(kind, body)` omits the field.

- [ ] **Step 4: Run tests + typecheck + `cargo build` unaffected** green.

- [ ] **Step 5: Commit**

```bash
git add clients/desktop/src/background clients/desktop/tests/controller.test.ts
git commit -m "feat(desktop): background controller owning the core sync engine, outbox and capture pipeline"
```

### PR 4 checkpoint

- [ ] Suite + typecheck green; core suite still green.
- [ ] **STOP — Diego review**, then push + PR `feat(desktop): background window owning the core sync engine and outbox`.

---

# PR 5 — Flyout surface (cards, compose, capture toast)

**Needs:** PR 3 (shared) and PR 4 (background) merged so the flyout has a live backend; the components themselves depend only on PR 3.

## Task 8: FeedCard, TargetPicker, Compose (+ disabled drop zone), shared ui.css

**Files:**
- Create: `clients/desktop/src/ui/FeedCard.tsx`, `TargetPicker.tsx`, `Compose.tsx`, `ui.css`
- Test: `clients/desktop/tests/feedCard.test.tsx`, `composeTarget.test.tsx`

**Interfaces:** copy the extension's `FeedCard`, `TargetPicker`, `Compose` verbatim (kind-aware always-visible actions, unknown-kind fallback, linkified bodies, Copy with "Copied ✓", Enter-sends/Shift+Enter-newline, Silent-default target chips excluding self, reset after send). `Compose` **adds** a visible-but-disabled drop zone (`<div class="dropzone" aria-disabled>⇣ drop files or images here (media phase)</div>`) per desktop spec §3. `ui.css` is the token-driven stylesheet shared by all windows (adapt the extension's `popup.css`; the full window is roomier but reuses the card/rail/chip/compose classes).

- [ ] **Step 1: Write the failing tests** — copy the extension's `feedCard.test.tsx` and the compose/target portion of `railComposeTarget.test.tsx`, adding one assertion:

```tsx
it("shows a disabled media drop zone", () => {
  render(<Compose devices={devices} onSend={vi.fn()} />);
  const dz = screen.getByText(/drop files or images here/i);
  expect(dz).toHaveAttribute("aria-disabled");
});
```

- [ ] **Step 2–5:** run-fail → implement (copy + drop zone) → run-pass/typecheck → commit `feat(desktop): feed card, target picker, compose and shared token styles`.

## Task 9: Capture toast window

**Files:**
- Create: `clients/desktop/toast.html` (if not stubbed in PR 1), `clients/desktop/src/toast/main.tsx`, `src/toast/Toast.tsx`
- Test: `clients/desktop/tests/toast.test.tsx`

**Interfaces:**
- `Toast.tsx`: `interface ToastState { state: "synced" | "queued" | "sensitive" | "empty" | "unsupported"; snippet?: string; outboxId?: string }`; `Toast({ toast, countdownMs, onUndo, onDismiss })` renders the desktop spec §3 surfaces:
  - `synced` → "⧉ Synced · <snippet> · [Undo] · Ns" with a live countdown; Undo calls `onUndo(outboxId)`; auto-dismiss at 0.
  - `queued` → "queued — will sync when connected" (no countdown; persists until a `toast_update` flips it to synced).
  - `sensitive` → "not captured — marked sensitive".
  - `empty` → "clipboard is empty".
  - `unsupported` → "images & files come in a later version".
- `main.tsx`: bootstrap — `initTheme()`, subscribe to `cc:capture-result` (from Rust/background) → set toast state + show the toast window; on Undo → `requestBackground({ type: "undo_capture", outboxId })` + hide; auto-hide via `hide_window("toast")` command.

- [ ] **Step 1: Write the failing tests**

`clients/desktop/tests/toast.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toast } from "../src/toast/Toast";

describe("Toast", () => {
  it("synced shows snippet, countdown and a working Undo", async () => {
    const onUndo = vi.fn();
    render(<Toast toast={{ state: "synced", snippet: "hello", outboxId: "01X" }} countdownMs={5000} onUndo={onUndo} onDismiss={vi.fn()} />);
    expect(screen.getByText(/synced/i)).toBeInTheDocument();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledWith("01X");
  });
  it("queued shows the offline message and no Undo countdown timer", () => {
    render(<Toast toast={{ state: "queued", snippet: "hi" }} countdownMs={0} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/queued — will sync when connected/i)).toBeInTheDocument();
  });
  it("renders sensitive / empty / unsupported messages", () => {
    for (const [state, re] of [["sensitive", /marked sensitive/i], ["empty", /clipboard is empty/i], ["unsupported", /later version/i]] as const) {
      const { unmount } = render(<Toast toast={{ state }} countdownMs={0} onUndo={vi.fn()} onDismiss={vi.fn()} />);
      expect(screen.getByText(re)).toBeInTheDocument();
      unmount();
    }
  });
});
```

- [ ] **Step 2–5:** run-fail → implement → run-pass/typecheck/`cargo build` → commit `feat(desktop): capture toast window with undo, queued and guard states`.

### PR 5 checkpoint

- [ ] Suite + typecheck green; manual `tauri dev`: Ctrl+Alt+C on text → toast with Undo; Undo removes the item everywhere.
- [ ] **STOP — Diego review**, then push + PR `feat(desktop): flyout surface — feed cards, compose, capture toast`.

*(Note: the flyout renderer — `flyout/Flyout.tsx` + `flyout/main.tsx` — composes the Task 8 components into the last-5-cards + compose + drop-zone layout and wires to the background via `useBridge` from Task 11. Land the flyout renderer in this PR if under the LOC cap; otherwise fold it into PR 6 alongside the shared `useBridge` hook. Chosen: build `useBridge` in this PR too — it is small — so both flyout and full window can consume it. Move Task 11's `useBridge` earlier if executing strictly by PR.)*

---

# PR 6 — Full window (rail, feed, live wiring)

**Needs:** PR 5.

## Task 10: DeviceRail, Feed, Banner

**Files:**
- Create: `clients/desktop/src/ui/DeviceRail.tsx`, `Feed.tsx`, `Banner.tsx`
- Test: `clients/desktop/tests/feedRail.test.tsx`

**Interfaces:** copy the extension's `DeviceRail` (All + per-device buttons with presence dots from the server `online` flag), `Feed` (scrollable card list + empty-state hint + "↑ new items" pill), `Banner` (`reconnecting`/`version`). Same signatures as the extension.

- [ ] **Steps:** copy the extension's `railComposeTarget.test.tsx` rail portion + `appStatic`-style feed assertions → implement → run-pass → commit `feat(desktop): device rail, feed list and reconnect banner`.

## Task 11: `useBridge` hook + full-window App (routes + live wiring)

**Files:**
- Create: `clients/desktop/src/main/useBridge.ts`, `clients/desktop/src/main/App.tsx`, `clients/desktop/src/main/app.css`, `clients/desktop/src/flyout/Flyout.tsx`, `clients/desktop/src/flyout/main.tsx`
- Modify: `clients/desktop/src/main/main.tsx` (real bootstrap: `initTheme` + render `App`)
- Test: `clients/desktop/tests/useBridge.test.tsx`, `app.test.tsx`

**Interfaces:**
- `useBridge.ts`: the extension's `useWorker` re-expressed over the bridge — `PopupState`, `reduce(state, WorkerEvent)`, `useBridge(): { state; api }` where `api` = `send/undoCapture/deleteItem/refresh/renameDevice/revokeDevice/signOut` calling `requestBackground`. Subscribes via `subscribeEvents` and requests an initial snapshot on mount (`get_state`).
- `App.tsx`: routes on `state` — loading splash → `authRequired || !authed` → onboarding (Task 12) → main (rail + feed + compose + ⚙ settings). Disconnected banner when `authed && status !== "live"`. Copy → the Rust clipboard-**write** command (`invoke("write_clipboard", { text })` — add a tiny Rust command in PR 2 or here; **chosen: add `write_clipboard` command in this PR's Rust touch is disallowed since PR 6 is webview-only → use `@tauri-apps/plugin-clipboard-manager` `writeText`**; add that plugin to `package.json` + capability `clipboard-manager:allow-write-text`). Open link → `@tauri-apps/plugin-opener` `openUrl` (or `open` plugin) — add plugin + capability.
- `Flyout.tsx`: last-5 cards + compose + drop zone, consuming `useBridge`; `flyout/main.tsx` bootstraps it.

*(Note: `tauri-plugin-clipboard-manager` and `tauri-plugin-opener` — their crates (`Cargo.toml`), npm packages (`package.json`), and capabilities (`clipboard-manager:allow-write-text`, `opener:allow-open-url`) are all declared in PR 1 / PR 2's Task 4 respectively. PR 6 only calls the plugins; it adds no `src-tauri` changes.)*

- [ ] **Step 1: Write the failing tests** — adapt the extension's `useWorker.test.tsx` (reducer ULID-order/dedup/`auth_required`, bridge connect + snapshot apply, `api.send` RPC shape) and `appLive.test.tsx` (renders synced items with resolved device names, compose sends through the bridge, disconnected banner, empty-state).

- [ ] **Step 2–5:** run-fail → implement → run-pass/typecheck/build → commit `feat(desktop): useBridge hook and live full-window app`.

### PR 6 checkpoint

- [ ] Suite + typecheck + `cargo build` green; manual: full window shows feed with live sync, rail filter, compose, presence dots; flyout mirrors last-5.
- [ ] **STOP — Diego review**, then push + PR `feat(desktop): full window — rail, feed, live wiring and reconnect banner`.

---

# PR 7 — Onboarding, settings, notification policy

**Needs:** PR 6.

## Task 12: Onboarding (Server → Sign in → Appearance)

**Files:**
- Create: `clients/desktop/src/main/onboarding/probe.ts`, `Onboarding.tsx`, `ServerStep.tsx`, `SignInStep.tsx`, `AppearanceStep.tsx`
- Modify: `App.tsx` (onboarding route), background controller (add an `onboard` request: register/login → save auth → `wake()` → `autostart.enable()` first-run)
- Test: `clients/desktop/tests/probe.test.ts`, `onboarding.test.tsx`

**Interfaces:** copy the extension's `probe.ts` (`normalizeServerUrl`, `isInsecureHttp`, `semverGte`, `probeServer` → `{ ok, version, registrationOpen } | { ok:false, reason }`, `MIN_SERVER_VERSION = "0.1.0"`) verbatim. Onboarding is the extension's 3-step stepper: Server (probe, "✓ CrossClipper vX found", first-run→create vs existing→sign-in branch, loud `http://` warning for non-private hosts), Sign in (email/password/device-name — default device name suggestion like the OS hostname via `@tauri-apps/plugin-os` `hostname()` or a static "This PC"), Appearance (skippable; theme + accent swatches). On completion the background persists auth and enables autostart once.

- [ ] **Steps:** copy the extension's `probe.test.ts` + `onboarding.test.tsx` (adapt fetch to `probeServer` and the create/sign-in branch) → implement → run-pass → commit `feat(desktop): three-step onboarding with server probe and first-run autostart`.

## Task 13: Settings (Devices / Look / General / Capture)

**Files:**
- Create: `clients/desktop/src/main/settings/Settings.tsx`, `DevicesTab.tsx`, `LookTab.tsx`, `GeneralTab.tsx`, `CaptureTab.tsx`
- Test: `clients/desktop/tests/settings.test.tsx`

**Interfaces:** copy the extension's Settings shell + Devices (status card, rich device rows with presence + last-seen, rename, revoke, 14-day stale nudge), Look (theme toggle + accent swatches + live re-skin), General (notify-on-new-items toggle — no context-menu toggle on desktop). **Add** the desktop-only **Capture** tab (spec §3): hotkey rebind fields for capture + flyout (calling the Rust `register_hotkeys` command; on failure show the "combo taken — pick another" inline error, decision 7), a capture-toast on/off + duration control, and a launch-at-login toggle (calls the Rust `autostart` enable/disable via `@tauri-apps/plugin-autostart`). Persists via Task 5 settings.

- [ ] **Steps:** copy the extension's `settingsPage.test.tsx` + add Capture-tab tests (rebind persists + calls the command; register failure surfaces an error; toast toggle; autostart toggle) → implement → run-pass → commit `feat(desktop): settings with devices, look, general and desktop capture tab`.

## Task 14: AlertManager (notification policy) + wiring

**Files:**
- Create: `clients/desktop/src/background/alerts.ts`
- Modify: `clients/desktop/src/background/main.tsx` (wire `onNewItem` → `AlertManager.onItem`; `onCaptureResult` already wired in PR 4)
- Test: `clients/desktop/tests/alerts.test.ts`

**Interfaces:** copy the extension's `AlertManager` semantics exactly (`WATERMARK_KEY = "cc.alert.watermark"`, ULID watermark dedup across restarts, own-items-never via `origin_device_id === selfId`, targeted-at-me always notifies, untargeted respects `prefs.notifyOnNewItems`, targeted-elsewhere raises **no notification** but **does** nudge the tray pending/unread state — the same badge-equivalent increment that the extension applies before the notify gate; the tray icon reflects "something new arrived" even for items you won't be notified about). Replace the browser `notifications`/badge deps with the Tauri **notification plugin** (`sendNotification` after `isPermissionGranted`/`requestPermission`) and the **tray icon pending/unread state** (call the Rust `set_tray_state` command instead of a browser badge). No `flashBadge`; instead nudge the tray icon.

- [ ] **Step 1: Write the failing tests** — copy the extension's `alerts.test.ts`, injecting a fake notifier + a fake `setTrayState`, asserting: watermark dedup (item id ≤ watermark → nothing), own item → nothing, targeted-at-me → notifies regardless of pref, untargeted + pref off → no notify but tray-pending, untargeted + pref on → notify, **targeted-elsewhere → tray-pending yes + notify no** (the item nudges the badge-equivalent even though no toast fires).

- [ ] **Step 2–5:** run-fail → implement → run-pass/typecheck → commit `feat(desktop): notification policy with cross-restart watermark and tray unread state`.

### PR 7 checkpoint

- [ ] Suite + typecheck + `cargo build` green; manual: onboard fresh server, targeted item from a phone toasts here, untargeted stays silent unless the toggle is on, hotkey rebind + autostart toggle work.
- [ ] **STOP — Diego review**, then push + PR `feat(desktop): onboarding, settings (incl. Capture tab) and notification policy`.

---

# PR 8 — CI + packaging + manual smoke checklist

**Needs:** PR 2 (for the Rust bundle build) merged; useful once webview PRs land.

## Task 15: Desktop CI workflow

**Files:**
- Create: `.github/workflows/desktop.yml`

**Interfaces:** one workflow per concern, paths-filtered to `clients/desktop/**` + root manifests + itself (house style confirmed). Two jobs, no cross-file `needs:`:
- `desktop` (ubuntu-latest): `setup-node lts/*` + npm cache → `npm ci` → `npm run typecheck` → `npm run test` → `npm run build --workspace @crossclipper/desktop`; then `dtolnay/rust-toolchain@stable` + the Linux webkit2gtk system deps → `cargo fmt --check` + `cargo clippy -- -D warnings` + `cargo test` (in `clients/desktop/src-tauri`).
- `windows-build` (windows-latest): `setup-node` + `dtolnay/rust-toolchain@stable` + `npm ci` → `npm run tauri --workspace @crossclipper/desktop -- build` (proves the NSIS/MSI bundle compiles + packages on Windows; WebView2 preinstalled on the runner). Upload the installer artifacts. This job runs on PRs (build-smoke) — it is the CI proof, not a WebDriver E2E (decision 11).

```yaml
name: Desktop
on:
  pull_request:
    paths:
      - 'clients/desktop/**'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/desktop.yml'
  push:
    branches: [main]
    paths:
      - 'clients/desktop/**'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/desktop.yml'
jobs:
  desktop:
    name: Desktop (test + lint)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: npm, cache-dependency-path: package-lock.json }
      - run: npm ci
      - run: npm run typecheck --workspace @crossclipper/desktop
      - run: npm run test --workspace @crossclipper/desktop
      - run: npm run build --workspace @crossclipper/desktop
      - uses: dtolnay/rust-toolchain@stable
        with: { components: rustfmt, clippy }
      - name: Linux tauri deps
        run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - run: cargo fmt --all --check
        working-directory: clients/desktop/src-tauri
      - run: cargo clippy --all-targets -- -D warnings
        working-directory: clients/desktop/src-tauri
      - run: cargo test
        working-directory: clients/desktop/src-tauri
  windows-build:
    name: Windows bundle (build smoke)
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: npm, cache-dependency-path: package-lock.json }
      - uses: dtolnay/rust-toolchain@stable
      - run: npm ci
      - run: npm run tauri --workspace @crossclipper/desktop -- build
      - uses: actions/upload-artifact@v4
        with:
          name: crossclipper-windows-installers
          path: |
            clients/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe
            clients/desktop/src-tauri/target/release/bundle/msi/*.msi
```

- [ ] Verify locally what CI runs (ubuntu job commands + `cargo test`); note the Windows job's post-merge verification (a PR touching `clients/desktop/**` triggers it). Commit `ci: desktop build workflow (ubuntu test + windows bundle)`.

## Task 16: Manual smoke checklist (release gate)

**Files:**
- Create: `clients/desktop/docs/manual-smoke-checklist.md`

**Interfaces:** the release gate for native behavior WebDriver/CI cannot drive (decision 11). Enumerate, as checkboxes, per desktop spec §7: capture hotkey while another app is focused (text → toast+Undo; sensitive → guard toast; empty; image → unsupported); flyout open/close (tray click, Ctrl+Alt+V, focus-loss auto-hide); tray menu (Open, toggle capture, Pause 1 hour re-enables, Settings, Quit); autostart on/off survives reboot; single-instance (second launch focuses); offline capture queues then flushes on reconnect; targeted notification arrives / untargeted respects toggle; window-close hides (app stays in tray); dark/light follows OS + accent re-skin; install from the NSIS `-setup.exe` and confirm Windows toasts appear (they need an installed app, per research).

- [ ] Write the checklist; commit `docs(desktop): manual smoke checklist as the release gate`.

### PR 8 checkpoint

- [ ] ubuntu job green; windows-build job produces installers (check the artifact); checklist reviewed.
- [ ] **STOP — Diego review**, then push + PR `ci: desktop build workflow (ubuntu test + windows bundle) and manual smoke checklist`.

---

# Self-review (performed while writing)

- **Desktop spec coverage.** §1 tray-resident + three surfaces → background window + flyout (PR 5) + main (PR 6) + toast (PR 5/9). §2 validated decisions → flyout+full window (PRs 5/6), hotkey capture + 5s Undo (PRs 2/4/9), disabled drop zone (Task 8), default hotkeys Ctrl+Alt+C / Ctrl+Alt+V configurable (Tasks 4/13), design language inherited from extension §2/§7 (Task 2 tokens + reused components). §3 surfaces → flyout header/last-5/compose/drop zone (Tasks 8/11), full window rail+feed+settings tabs incl. Capture (Tasks 10/11/13), capture toast synced/queued/sensitive/empty/unsupported + Undo (Task 9), tray left/right behavior + Pause + icon state (Task 4). §4 capture pipeline → sensitive guard (Task 3), normalize+classify+256 KB cap (Task 5 `capByBytes`/`detectKind`, Task 7 handleCapture), untargeted speed path (Task 7 test), non-text/empty toasts (Tasks 7/9). §5 architecture → single core engine in a hidden background window (Task 7, decision 1/12), thin Rust shell (PR 2), Tauri store `SyncStorage` (Task 5), launch-at-login default on (decision 8, Tasks 7/13), single-instance (Task 4). §6 error/edge → reconnecting banner (Task 10/11), 401→re-onboard via `auth_required` (Tasks 7/11/12), offline capture queue + tray pending (Tasks 7/14), undo of queued vs delivered (decision 4, Task 7), hotkey-conflict notification (decision 7, Tasks 4/13), version skew via CLIENT_VERSION+core 426 (decision 14). §7 testing → vitest component/logic tests throughout, Rust unit tests behind the clipboard trait (Task 3) + hotkey parsing (Task 4), realistic-E2E stance = component tests + windows build-smoke + manual checklist (decision 11, Tasks 15/16). §8 out-of-scope respected → no media upload (disabled drop zone only), no per-app exclusions, macOS/Linux packaging deferred (Windows-only bundle targets), no store polish, no updater (decision 10).
- **System spec coverage.** §4 protocol → core handles endpoints/cursor/WS; presence via server `online` + `device_changed` re-fetch (Task 7/10, never derived — Global Constraints). §4 notification policy → AlertManager targeted-always/untargeted-toggle/own-never + watermark (Task 14). §8 error spine → 401 single re-onboard, 426 version skew, disconnected banner (Tasks 7/10/11). Push content-free → N/A this phase, noted. §2 Python server / core-owns-sync → no sync logic in the client (decision 1, Task 7 is glue over core).
- **Extension-token contract (§7) coverage.** Token names reused verbatim (Task 2 `tokens.css`); slate + amber default; **amended `--accent-fg` crossover at luminance 0.179 → dark text on amber** (Task 2 test pins `accentForeground("#d97706") === "#1c1917"`). Radii/spacing/`--font-ui` reused.
- **Type/interface consistency spot-checks.** `SyncEngineEvent` includes `auth_failed` (verified in core) — controller maps it + outbox `auth_required` to one broadcast `auth_required` (Task 7). `createItem` input field `target_device_id` (verified) — untargeted capture omits it (Task 7 test). `Outbox.send(kind, body, targetDeviceId?)`, `SyncStorage` has no `remove` → sign-out writes `""`/`"[]"` (Task 7). `Device.online` consumed by `toDeviceView`/rail (Tasks 5/10). `WorkerEvent` extended with `capture_result`/`toast_update` in one place (Task 5) and consumed by Task 9 toast + Task 7 emitter. `PopupRequest` extended with `undo_capture` (Task 5/7). `DEFAULT_APPEARANCE`/`APPEARANCE_MIRROR_KEY`/`MIN_SERVER_VERSION`/`WATERMARK_KEY` reused verbatim from the extension.
- **Execution-time checks flagged inline.** Whether the root `workspaces` glob already covers `clients/desktop` (Task 1); exact Tauri plugin npm/crate versions at `npm install`/`cargo build` time (accept resolved); the four-HTML-entry Vite input stability (Task 1 chose stubbing all four up front); the clipboard-manager/opener plugins moved into PR 2 (Task 11 note); `useBridge` built in PR 5 so the flyout can consume it before PR 6 (PR 5 note).
- **LOC discipline.** Each PR's src+test estimate is under the ~600 soft cap counted separately; icons/generated schemas/lockfile are exempt. PR 7 is the largest (onboarding+settings+alerts, ~520/360) — split settings (Task 13) into its own PR if it overruns at implementation time.

# Explicit exclusions (this phase)

macOS/Linux packaging (Windows-only bundle targets; the Rust shell isolates OS-specific pieces for later ports) · media drop-zone activation / thumbnails / blob upload (drop zone ships visibly disabled) · per-app capture exclusions and content-pattern filters · auto-updater (`tauri-plugin-updater`) · code-signing (unsigned MVP; addable without code change) · WebDriver E2E in CI (deferred per spec §7; component tests + windows build-smoke + manual checklist instead) · E2EE (trust model is TLS + own server; never claimed).
