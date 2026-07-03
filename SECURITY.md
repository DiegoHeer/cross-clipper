# Security Policy

## Supported versions

CrossClipper is pre-release software under active development. There are no supported release lines yet; security fixes land on `main`.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately via [GitHub's private vulnerability reporting](https://github.com/DiegoHeer/cross-clipper/security/advisories/new) ("Report a vulnerability" on the Security tab). You'll get a response as soon as possible, typically within a few days.

Relevant scope: the sync server (auth, token handling, per-user isolation, WebSocket auth), the clients' handling of server data, and the self-hosting deployment defaults (Docker, `/data` permissions).

## Design notes for researchers

- Trust model (MVP): TLS in transit + user-owned server. There is deliberately **no end-to-end encryption** yet — see the system design spec §5 in `docs/superpowers/specs/`.
- Push payloads are content-free wake signals by design; clipboard content must never transit third-party push infrastructure.
