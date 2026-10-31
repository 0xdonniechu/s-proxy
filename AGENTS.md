# Instructions for Future Coding Agents

- This repository belongs to `0xdonniechu`.
- Keep the app lightweight, Windows-first, and tray-first (closing hides to tray; only explicit Quit exits and cleanly tears down proxy listeners).
- Keep all proxy networking, VPN interface detection, userspace WireGuard tunnel lifecycle, leak-guard checks, and GoLogin API calls in Rust (`src-tauri`).
- The Vanilla TypeScript frontend is strictly a renderer and command client (`Snapshots` in, `invoke` commands out).
- Do not introduce React, Vue, Next.js, Tailwind, state-management libraries, SQLite, or telemetry.
- Never allow silent fallback to the host's default ISP interface (`Wi-Fi`/`Ethernet`) when a proxy slot is bound to a VPN interface or WireGuard tunnel (fail-closed / kill-switch per proxy port).
- Never mistake non-Surfshark VPN interfaces (e.g., NetBird `wt0`, Tailscale) for Surfshark's adapter unless explicitly selected by the user.
- Never log, commit, or expose WireGuard `PrivateKey`, PresharedKey, or GoLogin API tokens in plaintext git files or UI error dumps.
- Persist local state atomically to `%APPDATA%` with `#[serde(default)]` backwards compatibility.
