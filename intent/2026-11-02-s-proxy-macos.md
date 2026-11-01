---
status: verified
---
# s-proxy: Phát triển bản Native macOS (Apple Silicon & Intel) cho Surfshark & GoLogin

**Problem** —
- Bản `s-proxy` ban đầu được thiết kế riêng cho Windows (`IP_UNICAST_IF`, PowerShell `Get-NetAdapter`, `%ProgramData%\Surfshark\*.dat`, `wireproxy.exe`).
- Trên macOS (Darwin), Surfshark Desktop tạo giao diện đường hầm `utun*` (NetworkExtension `VPN: Surfshark. WireGuard®`, IP `10.14.0.2`) và lưu danh mục 180 máy chủ tại `/Applications/Surfshark.app/Contents/Resources/clusters.json`.
- Ngoài ra, trên máy macOS đang chạy song song `utun100` (NetBird/Tailscale CGNAT `100.87.x.x`) và `en1` (Wi-Fi ISP thật). Nếu không gắn chặt socket vào `if_index` của `utun` bằng `IP_BOUND_IF`, xử lý `EINPROGRESS (errno 36)` trên BSD socket, và đo Host ISP IP trực tiếp qua `en1` (`--interface <isp_ip>`), lưu lượng GoLogin trên macOS sẽ bị lỗi kết nối hoặc báo nhầm trạng thái Leak khi Surfshark đang bật toàn máy.

**Outcome** —
Bản `s-proxy` hỗ trợ đầy đủ **macOS (Apple Silicon `arm64` & Intel `x86_64`)** song song với Windows:
1. **Chế độ 1 — macOS Adapter Bridge (`utun` + `IP_BOUND_IF` + Fail-Closed Kill-Switch)**:
   - Tự động phát hiện mọi network interface trên macOS qua `/sbin/ifconfig -v` và bảng định tuyến `/usr/sbin/netstat -rn -f inet` (fallback `/sbin/route -n get default`).
   - Phân loại chính xác:
     - `Surfshark`: giao diện `utun*` có metadata NetworkExtension `VPN: Surfshark...` hoặc dải IP `10.14.0.0/16` / `10.8.0.0/16`.
     - `OtherVpn`: các giao diện `utun*` khác (như `utun100` NetBird/Tailscale CGNAT `100.64.0.0/10`) để tuyệt đối không nhầm với Surfshark hay ISP.
     - `PrimaryIsp`: giao diện vật lý giữ default route (`en0` Ethernet / `en1` Wi-Fi).
   - Khóa cứng mọi socket TCP và UDP (kể cả truy vấn DNS RFC 1035 nội bộ) vào `if_index` của `utun` qua `IP_BOUND_IF` (`socket2::Socket::bind_device_by_index_v4`) và xử lý đúng mã `EINPROGRESS = 36` của nhân Darwin khi kết nối TCP bất đồng bộ.
2. **Chế độ 2 — Multi-Proxy Userspace WireGuard trên macOS**:
   - Tự động nạp **180 vị trí Surfshark** (142 `generic` + 38 `static`) từ `/Applications/Surfshark.app/Contents/Resources/clusters.json` (và `~/Applications/Surfshark.app/...` hoặc `~/Library/Application Support/Surfshark/*.dat`).
   - Tự động tải, giải nén và cấp quyền thực thi (`chmod 0755`) cho binary `wireproxy` đúng kiến trúc macOS (`wireproxy_darwin_arm64.tar.gz` trên Apple Silicon / `wireproxy_darwin_amd64.tar.gz` trên Intel), hoặc tự nhận diện qua Homebrew (`/opt/homebrew/bin/wireproxy`, `/usr/local/bin/wireproxy`).
   - Khoá quyền truy cập `chmod 0600` đối với cả `state.json` và các file cấu hình tạm `runtime/wg-*.conf` tại `~/Library/Application Support/com.donniechu.sproxy`.
3. **Đối chiếu Host ISP IP chính xác ngay cả khi Surfshark đang bật toàn máy**:
   - Khi kiểm tra IP gốc của nhà mạng (`detect_host_isp_ip_with_interface_blocking`), tự động gắn `--interface <primary_isp_ipv4>` (ví dụ `en1`) vào `curl` để lấy đúng IP thật của ISP mà không bị định tuyến nhầm qua tunnel Surfshark đang bật.
4. **Đóng gói Native macOS Bundle**:
   - Xuất bản gói cài đặt chuẩn `.app` và `.dmg` cho macOS (`src-tauri/tauri.conf.json`) kèm biểu tượng `icons/icon.icns`.

**Constraints** —
- Giữ nguyên khả năng tương thích ngược 100% với Windows (`#[cfg(target_os = "windows")]` vs `#[cfg(target_os = "macos")]`).
- Không thêm dependency ngoài, không dùng `unsafe` trên macOS (`#[lints.rust] unsafe_code = "deny"`).
- Mặc định giữ nguyên dải cổng `10800..10899`, lắng nghe `127.0.0.1`, và 6 lớp bảo vệ Fail-Closed BẬT mặc định.
