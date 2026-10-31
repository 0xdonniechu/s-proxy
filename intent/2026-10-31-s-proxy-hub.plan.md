# Plan: s-proxy — Hybrid Surfshark VPN Proxy Hub kết nối GoLogin (Windows)

Intent: `intent/2026-10-31-s-proxy-hub.md` (`status: approved`).
Tracker: Plane project `SProxy` (`SPX`, ID `f2399cf3-c3eb-4f1f-a575-d42af01f17d3`) in workspace `stupidrich`.

---

## Architecture & Review Trước Khi Code

### Product Review
- **1-Port Dual Protocol (SOCKS5 + HTTP trên cùng 1 cổng)**: Tự động nhận diện byte đầu tiên trên mỗi cổng `127.0.0.1:<port>` (`0x05` → SOCKS5/SOCKS5h; ASCII method → HTTP `CONNECT` / HTTP proxy). Người dùng cấu hình loại `SOCKS5` hay `HTTP` trong GoLogin đều chạy được trên cùng 1 port.
- **4 khu vực thao tác gọn trên 1 cửa sổ Tauri (Tray-first)**:
  1. **Proxy Hub**: Danh sách các Proxy Slot đang có (Chế độ 1 `Adapter Bridge` + Chế độ 2 `Userspace WireGuard`), nút Start/Stop, Check IP & Leak, Copy `socks5://` / `http://`, và gắn nhanh vào GoLogin Profile.
  2. **Surfshark Locations (180 servers)**: Đọc trực tiếp `C:\ProgramData\Surfshark\general_locations.dat` (142) + `static_locations.dat` (38), lọc theo quốc gia/thành phố/tải (`load%`), bấm 1 nút tạo ngay Proxy Slot cho quốc gia đó.
  3. **GoLogin Profiles**: Liệt kê các profile từ GoLogin API, hiển thị proxy hiện tại của từng profile và nút **Sync Proxy** từ bất kỳ Slot nào sang GoLogin.
  4. **Settings**: Nhập/import Surfshark WireGuard `PrivateKey` (hoặc chọn file `.conf` mẫu), địa chỉ tunnel (mặc định `10.14.0.2/16`), quản lý/tải tự động sidecar `wireproxy.exe`, nhập GoLogin API Token, đổi ngôn ngữ `VI`/`EN`.

### Technical Review ("Cái gì có thể gãy?")
1. **Rò rỉ IP/DNS về mạng thật (VNPT `Wi-Fi`) trên Windows**:
   - Windows dùng *Weak Host Model*: chỉ `bind(adapter_ip)` là chưa đủ nếu metric của `Wi-Fi` thấp hơn.
   - **Cách chặn (HARD)**: Trên mọi socket của `AdapterBridge`, vừa `bind(adapter_ipv4:0)` vừa gọi `setsockopt(IPPROTO_IP, IP_UNICAST_IF, htonl(if_index))`. Với truy vấn tên miền (`SOCKS5 ATYP=0x03` hoặc `HTTP CONNECT host:port`), tự phân giải DNS bằng gói tin DNS qua chính socket gắn `IP_UNICAST_IF` đó (tới DNS Surfshark `162.252.172.57` / `1.1.1.1`), tuyệt đối không gọi `getaddrinfo` mặc định của hệ điều hành.
2. **Nhầm `wt0` (NetBird `100.87.25.169`) hoặc `Wi-Fi` thành Surfshark**:
   - **Cách chặn (HARD/MEDIUM)**: Bộ phân loại adapter tách bạch 3 nhóm: `Surfshark` (mô tả/tên chứa `Surfshark`, hoặc `Wintun` có IP dải `10.14.0.0/16`), `OtherVpn` (`wt0` NetBird `100.64.0.0/10`, Tailscale — cảnh báo rõ, không tự chọn mặc định), và `PrimaryIsp` (interface giữ default route `0.0.0.0/0` như `Wi-Fi` `192.168.3.4` — bị **cấm** dùng làm nguồn VPN để không bao giờ lộ IP gốc).
