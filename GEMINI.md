# s-proxy: Local Hybrid VPN Proxy Hub for Surfshark & GoLogin on Windows

## What it does
A Tauri 2 tray-first app that turns Surfshark VPN into local SOCKS5/HTTP proxy endpoints (`127.0.0.1:<port>`) and syncs them to GoLogin profiles. Supports both binding to Surfshark's active Windows adapter and spawning parallel userspace WireGuard proxies from Surfshark's 180 local server entries (`general_locations.dat`/`static_locations.dat`). A bug costs an IP/DNS leak to the host ISP (`VNPT`) on a GoLogin browser profile, broken profile proxy assignment, or leaked credentials. Implementation rules are in `AGENTS.md`.

## Verify
- Unit: `cargo test --manifest-path src-tauri/Cargo.toml` (not run: scaffold pending plan approval)
- Lint: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` (not run: scaffold pending)
- Frontend: `npm run build` (not run: scaffold pending)
- Package: `npm run tauri build` (not run: scaffold pending)
- Owner-only on real Windows hardware: live Surfshark adapter egress check, multi-tunnel WireGuard handshake with owner PrivateKey, GoLogin profile launch & browser IP/DNS check (`ipinfo.io`/`whoer.net`), tray close/quit lifecycle.

## HARD: the main session does it directly, then hard-reviewer
- Proxy egress binding & fail-closed kill-switch: socket binding to Surfshark adapter IP / userspace WireGuard netstack; must never fall back to host default route (`Wi-Fi`/`Ethernet`).
- DNS resolution inside proxy slots: SOCKS5 (`ATYP=DOMAIN`) and HTTP `CONNECT` must resolve DNS through the tunnel/remote proxy, never leaking via host DNS.
- Userspace WireGuard lifecycle, config generation, and credential storage (WireGuard PrivateKey, GoLogin API token).
- GoLogin API proxy-update payload contract (`PATCH /browser/{id}/proxy`) so existing profile fingerprint settings are never overwritten.
- Rust/TS IPC contract (`HubSnapshot`, `ProxySlot`, `SettingsPayload`), `capabilities/`, and CSP.

## MEDIUM: builder builds, reviewer reviews
- Surfshark local catalog parser (`general_locations.dat`, `static_locations.dat`) and adapter detector (`Wintun` / `OpenVPN` vs NetBird `wt0`).
- Proxy health/IP checker (`ipinfo.io` / `api.ipify.org` through each local port) and latency ping.
- UI views (Proxy Hub table, Surfshark Location Picker, GoLogin Profile Linker, Settings) and tray menu.

## EASY: transcriber or builder, no review
- CSS styling, copy-to-clipboard formatting (`socks5://127.0.0.1:port`), labels, README and SPEC prose.

## Rules
- Never silently change default port ranges (`10800..10899`), bind address (`127.0.0.1` only by default), or fail-closed leak rules. Flag it and ask.
- Never commit `.conf`, `.key`, `.ovpn`, or GoLogin tokens. This grep must stay at 0 hits: `git grep -iE "PrivateKey\s*=|gl_eyJ|Bearer eyJ"`
- No React, Vue, Tailwind, SQLite, or telemetry (see `AGENTS.md`). A new dependency is a question, not a decision.
- Git: account `0xdonniechu`, author `0xdonniechu <211609259+0xdonniechu@users.noreply.github.com>`. One branch per change, merged to `main` only when asked.
- Plane: project `SProxy` (identifier `SPX`, ID `f2399cf3-c3eb-4f1f-a575-d42af01f17d3`) in workspace `stupidrich`. Vietnamese titles/comments; English code/terms. Commit messages never cite `SPX-n`; Plane comments cite the commit.

## Session state
- Work in progress lives in `HANDOFF.md` (gitignored). If it exists at session start, read it first. Update with `/handoff` before `/clear`; delete once finished.
