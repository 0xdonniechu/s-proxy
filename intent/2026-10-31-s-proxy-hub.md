---
status: verified
---
# s-proxy: Hybrid Surfshark VPN Proxy Hub kết nối GoLogin (Windows)

**Problem** —
- App Surfshark Desktop trên Windows chỉ duy trì 1 kết nối VPN tại 1 thời điểm và định tuyến theo mức toàn máy (hoặc theo app qua Bypasser), không xuất ra các cổng SOCKS5/HTTP proxy độc lập.
- Trong khi đó, GoLogin cần gắn proxy (`SOCKS5` hoặc `HTTP`) riêng cho từng browser profile để:
  1. Đi qua kết nối VPN đang bật của Surfshark mà không ảnh hưởng toàn bộ máy chính, **hoặc**
  2. Chạy song song nhiều profile GoLogin cùng lúc, mỗi profile mang 1 IP / quốc gia Surfshark khác nhau (Multi-Proxy) mà không bị xung đột bảng định tuyến (routing table) của Windows hay rò rỉ IP/DNS thật (`VNPT`).
- Ngoài ra, trên máy đang có sẵn interface `wt0` của **NetBird** (`100.87.25.169`) dễ bị nhầm với adapter của Surfshark (`Local Area Connection` Wintun / `OpenVPN Data Channel Offload`).

**Outcome** —
Một ứng dụng desktop Tauri 2 (Rust + Vanilla TS, tray-first) đóng vai trò **Hybrid Proxy Hub**:
1. **Chế độ 1 — Adapter Bridge (1-Click từ Surfshark App đang chạy)**:
   - Tự động phát hiện đúng network adapter của Surfshark (Wintun / OpenVPN, loại trừ NetBird `wt0` trừ khi người dùng chọn thủ công).
   - Tạo cổng proxy local (mặc định `127.0.0.1:10800`, hỗ trợ SOCKS5 + HTTP CONNECT) bind chặt (`SO_BINDTODEVICE` / `IP_UNICAST_IF` + local IP bind) vào IP của adapter Surfshark.
   - **Fail-closed Kill Switch**: Nếu Surfshark ngắt kết nối hoặc adapter hạ xuống, cổng proxy lập tức từ chối kết nối (tuyệt đối không fallback về Wi-Fi/Ethernet ISP thật).
2. **Chế độ 2 — Multi-Proxy Userspace WireGuard (Chạy N IP/Location song song cho nhiều profile GoLogin)**:
   - Đọc trực tiếp danh mục **180 server** có sẵn từ dữ liệu Surfshark trên máy (`C:\ProgramData\Surfshark\general_locations.dat` — 142 locations và `static_locations.dat` — 38 static locations, đã có sẵn `connectionName`, `pubKey`, `country`, `location`, `load`).
   - Người dùng chỉ cần nhập **1 WireGuard PrivateKey** (lấy từ `my.surfshark.com -> VPN -> Manual setup -> WireGuard`) hoặc import file `.conf` mẫu.
   - Tạo nhiều **Proxy Slot** chạy song song (`127.0.0.1:10801`, `10802`, `10803`...): mỗi slot khởi chạy 1 đường hầm WireGuard ở **userspace** (không cần tạo thêm Wintun adapter, không đụng routing của Windows) tới bất kỳ quốc gia/server Surfshark nào và lắng nghe SOCKS5/HTTP riêng.
3. **Tích hợp GoLogin + Tiện ích vận hành**:
   - **Copy 1 chạm**: Copy chuỗi proxy chuẩn (`socks5://127.0.0.1:10801`, `http://127.0.0.1:10801`) hoặc xuất danh sách bulk.
   - **GoLogin Sync (API)**: Nhập GoLogin API Token → liệt kê danh sách profile GoLogin → bấm gán/cập nhật proxy từ bất kỳ Slot nào vào thẳng profile GoLogin và hiển thị trạng thái đồng bộ.
   - **Egress & Leak Check**: Mỗi Proxy Slot có nút kiểm tra thực tế qua chính cổng proxy đó (hiển thị Exit IP, Quốc gia, ISP, độ trễ ms, và xác nhận Exit IP khác IP máy chủ thật).

**Constraints** —
- **Stack**: Tauri 2 (Rust backend xử lý toàn bộ networking, proxy, detección adapter, WireGuard management, GoLogin API; Vanilla TypeScript + CSS thuần chỉ render `HubSnapshot`, không dùng React/Vue/Tailwind/SQLite).
- **Bảo mật & chống leak (HARD)**:
  - Mặc định chỉ lắng nghe trên `127.0.0.1` (tránh mở cổng ra LAN trừ khi bật tuỳ chọn LAN explicitly).
  - Mọi truy vấn tên miền qua SOCKS5h (`ATYP=DOMAIN`) và HTTP `CONNECT host:port` phải phân giải DNS qua đường hầm VPN, không dùng DNS của ISP máy thật.
  - Không bao giờ lưu/log `PrivateKey` hoặc GoLogin API Token vào repo git.
- **Tài nguyên cần cho Chế độ 2 (Multi-Proxy) & GoLogin API**:
  - Đã có sẵn trên máy: Surfshark app + 180 server/pubkey trong `C:\ProgramData\Surfshark\*.dat` + GoLogin app.
  - Cần bạn cung cấp khi chạy thử thực tế (hoặc nhập vào mục Settings của app):
    1. **WireGuard PrivateKey** của tài khoản Surfshark (để chạy Multi-Proxy userspace; Chế độ 1 Adapter Bridge thì không cần).
    2. **GoLogin API Token** (lấy trong GoLogin → Settings → API; để đồng bộ tự động vào profile GoLogin).
    3. **Sidecar binary `wireproxy` (hoặc tương đương)**: App có thể tự tải/đóng gói sẵn binary `wireproxy.exe` gọn nhẹ (MIT license, ~4MB) làm engine userspace WireGuard→SOCKS5/HTTP cho Chế độ 2, trong khi Chế độ 1 (Adapter Bridge) viết trực tiếp bằng Rust thuần (`tokio`).

**Out of scope** —
- Không can thiệp hay crack/reverse-engineer giao thức chứng thực nội bộ đóng (`SurfsharkPQS` named pipe) của Surfshark Service.
- Không tự động tạo mới browser fingerprint của GoLogin (chỉ đọc danh sách profile và cập nhật trường `proxy` của profile).
- Không làm hệ thống tài khoản, thanh toán hay server trung gian bên ngoài.

**Open questions** — (trống; owner đã duyệt Intent, tạo Plane project `SProxy` / `SPX`, chuyển sang Phase 2 Plan).
