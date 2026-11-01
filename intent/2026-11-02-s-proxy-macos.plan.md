# Plan: s-proxy — Phát triển bản Native macOS (Apple Silicon & Intel)

Intent: `intent/2026-11-02-s-proxy-macos.md` (`status: verified`).
Tracker: Plane project `SProxy` (`SPX`, ID `f2399cf3-c3eb-4f1f-a575-d42af01f17d3`) in workspace `stupidrich`.

---

## Architecture & Review Trước Khi Code

### Technical Review ("Cái gì có thể gãy trên macOS?")
1. **Khác biệt Kernel Socket Binding & Non-blocking Connect trên Darwin (`proxy_engine.rs`)**:
   - Trên macOS, để ép gói tin đi ra đúng giao diện `utun` (bất kể bảng định tuyến chính), cần dùng `IP_BOUND_IF` thông qua `socket.bind_device_by_index_v4(NonZeroU32::new(if_index))` (an toàn 100%, không cần `unsafe`).
   - Khi gọi `connect()` trên non-blocking socket ở macOS, kernel trả về `errno = 36` (`EINPROGRESS`), khác với Linux (`115`) và Windows (`10035`). Phải bắt `e.raw_os_error() == Some(36)` để chuyển sang `stream.writable().await` + `stream.take_error()?`.
2. **Phát hiện `utun` của Surfshark vs `utun100` của NetBird vs `en1` Wi-Fi (`surfshark.rs`)**:
   - Lệnh `/sbin/ifconfig -v` trên macOS xuất đầy đủ `index <if_index>`, cờ `<UP,POINTOPOINT,RUNNING>`, `inet <ipv4>`, `type: Wi-Fi`, và `agent domain:NetworkExtension type:VPN ... desc:"VPN: Surfshark. WireGuard®"`.
   - Mọi giao diện `utun*` không thuộc Surfshark (như `utun100` NetBird `100.87.215.217`) phải được phân loại vào `AdapterKind::OtherVpn`, không bao giờ rơi vào `PrimaryIsp`.
3. **Đo nhầm Host ISP IP khi Surfshark Desktop đang kết nối toàn máy (`gologin.rs`, `lib.rs`)**:
   - Khi Surfshark Desktop đang bật trên macOS, default route trỏ vào `utun4`, nhưng `en1` vẫn giữ route `UGScIg` ra cổng vật lý. Truyền `interface = "<primary_isp_ipv4>"` vào cấu hình `curl` giúp lấy đúng IP nhà mạng thật (`VNPT`/`Viettel`/`FPT`) ngay cả khi VPN đang bật.
4. **Đường dẫn dữ liệu & Quyền tệp nhạy cảm trên macOS (`settings.rs`, `wireguard.rs`)**:
   - Khi chạy từ `/Applications/s-proxy.app`, thư mục làm việc hiện tại là `/` (read-only). `app_data_dir()` trên macOS phải trỏ về `~/Library/Application Support/com.donniechu.sproxy`.
   - Áp quyền `0o600` cho `state.json` và `runtime/wg-*.conf`, `0o755` cho binary `wireproxy` tải về.

---

## Files & Phân công theo Model Economy (Coding 5.5)

1. **[HARD — Main + `hard-reviewer` (`pro`)] `src-tauri/src/proxy_engine.rs`**
   - Gắn socket TCP/UDP vào `if_index` trên macOS qua `bind_device_by_index_v4` (`IP_BOUND_IF`).
   - Bổ sung mã `EINPROGRESS = 36` (Darwin) trong `dial_upstream`.
   - Unit test `binds_tcp_and_udp_sockets_with_interface_index` kiểm chứng `device_index_v4()` trên `lo0` (`if_index = 1`).
2. **[HARD — Main + `hard-reviewer` (`pro`)] `src-tauri/src/settings.rs` & `src-tauri/src/wireguard.rs` & `src-tauri/tauri.conf.json`**
   - Lưu cấu hình tại `~/Library/Application Support/com.donniechu.sproxy` trên macOS với quyền `0o600`.
   - Hỗ trợ tải tự động `wireproxy_darwin_arm64.tar.gz` / `wireproxy_darwin_amd64.tar.gz`, tìm kiếm `/opt/homebrew/bin/wireproxy`, `/usr/local/bin/wireproxy`, `/usr/bin/which wireproxy`.
   - Thêm target `app`, `dmg` và `icons/icon.icns` vào `src-tauri/tauri.conf.json`.
3. **[MEDIUM — `builder` (`flash`) + `reviewer` (`inherit`)] `src-tauri/src/surfshark.rs`, `src-tauri/src/gologin.rs`, `src-tauri/src/providers.rs`, `src-tauri/src/lib.rs`**
   - Đọc 180 máy chủ từ `/Applications/Surfshark.app/Contents/Resources/clusters.json` (hỗ trợ trường `"type": "generic" | "static"`).
   - Parser `/sbin/ifconfig -v` & `/usr/sbin/netstat -rn -f inet` cho macOS (`detect_macos_adapters`).
   - Hỗ trợ `/usr/bin/curl` trên macOS và truyền `primary_isp_ip` vào `detect_host_isp_ip_with_interface_blocking`.
4. **[EASY — `transcriber` (`flash_lite`)] `src/strings.ts`, `src/main.ts`, `README.md`, `SPEC.md`**
   - Đồng bộ nhãn hiển thị đa nền tảng (`IP_UNICAST_IF / IP_BOUND_IF`, `Wintun / utun`, `wireproxy`) và tài liệu kỹ thuật cho macOS & Windows.

---

## Proof

1. `cargo test --manifest-path src-tauri/Cargo.toml` — **PASS** (bao gồm đọc thật 180 locations từ `/Applications/Surfshark.app/Contents/Resources/clusters.json`, phát hiện thật `en1` / `utun4` / `utun100` trên macOS, và kiểm chứng `IP_BOUND_IF`).
2. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — **PASS (0 warnings)**.
3. `npm run build` — **PASS**.
4. `npm run tauri build` — **PASS** (đóng gói thành công `s-proxy.app` và `s-proxy_0.1.0_aarch64.dmg` trên macOS).
5. Kiểm tra rò rỉ bí mật trên toàn bộ mã nguồn (`src/` và `src-tauri/`) — **0 hits**.

---

## Review Log (Coding 5.5 Loop)

- **`hard-reviewer` (`Gemini 3.1 Pro Preview`) trên cụm HARD (`proxy_engine.rs`, `wireguard.rs`, `settings.rs`, `tauri.conf.json`)**:
  - Kết quả: **`PASS (APPROVED)`** — xác nhận `bind_device_by_index_v4` (`IP_BOUND_IF`), xử lý `EINPROGRESS = 36`, phân quyền `0o600`/`0o755` và giải nén `wireproxy` an toàn. Đã áp dụng thêm 2 khuyến nghị gia cố: cô lập biến môi trường `APPDATA` chỉ trên Windows và đặt quyền `0o600` cho `state.json` trên Unix.
- **`reviewer` (`Main`) trên cụm MEDIUM (`surfshark.rs`, `gologin.rs`, `providers.rs`, `lib.rs`)**:
  - Kết quả: **`PASS`** — kiểm tra thực tế trên macOS đọc đúng 180 clusters (142 generic + 38 static), phát hiện chuẩn `en1` (`PrimaryIsp`), `utun4` (`Surfshark`), `utun100` (`OtherVpn`), và lấy đúng ISP IP qua `--interface`.
