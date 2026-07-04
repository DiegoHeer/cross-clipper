# CrossClipper — Browser Extension Client Design

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation
**Parent spec:** [2026-07-03-cross-clipper-design.md](2026-07-03-cross-clipper-design.md) (§6 defines the extension's role)
**Scope:** Phase 2 of the build order — the first GUI client, and the reference implementation of the design language for all later clients. All UI decisions below were validated interactively via mockups.

## 1. Summary

Manifest V3 browser extension (Chrome/Edge/Firefox) built with React + `@crossclipper/core`. The popup is the main surface: a device rail, a feed of card items, and a compose box. A background service worker holds the WebSocket, raises notifications, and provides the context-menu send. Sync follows the parent spec's pull-with-nudges model, which makes MV3's service-worker lifecycle a non-issue by design.

## 2. Validated UI decisions

Each decision was chosen from rendered alternatives during a visual brainstorming session.

| Decision | Choice | Rejected alternatives |
|---|---|---|
| Popup layout | **Sidebar rail** — persistent device rail left (Slack-style), feed + compose right | Chat-style filter chips on top; feed-first with bottom tabs |
| Feed items | **Cards with always-visible actions** — origin + time header, 2–3 content lines, kind-aware buttons | Compact hover-action rows; expandable rows |
| Theming | **System-adaptive** light/dark via design tokens, manual override | Fixed light; fixed dark |
| Palette | **Slate neutral chassis** (cool grays) + **user-selectable accent**, default **amber** | Warm stone, violet, graphite-mono fixed palettes |
| Onboarding | **Three steps: Server → Sign in → Appearance** (step 3 optional/skippable) | Single-screen form |
| Settings | **Tabs: Devices / Look / General** | Single scrolling page; master→detail drill-down (noted as the better pattern for mobile later) |

## 3. Popup

Approx. 380×540 px.

```
┌──────────────────────────────────────┐
│ ⧉ CrossClipper                    ⚙ │  header
├──────┬───────────────────────────────┤
│ All  │  ┌─────────────────────────┐  │
│ 💻 ● │  │ 📱 Pixel 8        2m ago │  │  device rail (left):
│ 📱   │  │ https://example.com/…    │  │  "All" + one entry per
│ 🌐   │  │ [⧉ Copy] [↗ Open] [🗑]  │  │  device, presence dot,
│      │  └─────────────────────────┘  │  acts as feed filter
│      │  ┌─────────────────────────┐  │
│      │  │ 💻 Laptop         1h ago │  │  feed (right): cards,
│      │  │ meeting notes draft…     │  │  newest first, infinite
│      │  │ [⧉ Copy] [🗑]           │  │  scroll via cursor pages
│      │  └─────────────────────────┘  │
├──────┴───────────────────────────────┤
│ [ Type or paste…              ] [➤]  │  compose
└──────────────────────────────────────┘
```

- **Device rail:** "All" plus one entry per registered device (icon, short name, presence dot from WS presence). Clicking filters the feed by origin (`GET /items?origin=`). The rail is a *view filter*, never an address book (parent spec §1 non-goals).
- **Feed cards:** header (origin device icon + name, relative time), content (text, links styled and clickable, ~3-line clamp), actions by kind — `text`: Copy, Delete; `link`: Copy, Open, Delete. Unknown kinds render the parent spec's "unsupported item — update client" fallback card.
- **Copy** writes to the clipboard via `navigator.clipboard` (popup has focus, so no extra permission gymnastics) and shows brief inline confirmation ("Copied ✓" flash on the button).
- **Compose:** single-line input that grows to ~4 lines; Enter sends, Shift+Enter for newline. Above the input, the standard **target picker** (parent spec §4 notification policy): a row of device chips defaulting to "Silent" — selecting a chip makes that device the item's notification target. Sends go through core's outbox (optimistic render, retry on failure per parent spec §8). A paste-heavy workflow is primary: open popup → Ctrl+V → Enter.
- **New-item behavior:** items arriving over WS insert at the top with a subtle highlight; if the user has scrolled down, a "↑ new items" pill appears instead of yanking scroll position.

## 4. Onboarding flow

Three steps, shown when no auth token exists:

1. **Server** — URL input. On Next, calls `GET /health` and shows specific results: "✓ CrossClipper v1.2 found", or distinguishable errors (unreachable / TLS problem / not a CrossClipper server / server requires newer client). Warns loudly on plain `http://` for non-localhost/non-private addresses (parent spec §5). If the server reports no user exists (first run), step 2 becomes **account creation** instead of sign-in.
2. **Sign in** — email, password, device name (pre-filled suggestion like "Work laptop — Chrome" derived from OS + browser). Calls `POST /auth/login`, stores the device token.
3. **Appearance** (optional, skippable) — theme toggle (Light/Dark/Auto, default Auto), accent swatches (default amber preselected) + custom color wheel, live preview card that re-skins as you pick. Footer: Skip / "Start using CrossClipper".

## 5. Settings page

Opened via header ⚙; rendered as a full-popup page with a back arrow. Segmented tabs:

- **Devices** — server status card (host, ● Connected/Disconnected, server version, Sign out) pinned above the tab content; device list with rich rows: icon, name, "this device" badge, presence (online now / last seen), inline ✎ rename and ⊘ revoke. Devices unseen for a long period (default 14+ days) get a highlighted "Revoke?" nudge — security hygiene for a self-hosted tool.
- **Look** — theme toggle, accent swatches + custom color (same components as onboarding step 3).
- **General** — behavior toggles: notifications on new items; context-menu send. Room for future options (e.g., feed page size).

## 6. Extension architecture

```
clients/extension/
├── src/
│   ├── popup/            # React app: rail, feed, compose, settings, onboarding
│   ├── background/       # MV3 service worker: WS, notifications, context menu, badge
│   ├── shared/           # messaging contract between popup ↔ worker, storage helpers
│   └── theme/            # design tokens (CSS custom properties), light/dark, accent
├── manifest.json         # MV3, browser-polyfilled for Firefox
└── (build via Vite + @crxjs or equivalent MV3-aware bundler)
```

- **Single sync engine instance** lives in the **background service worker** (via `@crossclipper/core`): owns the WS connection, cursor, outbox, and an item cache in `chrome.storage.local`. The popup is a pure renderer talking to the worker over runtime messaging; opening the popup triggers a `refresh` (pull from cursor). This avoids two competing sync engines and makes popup startup instant (render from cache, then reconcile).
- **MV3 lifecycle handling (by design, not workaround):** when the worker is killed idle, the WS drops. On any wake (popup open, alarm, notification click), the worker re-instantiates core, which pulls from its persisted cursor — the parent spec's single recovery path. A periodic `chrome.alarms` tick (~1 min) gives passive freshness for notifications without a persistent connection.
- **Auth token** in `chrome.storage.local` (not `sync` — the device identity is per-browser-profile by definition).
- **Notifications:** per the parent spec's notification policy — a browser notification is raised when this device is the item's `target_device_id` (always), or on any new item when the "notify me on new items" toggle (Settings → General, default off) is enabled. Clicking opens the popup. No content preview beyond a short snippet.
- **Context menu:** "Send selection to CrossClipper" on text selections (`kind: text`), "Send link to CrossClipper" on links (`kind: link`) — posts via the worker's outbox, confirmation via badge flash.
- **Toolbar badge:** unread count since the popup was last opened; cleared on open.

## 7. Design tokens (the cross-client design language)

Defined once in `src/theme/` as CSS custom properties; the token *names* are the contract that desktop and mobile will re-implement:

- **Neutrals (slate):** `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted` — each with light and dark values, switched by `prefers-color-scheme` with a manual override class.
- **Accent (user setting):** `--accent`, `--accent-fg`, `--accent-soft` (tinted background), derived at runtime from the user's chosen color (default amber `#d97706`). Stored in `chrome.storage.local`; applied before first paint to avoid flash. *Amended 2026-07-04:* `--accent-fg` is picked at the WCAG equal-contrast crossover (relative luminance 0.179) — whichever of dark/white text yields the higher contrast ratio. On the default amber this means dark text (6.6:1); white-on-amber was considered and rejected (3.2:1, fails AA for button-size text). Decision confirmed by Diego; applies to all clients deriving `--accent-fg`.
- **Semantic:** `--success` (presence, health), `--danger` (revoke, delete), radii and spacing scale.

Extraction into a shared `packages/ui` happens when the second web-technology client (desktop) needs the tokens — not before (YAGNI); the extension keeps them structured for that lift.

## 8. Error & edge states

- **Disconnected:** thin banner under the header ("Reconnecting…"); compose stays usable (outbox queues); rail presence dots gray out.
- **Auth revoked / 401:** single redirect to onboarding step 2 with the server pre-filled, per parent spec §8.
- **Empty feed:** friendly first-use hint ("Copy something on another device, or type below").
- **Send failure after retries:** item stays in feed marked "not sent — tap to retry".
- **Server version skew:** "server requires newer client" / "client requires newer server" full-width notice, from the `/api/v1` version handshake.

## 9. Testing

Per parent spec §9: the extension is thin, core logic is tested in `packages/core`.

- **Component tests** (vitest + testing-library): feed card rendering per kind (incl. unknown-kind fallback), rail filtering, compose behavior (Enter/Shift+Enter, optimistic render), onboarding step validation states, settings interactions.
- **One happy-path E2E** (Playwright with extension loading): onboard against a local test server → send text → item appears → copy → filter by device.
- **Messaging contract tests:** popup↔worker message schemas, so refactors in either side fail fast.

## 10. Out of scope (this phase)

- Media/blob rendering (thumbnails, downloads) — protocol slots exist; UI comes with the media phase.
- Clipboard capture in the browser — explicitly out per parent spec §11; desktop owns capture via its global hotkey.
- Firefox-for-Android — desktop browsers only for now.
- Store publication (listing assets, review process) — handled when Phase 2 ships; development uses unpacked loading.
