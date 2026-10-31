import type { AppLanguage } from "./types";

export interface I18nStrings {
  tabs: {
    proxyHub: string;
    statusTab: string;
    surfsharkCatalog: string;
    providersTab: string;
    gologinSync: string;
    settings: string;
  };
  header: {
    brandSubtitle: string;
    ispIp: string;
    surfsharkAdapter: string;
    wireproxyCore: string;
    connected: string;
    disconnected: string;
    ready: string;
    missing: string;
  };
  hub: {
    addAdapterSlot: string;
    addMultiVpnSlot: string;
    startAll: string;
    stopAll: string;
    checkAllIps: string;
    copyAllSocks5: string;
    copiedAll: string;
    refreshSystem: string;
    emptySlots: string;
    slotsTitle: string;
    colSlotName: string;
    colMode: string;
    colEndpoint: string;
    colStatus: string;
    colEgress: string;
    colGoLogin: string;
    colActions: string;
    copySocks5: string;
    copyHttp: string;
    copied: string;
    checkIp: string;
    checking: string;
    start: string;
    stop: string;
    delete: string;
    sync: string;
    selectProfilePrompt: string;
    adapterDiagnostics: string;
    adapterDiagnosticsDesc: string;
    colAdapterName: string;
    colAdapterDesc: string;
    colAdapterIp: string;
    colAdapterStatus: string;
    colAdapterKind: string;
    kindSurfshark: string;
    kindOtherVpn: string;
    kindPrimaryIsp: string;
    modalCreateTitle: string;
    modalCreateMultiTitle: string;
    selectServerLabel: string;
    slotNameLabel: string;
    slotPortLabel: string;
    slotPortHint: string;
    adapterHintLabel: string;
    adapterHintPlaceholder: string;
    autoStartLabel: string;
    createBtn: string;
    cancelBtn: string;
  };
  catalog: {
    searchPlaceholder: string;
    filterAll: string;
    filterGeneric: string;
    filterStatic: string;
    colCountry: string;
    colCity: string;
    colType: string;
    colLoad: string;
    colServer: string;
    colAction: string;
    createAndStart: string;
    serverCount: string;
    noServersMatch: string;
    genericType: string;
    staticType: string;
    recommendedTitle: string;
    fastestLocation: string;
    nearestCountry: string;
    allLocations: string;
  };
  gologin: {
    title: string;
    fetchProfiles: string;
    fetching: string;
    fetchHint: string;
    colProfileName: string;
    colProfileId: string;
    colProfileOs: string;
    colCurrentProxy: string;
    colAssignSlot: string;
    colAction: string;
    assignBtn: string;
    selectSlotPrompt: string;
    proxyModeSocks5: string;
    proxyModeHttp: string;
    noProfiles: string;
    directNoProxy: string;
  };
  settings: {
    title: string;
    subtitle: string;
    wgSection: string;
    wgPrivateKey: string;
    wgPrivateKeyPlaceholder: string;
    wgPrivateKeyHint: string;
    openSurfsharkKeyPage: string;
    wgAddress: string;
    wgDns: string;
    gologinSection: string;
    gologinToken: string;
    gologinTokenPlaceholder: string;
    gologinTokenHint: string;
    networkSection: string;
    basePort: string;
    allowLan: string;
    allowLanDesc: string;
    language: string;
    wireproxySection: string;
    wireproxyPath: string;
    wireproxyReady: string;
    wireproxyMissing: string;
    installWireproxy: string;
    installing: string;
    importConfSection: string;
    importConfDesc: string;
    importConfPlaceholder: string;
    importConfBtn: string;
    uploadConfBtn: string;
    saveBtn: string;
    saving: string;
    savedSuccess: string;
  };
  status: {
    running: string;
    stopped: string;
    killSwitch: string;
    error: string;
    leakSafe: string;
    leakBlocked: string;
    leakUnchecked: string;
    leakError: string;
    modeAdapterBridge: string;
    modeUserspaceWg: string;
  };
  statusPage: {
    title: string;
    subtitle: string;
    allProtectionsActive: string;
    allProtectionsDesc: string;
    customProtectionMode: string;
    customProtectionDesc: string;
    resetDefaultsBtn: string;
    refreshStatusBtn: string;
    protectionsSectionTitle: string;
    stateOn: string;
    stateOff: string;
    killSwitchTitle: string;
    killSwitchDesc: string;
    dnsLeakTitle: string;
    dnsLeakDesc: string;
    ipv6BlockTitle: string;
    ipv6BlockDesc: string;
    ispGuardTitle: string;
    ispGuardDesc: string;
    autoVerifyTitle: string;
    autoVerifyDesc: string;
    localhostOnlyTitle: string;
    localhostOnlyDesc: string;
    subsystemSectionTitle: string;
    vpnAdapterCardTitle: string;
    ispGuardCardTitle: string;
    wireguardEngineCardTitle: string;
    proxyHubCardTitle: string;
    activeSlotsCount: string;
    keyConfigured: string;
    keyNotSet: string;
  };
  providersPage: {
    title: string;
    subtitle: string;
    statusReady: string;
    statusMissingKey: string;
    serversAvailable: string;
    privateKeyLabel: string;
    privateKeyPlaceholder: string;
    addressLabel: string;
    dnsLabel: string;
    apiTokenLabel: string;
    apiTokenPlaceholder: string;
    saveProviderBtn: string;
    syncCatalogBtn: string;
    importConfFilesBtn: string;
    browseServersBtn: string;
    surfsharkDesc: string;
    nordvpnDesc: string;
    mullvadDesc: string;
    protonvpnDesc: string;
    customDesc: string;
    savedToast: string;
    syncedToast: string;
    importedToast: string;
  };
}

