# s-proxy — Hybrid Surfshark VPN Proxy Hub for GoLogin (Windows)

A Tauri 2 tray-first application that turns Surfshark VPN into local SOCKS5/HTTP proxy endpoints (`127.0.0.1:<port>`) and synchronizes them directly to GoLogin browser profiles. Designed specifically for Windows environments.

## Overview of Modes

1. **Adapter Bridge Mode (`127.0.0.1:10800`)**
   - Binds directly to Surfshark's active Windows Wintun or OpenVPN adapter IP (`IP_UNICAST_IF` + tunnel DNS).
   - Features a fail-closed kill-switch, ignoring non-Surfshark adapters and virtual network interfaces such as NetBird (`wt0`).

2. **Multi-Proxy Userspace WireGuard Mode (`127.0.0.1:10801+`)**
   - Parses Surfshark's 180 local catalog entries (`general_locations.dat` & `static_locations.dat`).
   - Spawns parallel userspace WireGuard proxy slots via `wireproxy` so multiple GoLogin browser profiles can operate simultaneously across different country IPs.

## Build & Verify Commands

- **Rust Unit Tests**: `cargo test --manifest-path src-tauri/Cargo.toml`
- **Clippy Lint**: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- **Frontend Build**: `npm run build`
- **Tauri Package**: `npm run tauri build`