3. **Egress Verification (Chốt chặn thứ 2)**:
   - Khi bấm `Check IP` (hoặc tự kiểm tra sau khi bật Slot), nếu Exit IP trả về trùng với Host ISP IP (`Wi-Fi`), Slot lập tức chuyển sang trạng thái `LeakBlocked` và ngắt nhận lưu lượng.

---

## Files (theo thứ tự làm, Task Rating & Gemini Ecosystem Model Mapping)

| Role trong Coding 5.5 | Claude (`CLAUDE.md`) | Gemini / Antigravity (`GEMINI.md`) | OpenAI Codex (`AGENTS.md`) |
|---|---|---|---|
| **Main Session** (Decide, Gate, HARD code) | **Opus 5.5** (`claude-opus-5-5`) | **Gemini 4 Argon (High)** (`"inherit"`) | **GPT-6-Astra** (`gpt-6-astra`) |
| **`hard-reviewer`** (Review độc lập chéo model cho HARD) | **Fable 5.1** | **Gemini 3.1 Pro Preview** (`Model: "pro"`) | **GPT-6.1 Terra** (`gpt-6.1-terra`) |
| **`builder`** (Implement MEDIUM) | **Sonnet 5.5** | **Gemini 3.8 Flash** (`Model: "flash"`) | **GPT-6.1-Sol** (`gpt-6.1-sol`) |
| **`reviewer`** (Review độc lập chéo model cho MEDIUM) | **Opus 5.5** | **Gemini 4 Argon (High)** (`"inherit"`) | **GPT-6-Astra** (`gpt-6-astra`) |
| **`transcriber`** (Copy, CSS, Docs cho EASY) | **Haiku 5.5** | **Gemini 3.5 Flash-Lite** (`"flash_lite"`) | **GPT-6-Luna** (`gpt-6-luna`) |