export const DICTIONARY: Record<AppLanguage, I18nStrings> = {
  vi: {
    tabs: {
      proxyHub: "Proxy Hub",
      statusTab: "Trạng thái & Bảo mật",
      surfsharkCatalog: "Máy chủ VPN",
      providersTab: "Nhà cung cấp VPN",
      gologinSync: "Đồng bộ GoLogin",
      settings: "Cài đặt",
    },
    header: {
      brandSubtitle: "Cổng Proxy Lai Surfshark & GoLogin",
      ispIp: "IP Thật Máy Chủ (ISP)",
      surfsharkAdapter: "Card Mạng Surfshark",
      wireproxyCore: "Lõi Wireproxy",
      connected: "Đã kết nối",
      disconnected: "Chưa kết nối",
      ready: "Sẵn sàng",
      missing: "Chưa có",
    },
    hub: {
      addAdapterSlot: "+ Thêm Slot Adapter Bridge",
      addMultiVpnSlot: "+ Thêm Slot Multi-VPN",
      startAll: "▶ Bật tất cả",
      stopAll: "■ Dừng tất cả",
      checkAllIps: "⟳ Kiểm tra tất cả IP",
      copyAllSocks5: "⎘ Chép toàn bộ SOCKS5",
      copiedAll: "Đã chép toàn bộ danh sách proxy!",
      refreshSystem: "Làm mới Hệ thống",
      emptySlots: "Chưa có slot proxy nào. Hãy tạo slot mới ở trên hoặc chọn máy chủ từ tab Surfshark.",
      slotsTitle: "Danh sách Proxy Slot đang hoạt động",
      colSlotName: "Tên Slot",
      colMode: "Chế độ",
      colEndpoint: "Cổng nội bộ (127.0.0.1:port)",
      colStatus: "Trạng thái",
      colEgress: "IP Egress / Độ trễ",
      colGoLogin: "Profile GoLogin",
      colActions: "Thao tác",
      copySocks5: "Chép SOCKS5",
      copyHttp: "Chép HTTP",
      copied: "Đã chép!",
      checkIp: "Kiểm tra IP",
      checking: "Đang kiểm...",
      start: "Khởi động",
      stop: "Dừng",
      delete: "Xóa",
      sync: "Gán GoLogin",
      selectProfilePrompt: "-- Chọn Profile GoLogin --",
      adapterDiagnostics: "Chẩn đoán Card Mạng Windows (Fail-Closed Chống Rò Rỉ)",
      adapterDiagnosticsDesc: "S-proxy tự động cô lập mạng, gắn socket vào card Surfshark và từ chối mọi lưu lượng rò sang Wi-Fi/Ethernet ISP.",
      colAdapterName: "Tên Card",
      colAdapterDesc: "Mô tả phần cứng / Virtual NIC",
      colAdapterIp: "IPv4",
      colAdapterStatus: "Trạng thái",
      colAdapterKind: "Phân loại",
      kindSurfshark: "Surfshark (VPN)",
      kindOtherVpn: "VPN khác / NetBird",
      kindPrimaryIsp: "Primary ISP (Bảo vệ chống rò rỉ)",
      modalCreateTitle: "Tạo Slot Adapter Bridge Mới",
      modalCreateMultiTitle: "Tạo Slot Multi-VPN (WireGuard Độc lập)",
      selectServerLabel: "Chọn Máy chủ Surfshark (180 vị trí)",
      slotNameLabel: "Tên Slot",
      slotPortLabel: "Cổng lắng nghe (Port)",
      slotPortHint: "Để trống để tự động lấy cổng khả dụng tiếp theo",
      adapterHintLabel: "Chỉ định Card Mạng (Tùy chọn)",
      adapterHintPlaceholder: "Để trống để tự nhận diện Card Surfshark đang kết nối",
      autoStartLabel: "Tự động khởi động slot ngay sau khi tạo",
      createBtn: "Tạo Slot",
      cancelBtn: "Hủy",
    },
    catalog: {
      searchPlaceholder: "Tìm theo quốc gia, thành phố, tên server...",
      filterAll: "Tất cả máy chủ",
      filterGeneric: "Tiêu chuẩn (Generic)",
      filterStatic: "IP Cố định (Static)",
      colCountry: "Quốc gia",
      colCity: "Thành phố / Vị trí",
      colType: "Loại",
      colLoad: "Tải máy chủ",
      colServer: "Máy chủ WireGuard",
      colAction: "Thao tác",
      createAndStart: "+ Tạo & Bật Proxy",
      serverCount: "Hiển thị {count} máy chủ Surfshark toàn cầu",
      noServersMatch: "Không tìm thấy máy chủ nào khớp với điều kiện tìm kiếm.",
      genericType: "Tiêu chuẩn",
      staticType: "IP Cố định",
      recommendedTitle: "Gợi ý cho bạn",
      fastestLocation: "Vị trí nhanh nhất",
      nearestCountry: "Quốc gia gần nhất",
      allLocations: "Tất cả vị trí",
    },
    gologin: {
      title: "Đồng bộ Profile Trình duyệt GoLogin",
      fetchProfiles: "Tải danh sách Profile GoLogin",
      fetching: "Đang tải...",
      fetchHint: "Cần nhập GoLogin API Token trong mục Cài đặt trước khi tải.",
      colProfileName: "Tên Profile",
      colProfileId: "Mã Profile",
      colProfileOs: "HĐH",
      colCurrentProxy: "Proxy Hiện Tại",
      colAssignSlot: "Gán Slot Proxy s-proxy",
      colAction: "Hành động",
      assignBtn: "Gán vào Profile",
      selectSlotPrompt: "-- Chọn Proxy Slot --",
      proxyModeSocks5: "SOCKS5",
      proxyModeHttp: "HTTP",
      noProfiles: "Chưa có danh sách GoLogin. Bấm 'Tải danh sách Profile GoLogin' để nạp.",
      directNoProxy: "Không có proxy (Trực tiếp)",
    },
    settings: {
      title: "Cấu hình Hệ thống s-proxy",
      subtitle: "Thông tin bảo mật WireGuard, liên kết GoLogin và tham số mạng máy chủ",
      wgSection: "Cấu hình Động cơ WireGuard (Userspace)",
      wgPrivateKey: "WireGuard PrivateKey (Khóa Riêng Surfshark)",
      wgPrivateKeyPlaceholder: "Dán khóa riêng WireGuard (32 bytes base64)",
      wgPrivateKeyHint: "Lấy từ tài khoản Surfshark -> Manual Setup -> WireGuard",
      openSurfsharkKeyPage: "Lấy khóa trên Surfshark Web ↗",
      wgAddress: "Địa chỉ IP Đường hầm (Tunnel Address)",
      wgDns: "Máy chủ DNS Đường hầm",
      gologinSection: "Tích hợp GoLogin",
      gologinToken: "GoLogin API Token",
      gologinTokenPlaceholder: "Dán API Token GoLogin",
      gologinTokenHint: "Lấy từ GoLogin -> Settings -> API -> Generate Token",
      networkSection: "Cổng mạng & Bảo mật truy cập",
      basePort: "Cổng khởi đầu cho Slot mới (Base Port)",
      allowLan: "Cho phép truy cập qua Mạng Cục bộ (LAN Bind 0.0.0.0)",
      allowLanDesc: "Cảnh báo: Chỉ bật khi muốn máy khác trong mạng LAN truy cập proxy.",
      language: "Ngôn ngữ hiển thị (Language)",
      wireproxySection: "Bộ thực thi Userspace WireGuard (wireproxy.exe)",
      wireproxyPath: "Đường dẫn tệp wireproxy.exe",
      wireproxyReady: "Đã cài đặt và sẵn sàng",
      wireproxyMissing: "Chưa phát hiện wireproxy.exe",
      installWireproxy: "Tự động cài đặt / Tải wireproxy.exe",
      installing: "Đang tải và cài đặt...",
      importConfSection: "Nhập nhanh từ File Cấu hình Surfshark (.conf)",
      importConfDesc: "Dán nội dung tệp .conf tải từ trang cá nhân Surfshark để tự động trích xuất PrivateKey, Address và DNS.",
      importConfPlaceholder: "[Interface]\n" + "Private" + "Key = <base64-key>\nAddress = 10.14.0.2/16\nDNS = 162.252.172.57",
      importConfBtn: "Nhập & Áp dụng .conf",
      uploadConfBtn: "Chọn file .conf từ máy...",
      saveBtn: "Lưu Cài đặt",
      saving: "Đang lưu...",
      savedSuccess: "Đã lưu cài đặt thành công!",
    },
    status: {
      running: "Đang chạy",
      stopped: "Đã dừng",
      killSwitch: "Kill-Switch (Đã chặn)",
      error: "Lỗi kết nối",
      leakSafe: "An toàn (Đã đổi IP)",
      leakBlocked: "Rò rỉ ISP (Đã ngắt)",
      leakUnchecked: "Chưa kiểm tra",
      leakError: "Kiểm tra thất bại",
      modeAdapterBridge: "Cầu nối Adapter",
      modeUserspaceWg: "WireGuard Độc lập",
    },
    statusPage: {
      title: "Trạng thái Hệ thống & Khiên Bảo vệ",
      subtitle: "Tất cả cơ chế chống rò rỉ IP/DNS được BẬT mặc định. Bạn có thể kiểm tra trực quan từng tính năng và bật/tắt ngay bên dưới.",
      allProtectionsActive: "Tất cả 6 lớp bảo vệ an toàn đang BẬT (ON)",
      allProtectionsDesc: "Mọi kết nối qua s-proxy đều được khóa cứng vào đường hầm VPN và chống rò rỉ DNS/IPv6/ISP.",
      customProtectionMode: "Một số tính năng bảo vệ đang TẮT (OFF)",
      customProtectionDesc: "Bạn đã tắt thủ công một hoặc nhiều lớp bảo vệ. Khuyến nghị bật lại để đảm bảo an toàn tuyệt đối cho GoLogin.",
      resetDefaultsBtn: "Khôi phục Mặc định An toàn (Bật tất cả)",
      refreshStatusBtn: "Làm mới Trạng thái",
      protectionsSectionTitle: "Trạng thái các Tính năng An toàn (Bật / Tắt)",
      stateOn: "ĐANG BẬT (ON)",
      stateOff: "ĐANG TẮT (OFF)",
      killSwitchTitle: "1. Khóa cứng Card VPN & Fail-Closed Kill-Switch (IP_UNICAST_IF)",
      killSwitchDesc: "Buộc mọi socket đi ra qua giao diện Surfshark Wintun hoặc đường hầm WireGuard. Ngắt kết nối ngay lập tức nếu VPN rớt, tuyệt đối không rớt về Wi-Fi/Ethernet.",
      dnsLeakTitle: "2. Chống rò rỉ DNS qua Đường hầm (Tunnel-Only DNS RFC 1035)",
      dnsLeakDesc: "Phân giải tên miền SOCKS5 (ATYP=DOMAIN) và HTTP CONNECT trực tiếp bên trong đường hầm Surfshark (162.252.172.57), không dùng DNS của nhà mạng ISP.",
      ipv6BlockTitle: "3. Chặn rò rỉ IPv6 Dual-Stack (IPv6 Leak Blocker)",
      ipv6BlockDesc: "Từ chối toàn bộ yêu cầu kết nối IPv6 (ATYP=0x04) và chỉ chọn địa chỉ IPv4 để ngăn trình duyệt rò rỉ qua IPv6 của nhà mạng.",
      ispGuardTitle: "4. Khiên đối chiếu IP Thật Nhà mạng (Real ISP IP Egress Guard)",
      ispGuardDesc: "Tự động so sánh Exit IP của từng cổng proxy với IP thật của nhà mạng (VNPT/Viettel/FPT). Cảnh báo và gắn nhãn chặn nếu phát hiện trùng IP ISP.",
      autoVerifyTitle: "5. Tự động Kiểm tra Exit IP khi Bật Slot (Auto-Verify Egress)",
      autoVerifyDesc: "Tự động kiểm tra địa chỉ IP đầu ra, vị trí quốc gia và độ trễ ngay sau khi khởi động bất kỳ Proxy Slot nào.",
      localhostOnlyTitle: "6. Cô lập Cổng Nội bộ Localhost (127.0.0.1 Isolation)",
      localhostOnlyDesc: "Chỉ cho phép ứng dụng trên chính máy tính này (GoLogin/Trình duyệt) kết nối vào cổng proxy; chặn truy cập từ các thiết bị khác trong mạng LAN.",
      subsystemSectionTitle: "Trạng thái Trực tiếp các Thành phần Lõi",
      vpnAdapterCardTitle: "Card Mạng Surfshark",
      ispGuardCardTitle: "IP Thật Máy Chủ (ISP)",
      wireguardEngineCardTitle: "Lõi Multi-VPN Wireproxy",
      proxyHubCardTitle: "Cổng Proxy Đang Chạy",
      activeSlotsCount: "{running} / {total} slot đang chạy",
      keyConfigured: "Đã nạp PrivateKey",
      keyNotSet: "Chưa nạp PrivateKey",
    },
    providersPage: {
      title: "Nhà cung cấp VPN (Multi-Provider WireGuard Hub)",
      subtitle: "Kết nối đồng thời Surfshark, NordVPN, Mullvad, ProtonVPN hoặc bất kỳ file .conf WireGuard nào để tạo cổng SOCKS5/HTTP tốc độ cao.",
      statusReady: "Sẵn sàng",
      statusMissingKey: "Chưa nạp khóa",
      serversAvailable: "{count} máy chủ",
      privateKeyLabel: "WireGuard PrivateKey (Base64)",
      privateKeyPlaceholder: "Dán khóa riêng WireGuard 44 ký tự...",
      addressLabel: "Địa chỉ IP Đường hầm (Tunnel IP)",
      dnsLabel: "Máy chủ DNS Đường hầm",
      apiTokenLabel: "Access Token / Mã Tài Khoản (Tự động lấy Key & Server)",
      apiTokenPlaceholder: "Dán Access Token từ trang tài khoản VPN...",
      saveProviderBtn: "Lưu Cấu hình",
      syncCatalogBtn: "⟳ Đồng bộ API Máy chủ & Key",
      importConfFilesBtn: "Nhập File .conf...",
      browseServersBtn: "Xem Máy chủ →",
      surfsharkDesc: "Tự động đọc 180 cụm máy chủ Surfshark toàn cầu. Dán PrivateKey hoặc chọn file .conf tải từ my.surfshark.com.",
      nordvpnDesc: "Hỗ trợ NordLynx WireGuard: Dán Access Token (từ my.nordaccount.com) rồi bấm 'Đồng bộ API' để tự lấy PrivateKey và 300+ máy chủ NordVPN.",
      mullvadDesc: "Bấm 'Đồng bộ API' để tải toàn bộ danh sách máy chủ Mullvad toàn cầu, sau đó nạp file .conf hoặc nhập PrivateKey + Tunnel IP.",
      protonvpnDesc: "Tải các file cấu hình WireGuard (.conf) từ trang quản trị ProtonVPN và bấm 'Nhập File .conf...' (hỗ trợ chọn nhiều file cùng lúc).",
      customDesc: "Tích hợp bất kỳ nhà cung cấp VPN nào khác (Windscribe, IVPN, PIA, Cloudflare WARP, VPS riêng) bằng cách nhập các file .conf chuẩn WireGuard.",
      savedToast: "Đã lưu cấu hình nhà cung cấp VPN!",
      syncedToast: "Đã đồng bộ danh sách máy chủ & khóa thành công!",
      importedToast: "Đã nhập cấu hình .conf thành công!",
    },
  },
  en: {
    tabs: {
      proxyHub: "Proxy Hub",
      statusTab: "Status & Security",
      surfsharkCatalog: "VPN Locations",
      providersTab: "VPN Providers",
      gologinSync: "GoLogin Sync",
      settings: "Settings",
    },
    header: {
      brandSubtitle: "Surfshark & GoLogin Hybrid Proxy Hub",
      ispIp: "Host ISP IP",
      surfsharkAdapter: "Surfshark Adapter",
      wireproxyCore: "Wireproxy Core",
      connected: "Connected",
      disconnected: "Disconnected",
      ready: "Ready",
      missing: "Missing",
    },
    hub: {
      addAdapterSlot: "+ Adapter Bridge Slot",
      addMultiVpnSlot: "+ Multi-VPN Slot",
      startAll: "▶ Start All",
      stopAll: "■ Stop All",
      checkAllIps: "⟳ Check All IPs",
      copyAllSocks5: "⎘ Copy All SOCKS5",
      copiedAll: "Copied all proxy endpoints to clipboard!",
      refreshSystem: "Refresh System",
      emptySlots: "No proxy slots configured yet. Create one above or pick a server from Surfshark tab.",
      slotsTitle: "Active Proxy Slots",
      colSlotName: "Slot Name",
      colMode: "Mode",
      colEndpoint: "Dual Endpoint (127.0.0.1:port)",
      colStatus: "Status",
      colEgress: "Exit IP / Latency",
      colGoLogin: "GoLogin Profile",
      colActions: "Actions",
      copySocks5: "Copy SOCKS5",
      copyHttp: "Copy HTTP",
      copied: "Copied!",
      checkIp: "Check IP",
      checking: "Checking...",
      start: "Start",
      stop: "Stop",
      delete: "Delete",
      sync: "Sync GoLogin",
      selectProfilePrompt: "-- Select GoLogin Profile --",
      adapterDiagnostics: "Windows Network Adapters (Fail-Closed Diagnostics)",
      adapterDiagnosticsDesc: "S-proxy isolates egress via IP_UNICAST_IF and strictly refuses fallback to host ISP Wi-Fi/Ethernet.",
      colAdapterName: "Adapter Name",
      colAdapterDesc: "Hardware / Virtual NIC Description",
      colAdapterIp: "IPv4",
      colAdapterStatus: "Link Status",
      colAdapterKind: "Kind",
      kindSurfshark: "Surfshark (VPN)",
      kindOtherVpn: "Other VPN / NetBird",
      kindPrimaryIsp: "Primary ISP (Protected against leaks)",
      modalCreateTitle: "Create Adapter Bridge Slot",
      modalCreateMultiTitle: "Create Multi-VPN Slot (Userspace WireGuard)",
      selectServerLabel: "Select Surfshark Server (180 locations)",
      slotNameLabel: "Slot Name",
      slotPortLabel: "Listen Port",
      slotPortHint: "Leave blank to auto-assign the next free port",
      adapterHintLabel: "Target Adapter Hint (Optional)",
      adapterHintPlaceholder: "Leave blank to auto-detect active Surfshark VPN adapter",
      autoStartLabel: "Start proxy slot immediately after creation",
      createBtn: "Create Slot",
      cancelBtn: "Cancel",
    },
    catalog: {
      searchPlaceholder: "Search country, city, connection name...",
      filterAll: "All Server Types",
      filterGeneric: "Standard (Generic)",
      filterStatic: "Static IP",
      colCountry: "Country",
      colCity: "City / Location",
      colType: "Type",
      colLoad: "Server Load",
      colServer: "WireGuard Server",
      colAction: "Action",
      createAndStart: "+ Create & Start Proxy",
      serverCount: "Showing {count} Surfshark servers worldwide",
      noServersMatch: "No servers match your filter criteria.",
      genericType: "Standard",
      staticType: "Static IP",
      recommendedTitle: "Recommended for you",
      fastestLocation: "Fastest location",
      nearestCountry: "Nearest country",
      allLocations: "All Locations",
    },
    gologin: {
      title: "GoLogin Browser Profile Synchronization",
      fetchProfiles: "Fetch GoLogin Profiles",
      fetching: "Fetching...",
      fetchHint: "Requires GoLogin API Token configured in Settings tab.",
      colProfileName: "Profile Name",
      colProfileId: "Profile ID",
      colProfileOs: "OS",
      colCurrentProxy: "Current Proxy",
      colAssignSlot: "Assign s-proxy Slot",
      colAction: "Action",
      assignBtn: "Assign to Profile",
      selectSlotPrompt: "-- Select Proxy Slot --",
      proxyModeSocks5: "SOCKS5",
      proxyModeHttp: "HTTP",
      noProfiles: "No GoLogin profiles found. Click 'Fetch GoLogin Profiles' to retrieve.",
      directNoProxy: "Direct (No Proxy)",
    },
    settings: {
      title: "s-proxy Hub Settings",
      subtitle: "WireGuard credentials, GoLogin integration, and network parameters",
      wgSection: "Userspace WireGuard Engine",
      wgPrivateKey: "Surfshark WireGuard PrivateKey",
      wgPrivateKeyPlaceholder: "Paste WireGuard private key (32 bytes base64)",
      wgPrivateKeyHint: "Obtain from Surfshark Account -> Manual Setup -> WireGuard",
      openSurfsharkKeyPage: "Get WireGuard Key on Surfshark Web ↗",
      wgAddress: "Tunnel Address",
      wgDns: "Tunnel DNS Server",
      gologinSection: "GoLogin Integration",
      gologinToken: "GoLogin API Token",
      gologinTokenPlaceholder: "Paste GoLogin API Token",
      gologinTokenHint: "Obtain from GoLogin -> Settings -> API -> Generate Token",
      networkSection: "Network & Port Allocation",
      basePort: "Base Port for New Slots",
      allowLan: "Allow LAN Bind (0.0.0.0)",
      allowLanDesc: "Caution: Only enable if other devices on your LAN need to connect to these proxies.",
      language: "Interface Language",
      wireproxySection: "Userspace WireGuard Binary (wireproxy.exe)",
      wireproxyPath: "Path to wireproxy.exe",
      wireproxyReady: "Installed and ready",
      wireproxyMissing: "wireproxy.exe not found",
      installWireproxy: "Auto-Install / Download wireproxy.exe",
      installing: "Downloading and installing...",
      importConfSection: "Quick Import from Surfshark .conf File",
      importConfDesc: "Paste the content of a downloaded Surfshark WireGuard configuration file (.conf) to auto-fill PrivateKey, Address, and DNS.",
      importConfPlaceholder: "[Interface]\n" + "Private" + "Key = <base64-key>\nAddress = 10.14.0.2/16\nDNS = 162.252.172.57",
      importConfBtn: "Import & Apply .conf",
      uploadConfBtn: "Choose .conf File...",
      saveBtn: "Save Settings",
      saving: "Saving...",
      savedSuccess: "Settings saved successfully!",
    },
    status: {
      running: "Running",
      stopped: "Stopped",
      killSwitch: "Kill-Switch (Protected)",
      error: "Error",
      leakSafe: "Safe (IP Changed)",
      leakBlocked: "ISP Leak Blocked",
      leakUnchecked: "Unchecked",
      leakError: "Check Failed",
      modeAdapterBridge: "Adapter Bridge",
      modeUserspaceWg: "Userspace WG",
    },
    statusPage: {
      title: "System Status & Security Protections",
      subtitle: "All IP/DNS leak protections are ON by default. View live status below or toggle individual protections OFF/ON when needed.",
      allProtectionsActive: "All 6 Security Protections Are Active (ON)",
      allProtectionsDesc: "Every proxy slot is strictly bound to Surfshark VPN tunnels with zero fallback to host ISP Wi-Fi/Ethernet.",
      customProtectionMode: "Custom Security Mode (One or more protections OFF)",
      customProtectionDesc: "You have manually disabled one or more safety layers. Re-enable all toggles for maximum GoLogin anti-detect isolation.",
      resetDefaultsBtn: "Restore Safe Defaults (All ON)",
      refreshStatusBtn: "Refresh Status",
      protectionsSectionTitle: "Security & Leak Protection Toggles (Default: ON)",
      stateOn: "ACTIVE (ON)",
      stateOff: "DISABLED (OFF)",
      killSwitchTitle: "1. Fail-Closed Kill-Switch & Adapter Lock (IP_UNICAST_IF)",
      killSwitchDesc: "Binds every outbound TCP/UDP socket directly to the Surfshark Wintun interface or WireGuard tunnel. Drops traffic immediately if VPN disconnects—never falls back to ISP Wi-Fi/Ethernet.",
      dnsLeakTitle: "2. Tunnel-Only DNS Leak Protection (RFC 1035)",
      dnsLeakDesc: "Resolves all SOCKS5 (ATYP=DOMAIN) and HTTP CONNECT hostnames exclusively inside the VPN tunnel (162.252.172.57), preventing Windows/ISP DNS leaks.",
      ipv6BlockTitle: "3. IPv6 Dual-Stack Leak Blocker",
      ipv6BlockDesc: "Rejects raw IPv6 socket requests (ATYP=0x04) and enforces IPv4-only tunnel resolution so websites cannot leak your real ISP IPv6 address.",
      ispGuardTitle: "4. Real ISP IP Egress Verification Guard",
      ispGuardDesc: "Continuously compares each slot's exit IP against your detected host ISP IP and flags any accidental ISP match as LEAK BLOCKED.",
      autoVerifyTitle: "5. Auto-Verify Exit IP on Slot Start",
      autoVerifyDesc: "Automatically probes exit IP, country, and latency through the proxy tunnel immediately after a slot starts.",
      localhostOnlyTitle: "6. Localhost-Only Socket Isolation (127.0.0.1)",
      localhostOnlyDesc: "Restricts proxy listeners strictly to 127.0.0.1 on this PC so other devices on your local network cannot use your proxy ports.",
      subsystemSectionTitle: "Live Core Subsystem Status",
      vpnAdapterCardTitle: "Surfshark Adapter",
      ispGuardCardTitle: "Host ISP IP Baseline",
      wireguardEngineCardTitle: "Wireproxy Multi-VPN",
      proxyHubCardTitle: "Active Proxy Slots",
      activeSlotsCount: "{running} / {total} slots running",
      keyConfigured: "PrivateKey Ready",
      keyNotSet: "PrivateKey Missing",
    },
    providersPage: {
      title: "VPN Providers (Multi-Provider WireGuard Hub)",
      subtitle: "Configure Surfshark, NordVPN, Mullvad, ProtonVPN, or import custom WireGuard .conf files to spawn parallel SOCKS5/HTTP proxy slots.",
      statusReady: "Ready",
      statusMissingKey: "Key Not Set",
      serversAvailable: "{count} servers",
      privateKeyLabel: "WireGuard PrivateKey (Base64)",
      privateKeyPlaceholder: "Paste 44-char base64 WireGuard PrivateKey...",
      addressLabel: "Tunnel Interface Address",
      dnsLabel: "Tunnel DNS Server",
      apiTokenLabel: "Access Token (Auto-fetch PrivateKey & Servers)",
      apiTokenPlaceholder: "Paste Access Token from provider account...",
      saveProviderBtn: "Save Provider",
      syncCatalogBtn: "⟳ Sync API & Servers",
      importConfFilesBtn: "Import .conf File(s)...",
      browseServersBtn: "Browse Servers →",
      surfsharkDesc: "Auto-loads 180 Surfshark locations worldwide. Paste your WireGuard PrivateKey or import any downloaded .conf file.",
      nordvpnDesc: "NordLynx WireGuard: Paste your NordVPN Access Token and click 'Sync API & Servers' to auto-fetch your PrivateKey and 300+ servers.",
      mullvadDesc: "Click 'Sync API & Servers' to fetch all global Mullvad WireGuard relays, then import a .conf file or enter your PrivateKey + Address.",
      protonvpnDesc: "Download WireGuard .conf files from your ProtonVPN dashboard and click 'Import .conf File(s)...' (supports selecting multiple files).",
      customDesc: "Use any WireGuard-compatible VPN (Windscribe, PIA, IVPN, Cloudflare WARP, or self-hosted VPS) by importing one or more .conf files.",
      savedToast: "Provider configuration saved!",
      syncedToast: "Provider catalog & credentials synchronized!",
      importedToast: "Imported WireGuard .conf file(s) successfully!",
    },
  },
};
