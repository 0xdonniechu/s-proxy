# s-proxy Specification & Security Architecture (Cross-Platform Windows & macOS)

## 1. Dual-Protocol Port Auto-Detection
Each proxy slot listens on `127.0.0.1:<port>` and automatically detects incoming SOCKS5 (`0x05` handshake supporting `NO AUTH` and `USERPASS`) and HTTP `CONNECT` tunneling requests on the same port without requiring separate listening ports.

## 2. Anti-Leak Guarantees on Windows & macOS
- **Strong Host Binding**: Sockets are bound explicitly to the Surfshark adapter IP via `IP_UNICAST_IF` / `IPV6_UNICAST_IF` on Windows (`Wintun`/`OpenVPN`) or `IP_BOUND_IF` on macOS (`utun` NetworkExtension interfaces detected via `ifconfig -v` & `netstat`), preventing fallback to host network interfaces (`Wi-Fi`, `Ethernet`) or virtual adapters like NetBird (`wt0`).
- **Encrypted Tunnel DNS**: Custom RFC 1035 DNS A-record resolution is performed exclusively inside the VPN tunnel, eliminating host DNS leaks.
- **Fail-Closed Kill-Switch**: If the Surfshark adapter drops or WireGuard handshake fails, egress traffic is immediately severed.
- **Verification**: Periodic egress checks via `ipinfo.io` validate external IP and ISP blocklists.

## 3. GoLogin API Synchronization Contract
- **Endpoint**: `PATCH https://api.gologin.com/browser/{id}/proxy`
- **Payload Guarantee**: Updates only proxy connection parameters (`mode`, `host`, `port`, `username`, `password`) while strictly preserving existing user profile fingerprint settings.

## 4. Tray-First Lifecycle
- **Minimize to Tray**: Closing the main application window hides it to the system tray rather than terminating background proxy slots.
- **Quit Lifecycle**: Selecting "Quit" from the tray menu cleanly stops all local proxy listeners, terminates `wireproxy` subprocesses, and releases system resources.
