# CrossClipper — Windows Desktop Client Design

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation
**Parent spec:** [2026-07-03-cross-clipper-design.md](2026-07-03-cross-clipper-design.md) (§6, as amended 2026-07-03: hotkey capture, no clipboard watching)
**Sibling spec:** [2026-07-03-extension-client-design.md](2026-07-03-extension-client-design.md) — the design language (§2, §7) and screen designs it defines are inherited here, not re-decided.
**Scope:** Phase 3 of the build order — Tauri + React app for Windows (architecture kept portable to macOS/Linux later).

## 1. Summary

A 24/7 tray-resident Tauri app with three surfaces: a **quick flyout** (tray click / hotkey) for the 90% case, a **full window** for history/devices/settings, and a **capture toast**. Its defining feature is deliberate, hotkey-triggered clipboard capture — one keystroke and the clipboard is on every device, with an undo window. There is no passive clipboard watching (parent spec §1 non-goals, amended).

## 2. Validated UI decisions

| Decision | Choice | Rejected alternatives |
|---|---|---|
| App shape | **Quick flyout + full window** — flyout for glance/paste, full window for history, devices, settings | Tray-flyout only; single main window + tray menu |
| Capture model | **Dedicated global hotkey → sync → toast with 5s Undo** (amends parent spec: no clipboard watching) | Silent auto-watch on every copy; watch + undo toast; opt-in-per-copy toast |
| Manual input | Flyout compose accepts paste; dashed **drop zone** for files/images (visible, disabled until media phase) | — |
| Default hotkeys | **Ctrl+Alt+C** capture, **Ctrl+Alt+V** flyout — both configurable (Ctrl+Shift+C rejected: collides with terminal copy / browser devtools) | — |

Design language (slate chassis, system-adaptive light/dark, user accent defaulting to amber, card items, rail-as-filter, tabbed settings, 3-step onboarding) is inherited from the extension spec §2/§7 as-is.

## 3. Surfaces

### Quick flyout (tray click or Ctrl+Alt+V)

Small window anchored near the tray, closes on focus loss:

- Header: app name + "Open full app ↗"
- Last ~5 feed items as compact cards (copy is the primary action)
- Compose box (paste + Enter) with the standard target picker (device chips, default "Silent" — parent spec §4 notification policy)
- Drop zone: "⇣ drop files or images here" — dashed target, disabled with a "(media phase)" hint until blobs ship

### Full window

Resizable window using the extension's popup layout, roomier: device rail left, feed + compose right, ⚙ opens tabbed settings. Close (✕) hides to tray; the app keeps running. Settings adds a desktop-only **Capture** tab: hotkey bindings, toast on/off + duration, launch-at-login.

### Capture toast

Bottom-right system-corner toast on successful capture: "⧉ Synced · <snippet> · [Undo] · 5s". Undo performs the standard soft delete (`DELETE /items/{id}`), so an undone capture disappears from all devices via the normal tombstone path. Failure states use the same toast surface ("not synced — queued", see §6).

### Tray

- Left-click: flyout. Icon badge/blink on new items (cleared on flyout open).
- Right-click menu: Open CrossClipper · Capture hotkey enabled ✓ · Pause 1 hour · Settings · Quit.
- "Pause" disables the capture hotkey registration (visual state on the icon), auto-re-enables after the interval.

## 4. Capture pipeline

On Ctrl+Alt+C:

1. Read the clipboard (Rust side).
2. **Sensitive-content guard:** if the clipboard carries the Windows `ExcludeClipboardContentFromMonitoringProcessing` format (set by password managers), show a "not captured — marked sensitive" toast and stop. Not configurable.
3. Text present → normalize (trim trailing whitespace), classify `text` vs `link` (single URL ⇒ `link`), enforce the 256 KB cap client-side, hand to core's outbox (ULID idempotency, retry) → toast with Undo on ack, "queued — offline" toast when the outbox can't deliver yet. Hotkey captures are always **untargeted** (silent sync; no picker UI on the speed path) — targeting is available in the flyout compose.
4. Non-text clipboard (image/files) → "images & files come in a later version" toast (media phase flips this to blob upload).
5. Empty clipboard → gentle "clipboard is empty" toast.

## 5. Architecture

```
clients/desktop/
├── src-tauri/            # Rust shell: tray, global hotkeys, clipboard read,
│   │                     #   sensitive-format check, autostart, single-instance,
│   │                     #   window management (flyout anchor/focus-loss), notifications
│   └── (thin: no business logic — emits events / exposes commands)
├── src/                  # React app (webview): reuses @crossclipper/core
│   ├── background/       # hidden window: THE sync engine instance (WS, cursor, outbox, cache)
│   ├── flyout/           # flyout window renderer
│   ├── main/             # full window renderer (rail, feed, settings, onboarding)
│   └── theme/            # same token names as extension §7 (extraction to packages/ui when built)
└── (Vite; Tauri v2)
```

- **Same topology as the extension, deliberately:** exactly one sync-engine instance (`@crossclipper/core`) lives in a hidden always-running background window; flyout and main windows are pure renderers fed over Tauri events (mirror of extension popup ↔ service worker). No competing engines, and the background window never gets killed the way MV3 workers do — the WS stays genuinely live, making desktop the most real-time client.
- **Rust shell stays thin:** OS integration only (hotkeys via global-shortcut plugin, clipboard, tray, autostart, single-instance enforcement). Capture events cross into the webview as `{text}` payloads; all protocol logic is TS in core.
- **State storage:** token + settings + item cache via Tauri's store/fs in the app-data dir.
- Launch at login: default **on** (it's a sync tool), toggleable in Settings → Capture. Single instance enforced: second launch focuses the existing app.

## 6. Error & edge states

Inherits the extension spec §8 set (disconnected banner, 401 → re-onboard, empty feed, unsent-item retry, version-skew notice), plus capture-specific:

- **Offline capture:** outbox queues; toast says "queued — will sync when connected"; tray icon shows a subtle pending state until flushed.
- **Undo of a queued (unsent) capture** cancels it locally without a server round-trip.
- **Hotkey registration conflict** (another app owns the combo): non-blocking notification linking to Settings → Capture to rebind.

## 7. Testing

- **Component tests (vitest):** flyout rendering, capture-toast states (synced/queued/sensitive/empty/unsupported), settings Capture tab, hotkey-rebind UI.
- **Rust unit tests:** clipboard classification and sensitive-format detection behind a trait so the Windows API is mockable.
- **Core reuse:** sync/outbox scenarios already covered in `packages/core` — not duplicated here.
- **Manual smoke checklist** per release (hotkeys, tray, autostart, undo, offline queue) — honest solo-dev scope; `tauri-driver` E2E is a later nicety.

## 8. Out of scope (this phase)

- Media drop-zone activation, thumbnails, file upload — media phase (the drop target ships visibly disabled).
- Per-app capture exclusions and content-pattern filters — later Capture-tab additions.
- macOS/Linux builds — Windows first; the Rust shell isolates every OS-specific piece to keep ports contained.
- Store/installer polish beyond a signed GitHub-Releases installer.
