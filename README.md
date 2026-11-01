# s-proxy — Hybrid Surfshark VPN Proxy Hub for GoLogin (Windows & macOS)

A Tauri 2 tray-first application that turns Surfshark VPN into local SOCKS5/HTTP proxy endpoints (`127.0.0.1:<port>`) and synchronizes them directly to GoLogin browser profiles. Designed for cross-platform Windows and macOS environments.

## Overview of Modes

1. **Adapter Bridge Mode (`127.0.0.1:10800`)**
   - Binds directly to Surfshark's active network adapter IP (`IP_UNICAST_IF` on Windows via Wintun/OpenVPN or `IP_BOUND_IF` on macOS via `utun` NetworkExtension interfaces detected via `ifconfig -v` & `netstat`) + tunnel DNS.
   - Features a fail-closed kill-switch, ignoring non-Surfshark adapters and virtual network interfaces such as NetBird (`wt0`).

2. **Multi-Proxy Userspace WireGuard Mode (`127.0.0.1:10801+`)**
   - Parses Surfshark's local catalog entries (`general_locations.dat`, `static_locations.dat`, or macOS `/Applications/Surfshark.app/Contents/Resources/clusters.json`).
   - Spawns parallel userspace WireGuard proxy slots via `wireproxy` (with Darwin arm64/amd64 and Windows auto-installer support) so multiple GoLogin browser profiles can operate simultaneously across different country IPs.

## Build & Verify Commands

- **Rust Unit Tests**: `cargo test --manifest-path src-tauri/Cargo.toml`
- **Clippy Lint**: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- **Frontend Build**: `npm run build`
- **Tauri Package**: `npm run tauri build` (`.app`/`.dmg` on macOS, NSIS/MSI on Windows)
