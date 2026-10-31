import type { AppLanguage } from "./types";

export interface I18nStrings {
  tabs: {
    proxyHub: string;
    surfsharkCatalog: string;
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
}

export const DICTIONARY: Record<AppLanguage, I18nStrings> = {
  vi: {
    tabs: {
      proxyHub: "Proxy Hub",
      surfsharkCatalog: "Surfshark (180 Máy chủ)",
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
      refreshSystem: "Làm mới Adapter & Hệ thống",
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
  },
  en: {
    tabs: {
      proxyHub: "Proxy Hub",
      surfsharkCatalog: "Surfshark (180 Servers)",
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
      refreshSystem: "Refresh System & Adapters",
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
  },
};
