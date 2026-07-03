# CrossClipper

Self-hosted clipboard & share sync across your own devices — Windows, iOS, Android, and a browser extension — backed by a single server you run yourself. Think Pushbullet, but yours.

> **Status: under construction.** The server API is being built (auth, devices, items, realtime are in). No client apps exist yet; nothing here is ready to self-host. Watch this space.

## How it works

- **One server, one feed.** Every device sees every item you share (text now; images & files planned). The device list filters the view; it's never an address book.
- **Deliberate capture.** Nothing watches your clipboard silently. On desktop you press a capture hotkey; on mobile you use the share sheet; everywhere else you paste into a compose box.
- **Targeted notifications.** Items sync everywhere, but *you* choose which device (if any) gets alerted — silent-by-default.
- **Pull-based sync with live nudges.** Clients catch up with a cursor pull; WebSocket and push are wake signals, never the source of truth. Push payloads are content-free — clipboard content never transits Apple/Google.
- **Self-hosting as a feature.** Single Docker image, non-root, one `/data` folder to back up, SQLite by default, Postgres/S3 by config.

## Architecture

```
   Browser ext      Windows (Tauri)    iOS / Android (RN)
        └────────────────┬────────────────────┘
              @crossclipper/core (shared TS)
        typed API client · sync engine · outbox
                         │  HTTPS + WSS (OpenAPI contract)
                ┌────────┴────────┐
                │ FastAPI server  │  REST /api/v1 · WS · push relay
                │ SQLite→Postgres │  blobs: FS→S3
                └─────────────────┘
```

Full design docs live in [`docs/superpowers/specs/`](docs/superpowers/specs/) — start with the [system design](docs/superpowers/specs/2026-07-03-cross-clipper-design.md).

## Development

```bash
cd server
uv sync
uv run pytest         # test suite
uv run ruff check .   # lint
```

CI runs lint + tests on every PR. The build proceeds in phases (see the system spec §10): server + shared core → browser extension → Windows → mobile → push → media.

## License

[AGPL-3.0-or-later](LICENSE). You can use, modify, and self-host CrossClipper freely; if you run a modified version as a network service, you must make your modified source available to its users.