1. **[EASY — `transcriber` (`flash_lite` / 3.5 Flash-Lite)] Scaffold & Config (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`)**
   - Khởi tạo khung Tauri 2 (Rust 2021 + Vanilla TS + Vite), cấu hình tray icon, single-window compact (920×660), CSP khoá chặt.
2. **[HARD — Main (`Gemini 4 Argon High`) + `hard-reviewer` (`pro` / 3.1 Pro)] `src-tauri/src/settings.rs` — Lưu trữ trạng thái & cấu hình an toàn**
   - Structs: `AppSettings` (`wg_private_key`, `wg_address` default `"10.14.0.2/16"`, `wg_dns` default `"162.252.172.57"`, `gologin_token`, `base_port` default `10800`, `allow_lan` default `false`, `language` default `Vi`), `ProxySlotConfig` (`id`, `name`, `port`, `mode`: `AdapterBridge` | `UserspaceWg`, `location_id`, `connection_name`, `pub_key`, `adapter_hint`, `linked_gologin_profile_id`, `auto_start`), `PersistedState`.
   - Hàm `parse_wg_conf(text: &str)` trích xuất `PrivateKey`, `Address`, `DNS`, `Endpoint`, `PublicKey` từ file `.conf` mẫu của Surfshark.
   - Lưu/đọc atomic (`state.json.tmp` → rename `state.json`) với `#[serde(default)]`. Mask secret khi xuất log/UI.
   - Unit tests: round-trip serde, tương thích file cũ thiếu key, parser `.conf` mẫu, validate dải port `1024..=65535` và trùng port.
3. **[MEDIUM — `builder` (`flash` / 3.8 Flash) + `reviewer` (`inherit` / 4 Argon High)] `src-tauri/src/surfshark.rs` — Đọc danh mục 180 server Surfshark & Phát hiện Adapter Windows**
   - Đọc `C:\ProgramData\Surfshark\general_locations.dat` và `static_locations.dat` (fallback `%APPDATA%\Surfshark\*.dat`), parse JSON thành `Vec<SurfsharkLocation>` (`id`, `country`, `country_code`, `location`, `region`, `load`, `connection_name`, `pub_key`, `location_type`: `Generic` | `Static`).
   - Phát hiện network adapters trên Windows (qua PowerShell/Win32 `Get-NetAdapter` + `Get-NetIPAddress` + `Get-NetRoute` hoặc bảng IP): phân loại chính xác `AdapterKind::Surfshark`, `AdapterKind::OtherVpn` (`wt0` NetBird), `AdapterKind::PrimaryIsp` (`Wi-Fi`/`Ethernet`).
   - Unit tests: parse JSON mẫu của `general_locations.dat`, phân loại adapter (`Wi-Fi` default route vs `wt0` `100.87.25.169` vs Surfshark Wintun `10.14.0.2`).
4. **[HARD — Main (`Gemini 4 Argon High`) + `hard-reviewer` (`pro` / 3.1 Pro)] `src-tauri/src/proxy_engine.rs` — Lõi Dual-Protocol Proxy (SOCKS5 + HTTP CONNECT), `IP_UNICAST_IF` Binding, Tunnel DNS & Fail-Closed Kill-Switch**
   - Listener trên `127.0.0.1:<port>` (hoặc `0.0.0.0:<port>` khi bật LAN).
   - Tự động phân nhánh theo byte đầu tiên:
     - `0x05`: SOCKS5 no-auth (`CONNECT` IPv4, IPv6, Domain `ATYP=0x03`).
     - ASCII: HTTP `CONNECT host:port` và HTTP forward proxy cơ bản.
   - Hai kiểu Upstream Dialer:
     - `BoundAdapterDialer { adapter_ip, if_index, dns_server, primary_isp_ip }`: Kiểm tra `adapter_ip != primary_isp_ip`, tạo `socket2::Socket`, bind `adapter_ip:0`, đặt `IP_UNICAST_IF = htonl(if_index)` trên Windows, tự phân giải DNS A-record qua UDP/TCP gắn `IP_UNICAST_IF` trước khi kết nối TCP đích. Nếu adapter mất hoặc lỗi → đóng kết nối ngay (fail-closed).
     - `UpstreamSocks5Dialer { internal_addr }`: Chuyển tiếp toàn bộ kết nối (giữ nguyên tên miền `ATYP=0x03` để tránh DNS leak) sang tiến trình `wireproxy` nội bộ (`127.0.0.1:<internal_port>`).
   - Unit tests: SOCKS5 handshake + domain connect, HTTP `CONNECT` tunnel, fail-closed khi adapter IP trùng ISP IP hoặc adapter down.
5. **[HARD — Main (`Gemini 4 Argon High`) + `hard-reviewer` (`pro` / 3.1 Pro)] `src-tauri/src/wireguard.rs` — Quản lý tiến trình Userspace WireGuard (`wireproxy`)**
   - Sinh cấu hình `wireproxy` tạm thời cho từng Slot từ `wg_private_key` + `SurfsharkLocation { connection_name, pub_key }` (Endpoint `<connection_name>:51820`, `[Socks5] BindAddress = 127.0.0.1:<internal_port>`).
   - Quản lý vòng đời tiến trình con (`CREATE_NO_WINDOW` trên Windows), tự dọn dẹp khi Stop Slot hoặc khi thoát App (`Quit`), và hỗ trợ tải tự động binary `wireproxy.exe` chính thức từ GitHub Releases nếu máy chưa có.
   - Unit tests: render file cấu hình `wireproxy`, kiểm tra chặn key rỗng/không hợp lệ.
6. **[HARD — Main (`Gemini 4 Argon High`) + `hard-reviewer` (`pro` / 3.1 Pro)] `src-tauri/src/gologin.rs` — Đồng bộ GoLogin API & Kiểm tra Egress IP/Leak**
   - GoLogin REST client (`https://api.gologin.com`):
     - `list_profiles(token)`: Lấy danh sách profile (`id`, `name`, `os`, `proxy` hiện tại).
     - `update_profile_proxy(token, profile_id, mode, host, port)`: Gọi `PATCH https://api.gologin.com/browser/{id}/proxy` với payload chuẩn (`{ mode: "socks5"|"http", host: "127.0.0.1", port, username: "", password: "" }`) để chỉ cập nhật proxy mà không đụng tới vân tay trình duyệt (fingerprint) của profile.
   - `check_slot_egress(local_port, host_isp_ip)`: Kết nối qua chính `127.0.0.1:<local_port>` tới `https://ipinfo.io/json` (fallback `https://api.ipify.org?format=json`), đo latency (ms), lấy `ip`, `country`, `city`, `org`, và so sánh với `host_isp_ip` để gắn cờ `Safe` hoặc `LeakBlocked`.
   - Unit tests: tạo payload JSON của GoLogin proxy patch, kiểm tra logic phát hiện leak (`exit_ip == host_isp_ip`).
7. **[HARD — Main (`Gemini 4 Argon High`) + `hard-reviewer` (`pro` / 3.1 Pro)] `src-tauri/src/lib.rs` & `src-tauri/src/main.rs` — Tauri State, Commands & Tray Lifecycle**
   - Quản lý `AppState` (slots, runtime handles, cached locations, cached GoLogin profiles, host IP).
   - Tauri commands: `get_hub_snapshot`, `save_settings`, `import_wg_conf`, `refresh_adapters_and_locations`, `create_slot`, `toggle_slot`, `delete_slot`, `check_slot_ip`, `check_all_slots`, `fetch_gologin_profiles`, `assign_slot_to_gologin`, `install_wireproxy`.
   - Tray menu (`Open s-proxy`, `Start All Slots`, `Stop All Slots`, `Quit`): đóng cửa sổ (`CloseRequested`) chỉ ẩn xuống khay hệ thống; bấm `Quit` mới dừng toàn bộ proxy & thoát.
8. **[MEDIUM — `builder` (`flash` / 3.8 Flash) + `reviewer` (`inherit` / 4 Argon High)] `src/types.ts`, `src/strings.ts`, `src/main.ts` — Giao diện Vanilla TypeScript**
   - Chỉ nhận `HubSnapshot` từ Rust và gửi lệnh `invoke()`. Không tính toán mạng ở JS.
   - 4 tab trực quan: `Proxy Hub`, `Surfshark (180 Servers)`, `GoLogin Sync`, `Settings`, hỗ trợ song ngữ Việt/Anh (`VI` mặc định), nút Copy nhanh `socks5://` / `http://`.
9. **[EASY — `transcriber` (`flash_lite` / 3.5 Flash-Lite)] `src/styles.css`, `README.md` & `SPEC.md`**
   - Giao diện CSS native dark/light gọn nhẹ, tài liệu kiến trúc, cơ chế chống rò rỉ IP/DNS (Fail-closed `IP_UNICAST_IF` + Userspace WireGuard), và hướng dẫn kết nối Surfshark + GoLogin.

---

## Risks & Cách Kiểm Bắt Được

| Rủi ro | Cách phòng ngừa & Kiểm bắt |
|---|---|
| Adapter Surfshark đang tắt nhưng Slot vẫn chạy và đẩy lưu lượng qua `Wi-Fi` thật | Bắt buộc kiểm tra `adapter_ip != primary_isp_ip` + đặt `IP_UNICAST_IF` + test unit `fail_closed_when_adapter_matches_isp`. |
| DNS query của trình duyệt GoLogin rò rỉ qua DNS VNPT | Cả SOCKS5 (`ATYP=0x03`) và HTTP `CONNECT` đều phân giải tên miền bên trong tunnel (qua DNS socket gắn `IP_UNICAST_IF` hoặc đẩy thẳng tên miền qua `wireproxy`). |
| Gán proxy vào GoLogin làm mất cấu hình vân tay (Canvas/WebGL/Navigator) của profile | Chỉ dùng endpoint chuyên biệt `PATCH /browser/{id}/proxy` (hoặc merge trên object proxy), kiểm tra bằng unit test contract payload. |
| Lộ `PrivateKey` hoặc `gologin_token` trong git commit | `.gitignore` chặn `state.json`/`*.conf`/`*.key`; chạy lệnh kiểm tra `git grep -iE "PrivateKey\s*=|gl_eyJ|Bearer eyJ"` phải ra 0 hit. |

---

## Proof (Định nghĩa "Xong" trước khi gõ code)

1. `cargo test --manifest-path src-tauri/Cargo.toml` — Toàn bộ unit tests cho `settings`, `surfshark` (đọc thật 180 locations trên máy), `proxy_engine` (SOCKS5 + HTTP CONNECT + fail-closed kill-switch), `wireguard` config generator, `gologin` payload & leak detector đều **PASS**.
2. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — **PASS (0 warnings)**.
3. `npm run build` (`tsc --noEmit` strict + `vite build`) — **PASS**.
4. Kiểm tra rò rỉ bí mật: `git grep -iE "PrivateKey\s*=|gl_eyJ|Bearer eyJ"` — **0 hits**.
5. Independent Review (`hard-reviewer` / `reviewer` subagent) kiểm tra toàn bộ diff đối chiếu với `intent` + `plan` — **PASS**.
6. Các kiểm thử `Owner-only` (ghi rõ trạng thái trong báo cáo cuối): bật Surfshark thật trên máy, nhập WireGuard `PrivateKey` & `GoLogin Token` của owner, mở profile GoLogin kiểm tra trên `ipinfo.io` / `whoer.net`.

---

## Review Log (Coding 5.5 Loop)

- **`hard-reviewer` (`Gemini 3.1 Pro Preview`) trên cụm HARD (`settings.rs`, `proxy_engine.rs`, `wireguard.rs`, `gologin.rs`, `lib.rs`, `main.rs`)**:
  - Round 1: `FAIL` (1 BLOCKER case mismatch `bytes_Transferred` vs `bytes_transferred`, 2 MAJOR: hàm dư `handle_socks5_client` và dọn file `runtime/wg-*.conf` tồn đọng sau crash khi khởi động app, 1 MINOR đồng bộ tên command `refresh_system_state`).
  - Round 2: Đã sửa toàn bộ (thêm `cleanup_stale_runtime_configs()` ngay trong `HubCore::new()`) → **`PASS`**.
- **`reviewer` (`Gemini 4 Argon High`) trên Step 3 MEDIUM (`surfshark.rs`)**:
  - Round 1: `FAIL` (1 BLOCKER lỗi escape `\"[$json]\"` trong raw string PowerShell, 1 MAJOR thứ tự ưu tiên phân loại `OpenVPN Data Channel Offload` và `OtherVpn`, 1 MINOR bổ sung test live adapter).
  - Round 2: Đã sửa + khử lint `clippy::if_same_then_else` → **`PASS`**.
- **`reviewer` (`Gemini 4 Argon High`) trên Step 8 MEDIUM (`src/types.ts`, `src/strings.ts`, `src/main.ts`)**:
  - Round 1: `FAIL` (2 MAJOR: fallback `linkedGologinProfileId` khi bấm Sync ngay không đổi dropdown, và giữ `#toast-container` khi chuyển tab sau `create_slot`; 1 MINOR: giữ trạng thái `selected` của dropdown trên tab GoLogin).
  - Round 2: Đã sửa toàn bộ → **`PASS`**.
