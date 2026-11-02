import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DICTIONARY, type I18nStrings } from "./strings";
import type {
  AppLanguage,
  CreateSlotPayload,
  DetectedAdapter,
  GoLoginProfileSummary,
  HubSnapshot,
  ProviderView,
  ProxySlotView,
  SaveProviderPayload,
  SettingsUpdatePayload,
  SurfsharkLocation,
  VpnProvider,
} from "./types";

const ORDERED_TZ_GROUPS = [
  "asia_utc7",
  "asia_utc8",
  "asia_utc9",
  "us_east",
  "us_central",
  "us_mountain",
  "us_west",
  "eu_west",
  "eu_central",
  "au_east",
  "custom",
] as const;

function detectSystemTimezoneInfo(): {
  tzGroup: string;
  ianaTimezone: string;
  utcOffsetLabel: string;
} {
  let iana = "";
  try {
    iana = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    iana = "";
  }
  const offsetMinutes = -new Date().getTimezoneOffset();
  const offsetHours = Math.round(offsetMinutes / 60);
  const sign = offsetHours >= 0 ? "+" : "";
  const utcOffsetLabel = `UTC${sign}${offsetHours}`;
  const ianaLower = iana.toLowerCase();

  if (
    ianaLower.includes("ho_chi_minh") ||
    ianaLower.includes("saigon") ||
    ianaLower.includes("bangkok") ||
    ianaLower.includes("jakarta") ||
    ianaLower.includes("phnom_penh") ||
    ianaLower.includes("vientiane") ||
    ianaLower.includes("pontianak")
  ) {
    return { tzGroup: "asia_utc7", ianaTimezone: iana || "Asia/Ho_Chi_Minh", utcOffsetLabel };
  }
  if (
    ianaLower.includes("singapore") ||
    ianaLower.includes("hong_kong") ||
    ianaLower.includes("taipei") ||
    ianaLower.includes("kuala_lumpur") ||
    ianaLower.includes("manila") ||
    ianaLower.includes("makassar") ||
    ianaLower.includes("shanghai") ||
    ianaLower.includes("perth")
  ) {
    return { tzGroup: "asia_utc8", ianaTimezone: iana || "Asia/Singapore", utcOffsetLabel };
  }
  if (ianaLower.includes("tokyo") || ianaLower.includes("seoul") || ianaLower.includes("jayapura")) {
    return { tzGroup: "asia_utc9", ianaTimezone: iana || "Asia/Tokyo", utcOffsetLabel };
  }
  if (
    ianaLower.includes("sydney") ||
    ianaLower.includes("melbourne") ||
    ianaLower.includes("brisbane") ||
    ianaLower.includes("hobart") ||
    ianaLower.includes("canberra")
  ) {
    return { tzGroup: "au_east", ianaTimezone: iana || "Australia/Sydney", utcOffsetLabel };
  }
  if (
    ianaLower === "utc" ||
    ianaLower === "etc/utc" ||
    ianaLower === "etc/gmt" ||
    ianaLower.includes("europe/london") ||
    ianaLower.includes("europe/dublin") ||
    ianaLower.includes("europe/lisbon")
  ) {
    return { tzGroup: "eu_west", ianaTimezone: iana || "Europe/London", utcOffsetLabel };
  }
  if (ianaLower.startsWith("europe/")) {
    return { tzGroup: "eu_central", ianaTimezone: iana || "Europe/Berlin", utcOffsetLabel };
  }
  if (
    ianaLower.includes("america/new_york") ||
    ianaLower.includes("america/toronto") ||
    ianaLower.includes("america/montreal") ||
    ianaLower.includes("america/detroit") ||
    ianaLower.includes("america/indiana") ||
    ianaLower.includes("america/kentucky")
  ) {
    return { tzGroup: "us_east", ianaTimezone: iana || "America/New_York", utcOffsetLabel };
  }
  if (
    ianaLower.includes("america/chicago") ||
    ianaLower.includes("america/winnipeg") ||
    ianaLower.includes("america/mexico_city") ||
    ianaLower.includes("america/menominee")
  ) {
    return { tzGroup: "us_central", ianaTimezone: iana || "America/Chicago", utcOffsetLabel };
  }
  if (
    ianaLower.includes("america/denver") ||
    ianaLower.includes("america/phoenix") ||
    ianaLower.includes("america/edmonton") ||
    ianaLower.includes("america/boise")
  ) {
    return { tzGroup: "us_mountain", ianaTimezone: iana || "America/Denver", utcOffsetLabel };
  }
  if (
    ianaLower.includes("america/los_angeles") ||
    ianaLower.includes("america/vancouver") ||
    ianaLower.includes("america/tijuana")
  ) {
    return { tzGroup: "us_west", ianaTimezone: iana || "America/Los_Angeles", utcOffsetLabel };
  }

  switch (offsetHours) {
    case 7:
      return { tzGroup: "asia_utc7", ianaTimezone: iana || "Asia/Ho_Chi_Minh", utcOffsetLabel };
    case 8:
      return { tzGroup: "asia_utc8", ianaTimezone: iana || "Asia/Singapore", utcOffsetLabel };
    case 9:
      return { tzGroup: "asia_utc9", ianaTimezone: iana || "Asia/Tokyo", utcOffsetLabel };
    case 10:
    case 11:
      return { tzGroup: "au_east", ianaTimezone: iana || "Australia/Sydney", utcOffsetLabel };
    case 0:
      return { tzGroup: "eu_west", ianaTimezone: iana || "Europe/London", utcOffsetLabel };
    case 1:
    case 2:
      return { tzGroup: "eu_central", ianaTimezone: iana || "Europe/Berlin", utcOffsetLabel };
    case -5:
    case -4:
      return { tzGroup: "us_east", ianaTimezone: iana || "America/New_York", utcOffsetLabel };
    case -6:
      return { tzGroup: "us_central", ianaTimezone: iana || "America/Chicago", utcOffsetLabel };
    case -7:
      return { tzGroup: "us_mountain", ianaTimezone: iana || "America/Denver", utcOffsetLabel };
    case -8:
      return { tzGroup: "us_west", ianaTimezone: iana || "America/Los_Angeles", utcOffsetLabel };
    default:
      return { tzGroup: "asia_utc7", ianaTimezone: iana || "Asia/Ho_Chi_Minh", utcOffsetLabel };
  }
}

// State
let snapshot: HubSnapshot | null = null;
let currentLanguage: AppLanguage = "en";
let activeTab: "hub" | "status" | "catalog" | "providers" | "gologin" | "settings" = "hub";

// Catalog filter state (defaults to host machine's current timezone)
let catalogSearchQuery = "";
let catalogFilterType: "all" | "generic" | "static" = "all";
let catalogProviderFilter: "all" | VpnProvider = "all";
let catalogTzFilter: string = detectSystemTimezoneInfo().tzGroup;
let catalogGeoClusterFilter: string = "all";
let modalMultiTzFilter: string = detectSystemTimezoneInfo().tzGroup;

// GoLogin assignment selection state: profileId -> slotId
const gologinSlotSelection: Record<string, string> = {};
const gologinModeSelection: Record<string, "socks5" | "http"> = {};

// Hub slot GoLogin selection state: slotId -> profileId
const hubSlotGologinSelection: Record<string, string> = {};

// Modal states
let isCreateBridgeModalOpen = false;
let isCreateMultiModalOpen = false;

// Toast helper
let toastTimeout: number | undefined;

function getStrings(): I18nStrings {
  return DICTIONARY[currentLanguage];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function showToast(message: string, durationMs = 3200): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  if (toastTimeout !== undefined) {
    window.clearTimeout(toastTimeout);
  }

  container.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  toastTimeout = window.setTimeout(() => {
    container.innerHTML = "";
    toastTimeout = undefined;
  }, durationMs);
}

// Crisp Flag Badge Helper (28x20px styled badge)
function renderFlagBadge(countryCode: string): string {
  const code = (countryCode || "UN").toUpperCase();
  return `<span class="flag-badge" aria-label="${escapeHtml(code)}">${escapeHtml(code)}</span>`;
}

function getTimezoneGroupInfo(
  tzGroup: string,
  utcOffset = "",
  ianaTimezone = ""
): {
  shortPill: string;
  tzBadge: string;
  groupLabel: string;
} {
  const isVi = currentLanguage === "vi";
  switch (tzGroup) {
    case "asia_utc7":
      return {
        shortPill: "🇻🇳 UTC+7 (SEA)",
        tzBadge: "UTC+7 • Asia/Ho_Chi_Minh",
        groupLabel: isVi
          ? "🇻🇳 UTC+7 (Asia/Ho_Chi_Minh) — Đông Nam Á (Việt Nam, Thái Lan, Indonesia, Campuchia)"
          : "🇻🇳 UTC+7 (Asia/Ho_Chi_Minh) — Southeast Asia (Vietnam, Thailand, Indonesia, Cambodia)",
      };
    case "asia_utc8":
      return {
        shortPill: "🇸🇬 UTC+8 (APAC)",
        tzBadge: "UTC+8 • Asia/Singapore",
        groupLabel: isVi
          ? "🇸🇬 UTC+8 (Asia/Singapore) — Hub Cáp Biển Châu Á & Tây Úc (Singapore, HK, Đài Loan, Malaysia, Perth)"
          : "🇸🇬 UTC+8 (Asia/Singapore) — APAC Cable Hubs & WA (Singapore, HK, Taiwan, Malaysia, Perth)",
      };
    case "asia_utc9":
      return {
        shortPill: "🇯🇵 UTC+9 (JP/KR)",
        tzBadge: "UTC+9 • Asia/Tokyo",
        groupLabel: isVi
          ? "🇯🇵 UTC+9 (Asia/Tokyo) — Đông Á Băng Thông Lớn (Nhật Bản, Hàn Quốc)"
          : "🇯🇵 UTC+9 (Asia/Tokyo) — East Asia High-Speed Backbone (Japan, South Korea)",
      };
    case "us_east":
      return {
        shortPill: "🇺🇸 UTC-5 (US East)",
        tzBadge: "UTC-5 • America/New_York",
        groupLabel: isVi
          ? "🇺🇸 UTC-5 (America/New_York) — Hoa Kỳ & Canada Bờ Đông (NY, Miami, Atlanta, Ashburn, Boston, Toronto)"
          : "🇺🇸 UTC-5 (America/New_York) — US & Canada East Coast (NY, Miami, Atlanta, Ashburn, Boston, Toronto)",
      };
    case "us_central":
      return {
        shortPill: "🇺🇸 UTC-6 (US Central)",
        tzBadge: "UTC-6 • America/Chicago",
        groupLabel: isVi
          ? "🇺🇸 UTC-6 (America/Chicago) — Hoa Kỳ Miền Trung (Dallas, Houston, Chicago, Nashville, Omaha, Kansas)"
          : "🇺🇸 UTC-6 (America/Chicago) — US Central (Dallas, Houston, Chicago, Nashville, Omaha, Kansas)",
      };
    case "us_mountain":
      return {
        shortPill: "🇺🇸 UTC-7 (US Mountain)",
        tzBadge: "UTC-7 • America/Denver",
        groupLabel: isVi
          ? "🇺🇸 UTC-7 (America/Denver) — Hoa Kỳ Miền Núi (Denver, Salt Lake City, Phoenix)"
          : "🇺🇸 UTC-7 (America/Denver) — US Mountain (Denver, Salt Lake City, Phoenix)",
      };
    case "us_west":
      return {
        shortPill: "🇺🇸 UTC-8 (US West)",
        tzBadge: "UTC-8 • America/Los_Angeles",
        groupLabel: isVi
          ? "🇺🇸 UTC-8 (America/Los_Angeles) — Hoa Kỳ & Canada Bờ Tây (LA, Seattle, San Jose, SF, Las Vegas, Vancouver)"
          : "🇺🇸 UTC-8 (America/Los_Angeles) — US & Canada West Coast (LA, Seattle, San Jose, SF, Las Vegas, Vancouver)",
      };
    case "eu_west":
      return {
        shortPill: "🇬🇧 UTC+0 (UK/IE)",
        tzBadge: "UTC+0 • Europe/London",
        groupLabel: isVi
          ? "🇬🇧 UTC+0 (Europe/London) — Anh Quốc & Ireland (London, Manchester, Glasgow, Dublin)"
          : "🇬🇧 UTC+0 (Europe/London) — UK & Ireland (London, Manchester, Glasgow, Dublin)",
      };
    case "eu_central":
      return {
        shortPill: "🇩🇪 UTC+1 (EU Central)",
        tzBadge: "UTC+1 • Europe/Berlin",
        groupLabel: isVi
          ? "🇩🇪 UTC+1 (Europe/Berlin) — Trung Âu (Frankfurt, Amsterdam, Paris, Zurich, Milan, Madrid)"
          : "🇩🇪 UTC+1 (Europe/Berlin) — Central Europe (Frankfurt, Amsterdam, Paris, Zurich, Milan, Madrid)",
      };
    case "au_east":
      return {
        shortPill: "🇦🇺 UTC+10 (AU East)",
        tzBadge: "UTC+10 • Australia/Sydney",
        groupLabel: isVi
          ? "🇦🇺 UTC+10 (Australia/Sydney) — Đông Úc (Sydney, Melbourne, Brisbane)"
          : "🇦🇺 UTC+10 (Australia/Sydney) — Australia East (Sydney, Melbourne, Brisbane)",
      };
    default:
      return {
        shortPill: "⚙ Custom",
        tzBadge: utcOffset && ianaTimezone ? `${utcOffset} • ${ianaTimezone}` : isVi ? "Tùy chỉnh" : "Custom",
        groupLabel: isVi ? "⚙ Máy chủ Tùy chỉnh (.conf)" : "⚙ Custom Imported Servers (.conf)",
      };
  }
}

export interface GeoClusterMeta {
  clusterId: string;
  clusterLabel: string;
  shortBadge: string;
  safeNeighborsNote: string;
  lat: number;
  lon: number;
}

function getGeoClusterAndCoords(
  countryCode: string,
  location: string,
  connectionName: string,
  tzGroup = ""
): GeoClusterMeta {
  const isVi = currentLanguage === "vi";
  const cc = (countryCode || "").trim().toUpperCase();
  const city = (location || "").trim().toLowerCase();
  const conn = (connectionName || "").trim().toLowerCase();

  // 1. UTC+7 (Southeast Asia)
  if (cc === "VN") {
    const isHanoi = city.includes("ha noi") || city.includes("hanoi") || conn.includes("han");
    return {
      clusterId: "sea_indochina",
      clusterLabel: isVi
        ? "🇻🇳🇰🇭🇹🇭 Cụm Đông Dương: Việt Nam ↔ Campuchia ↔ Thái Lan (Chuyển đổi hợp lý < 750 km)"
        : "🇻🇳🇰🇭🇹🇭 Indochina Cluster: Vietnam ↔ Cambodia ↔ Thailand (Safe Hop < 750 km)",
      shortBadge: isVi ? "🟢 Cụm Đông Dương (VN/KH/TH)" : "🟢 Indochina (VN/KH/TH)",
      safeNeighborsNote: isVi
        ? "Đổi an toàn: VN ↔ Phnom Penh (~210 km) / Bangkok (~740 km). Tránh nhảy sang Jakarta (~1,890 km)"
        : "Safe hop: VN ↔ Phnom Penh (~210 km) / Bangkok (~740 km). Avoid Jakarta (~1,890 km)",
      lat: isHanoi ? 21.0285 : 10.8231,
      lon: isHanoi ? 105.8542 : 106.6297,
    };
  }
  if (cc === "KH") {
    return {
      clusterId: "sea_indochina",
      clusterLabel: isVi
        ? "🇻🇳🇰🇭🇹🇭 Cụm Đông Dương: Việt Nam ↔ Campuchia ↔ Thái Lan (Chuyển đổi hợp lý < 750 km)"
        : "🇻🇳🇰🇭🇹🇭 Indochina Cluster: Vietnam ↔ Cambodia ↔ Thailand (Safe Hop < 750 km)",
      shortBadge: isVi ? "🟢 Cụm Đông Dương (VN/KH/TH)" : "🟢 Indochina (VN/KH/TH)",
      safeNeighborsNote: isVi
        ? "Đổi an toàn: Phnom Penh ↔ TP.HCM (~210 km) / Bangkok (~530 km). Tránh Jakarta (~1,980 km)"
        : "Safe hop: Phnom Penh ↔ HCMC (~210 km) / Bangkok (~530 km). Avoid Jakarta (~1,980 km)",
      lat: 11.5564,
      lon: 104.9282,
    };
  }
  if (cc === "TH") {
    return {
      clusterId: "sea_indochina",
      clusterLabel: isVi
        ? "🇻🇳🇰🇭🇹🇭 Cụm Đông Dương: Việt Nam ↔ Campuchia ↔ Thái Lan (Chuyển đổi hợp lý < 750 km)"
        : "🇻🇳🇰🇭🇹🇭 Indochina Cluster: Vietnam ↔ Cambodia ↔ Thailand (Safe Hop < 750 km)",
      shortBadge: isVi ? "🟢 Cụm Đông Dương (VN/KH/TH)" : "🟢 Indochina (VN/KH/TH)",
      safeNeighborsNote: isVi
        ? "Đổi an toàn: Bangkok ↔ Phnom Penh (~530 km) / TP.HCM (~740 km). Tránh Jakarta (~2,320 km)"
        : "Safe hop: Bangkok ↔ Phnom Penh (~530 km) / HCMC (~740 km). Avoid Jakarta (~2,320 km)",
      lat: 13.7563,
      lon: 100.5018,
    };
  }
  if (cc === "ID") {
    return {
      clusterId: "sea_jakarta",
      clusterLabel: isVi
        ? "🇮🇩 Cụm Đảo Indonesia: Jakarta (Cách VN ~1,890 km — Chỉ nên đổi nội bộ ID)"
        : "🇮🇩 Indonesia Cluster: Jakarta (~1,890 km from VN — Switch within ID only)",
      shortBadge: isVi ? "⚠️ Đảo xa (Chỉ đổi trong ID)" : "⚠️ Isolated (Switch within ID)",
      safeNeighborsNote: isVi
        ? "Cách TP.HCM ~1,890 km qua biển: chỉ nên đổi sang máy chủ Jakarta khác để tránh Impossible Travel"
        : "~1,890 km across sea from VN: only failover to another Jakarta node",
      lat: -6.2088,
      lon: 106.8456,
    };
  }

  // 2. UTC+8 (APAC) — Strictly separate SG+MY vs HK+TW vs PH vs Perth!
  if (cc === "SG") {
    return {
      clusterId: "apac_sg_my",
      clusterLabel: isVi
        ? "🇸🇬🇲🇾 Cụm Eo Biển Malacca: Singapore ↔ Malaysia (~315 km — Sát biên giới, hợp lý)"
        : "🇸🇬🇲🇾 Malacca Strait Cluster: Singapore ↔ Malaysia (~315 km — Border Neighbor)",
      shortBadge: isVi ? "🟢 Cụm SG ↔ MY (~315 km)" : "🟢 SG ↔ MY Cluster (~315 km)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý: Singapore ↔ Malaysia (~315 km). Phi logic nếu nhảy sang Manila (~2,390 km), HK (~2,585 km), Taipei (~3,245 km)"
        : "Safe hop: Singapore ↔ Malaysia (~315 km). Impossible travel if jumping to Manila/HK/Taipei/Perth",
      lat: 1.3521,
      lon: 103.8198,
    };
  }
  if (cc === "MY") {
    return {
      clusterId: "apac_sg_my",
      clusterLabel: isVi
        ? "🇸🇬🇲🇾 Cụm Eo Biển Malacca: Singapore ↔ Malaysia (~315 km — Sát biên giới, hợp lý)"
        : "🇸🇬🇲🇾 Malacca Strait Cluster: Singapore ↔ Malaysia (~315 km — Border Neighbor)",
      shortBadge: isVi ? "🟢 Cụm SG ↔ MY (~315 km)" : "🟢 SG ↔ MY Cluster (~315 km)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý: Malaysia ↔ Singapore (~315 km). Phi logic nếu nhảy sang Manila (~2,460 km), HK (~2,540 km), Taipei (~3,220 km)"
        : "Safe hop: Malaysia ↔ Singapore (~315 km). Impossible travel if jumping to Manila/HK/Taipei/Perth",
      lat: 3.139,
      lon: 101.6869,
    };
  }
  if (cc === "HK") {
    return {
      clusterId: "apac_hk_tw",
      clusterLabel: isVi
        ? "🇭🇰🇹🇼 Cụm Đông Á (UTC+8): Hong Kong ↔ Đài Loan (~810 km — Cách SG ~2,585 km)"
        : "🇭🇰🇹🇼 East Asia (UTC+8) Cluster: Hong Kong ↔ Taiwan (~810 km — ~2,585 km from SG)",
      shortBadge: isVi ? "🟢 Cụm HK ↔ TW (~810 km)" : "🟢 HK ↔ TW Cluster (~810 km)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý: Hong Kong ↔ Taipei (~810 km). Tránh nhảy về Singapore/Malaysia (~2,585 km)"
        : "Safe hop: Hong Kong ↔ Taipei (~810 km). Avoid jumping to Singapore/Malaysia (~2,585 km)",
      lat: 22.3193,
      lon: 114.1694,
    };
  }
  if (cc === "TW") {
    return {
      clusterId: "apac_hk_tw",
      clusterLabel: isVi
        ? "🇭🇰🇹🇼 Cụm Đông Á (UTC+8): Hong Kong ↔ Đài Loan (~810 km — Cách SG ~3,245 km)"
        : "🇭🇰🇹🇼 East Asia (UTC+8) Cluster: Hong Kong ↔ Taiwan (~810 km — ~3,245 km from SG)",
      shortBadge: isVi ? "🟢 Cụm HK ↔ TW (~810 km)" : "🟢 HK ↔ TW Cluster (~810 km)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý: Taipei ↔ Hong Kong (~810 km). Phi logic nếu nhảy từ Singapore sang Taipei (~3,245 km)"
        : "Safe hop: Taipei ↔ Hong Kong (~810 km). Impossible travel from Singapore (~3,245 km)",
      lat: 25.033,
      lon: 121.5654,
    };
  }
  if (cc === "PH") {
    return {
      clusterId: "apac_ph",
      clusterLabel: isVi
        ? "🇵🇭 Cụm Đảo Philippines: Manila (Cách SG ~2,390 km — Chỉ nên đổi nội bộ PH)"
        : "🇵🇭 Philippines Cluster: Manila (~2,390 km from SG — Switch within PH only)",
      shortBadge: isVi ? "⚠️ Đảo Manila (Chỉ đổi nội bộ PH)" : "⚠️ Manila Island (PH only)",
      safeNeighborsNote: isVi
        ? "Manila cách Singapore ~2,390 km qua Biển Đông: chỉ nên đổi giữa các máy chủ Manila"
        : "Manila is ~2,390 km from Singapore: failover within Manila nodes only",
      lat: 14.5995,
      lon: 120.9842,
    };
  }
  if (cc === "AU" && (city.includes("perth") || conn.startsWith("au-per") || tzGroup === "asia_utc8")) {
    return {
      clusterId: "apac_perth",
      clusterLabel: isVi
        ? "🇦🇺 Cụm Tây Úc: Perth (Cách SG ~3,910 km — Chỉ nên đổi nội bộ Perth)"
        : "🇦🇺 Western Australia: Perth (~3,910 km from SG — Switch within Perth only)",
      shortBadge: isVi ? "⚠️ Tây Úc Perth (Cách SG ~3,910 km)" : "⚠️ Perth WA (~3,910 km from SG)",
      safeNeighborsNote: isVi
        ? "Perth cách Singapore ~3,910 km: tuyệt đối không đổi qua lại với SG/MY/HK/TW/PH"
        : "Perth is ~3,910 km from Singapore: never hop between Perth and SG/MY/HK/TW/PH",
      lat: -31.9505,
      lon: 115.8605,
    };
  }

  // 3. UTC+9 (Japan / Korea)
  if (cc === "JP") {
    const isOsaka = city.includes("osaka") || conn.includes("osa");
    return {
      clusterId: "ea_japan",
      clusterLabel: isVi
        ? "🇯🇵 Cụm Nội Địa Nhật Bản: Tokyo ↔ Osaka (~400 km)"
        : "🇯🇵 Japan Domestic Cluster: Tokyo ↔ Osaka (~400 km)",
      shortBadge: isVi ? "🟢 Nội địa Nhật (Tokyo/Osaka)" : "🟢 Japan Domestic",
      safeNeighborsNote: isVi
        ? "Đổi an toàn: Tokyo ↔ Osaka (~400 km). Cách Seoul ~1,150 km qua biển"
        : "Safe hop: Tokyo ↔ Osaka (~400 km). Seoul is ~1,150 km across sea",
      lat: isOsaka ? 34.6937 : 35.6762,
      lon: isOsaka ? 135.5023 : 139.6503,
    };
  }
  if (cc === "KR") {
    return {
      clusterId: "ea_korea",
      clusterLabel: isVi
        ? "🇰🇷 Cụm Hàn Quốc: Seoul (Cách Tokyo ~1,150 km — Chỉ nên đổi nội bộ KR)"
        : "🇰🇷 South Korea Cluster: Seoul (~1,150 km from Tokyo — Switch within KR only)",
      shortBadge: isVi ? "🟢 Cụm Seoul (Nội bộ KR)" : "🟢 Seoul (KR only)",
      safeNeighborsNote: isVi
        ? "Đổi an toàn giữa các node Seoul. Tránh nhảy qua Tokyo (~1,150 km)"
        : "Safe hop within Seoul nodes. Avoid jumping to Tokyo (~1,150 km)",
      lat: 37.5665,
      lon: 126.978,
    };
  }

  // 4. US & Canada East (UTC-5)
  if (tzGroup === "us_east") {
    if (city.includes("miami") || city.includes("orlando") || city.includes("tampa") || conn.startsWith("us-mia")) {
      return {
        clusterId: "use_florida",
        clusterLabel: isVi
          ? "🇺🇸 Cụm Florida: Miami / Orlando (Cách New York ~1,750 km)"
          : "🇺🇸 Florida Cluster: Miami / Orlando (~1,750 km from NY)",
        shortBadge: isVi ? "🟢 Cụm Florida (Miami)" : "🟢 Florida (Miami)",
        safeNeighborsNote: isVi
          ? "Chỉ đổi trong cụm Florida. Cách New York ~1,750 km (Impossible Travel nếu nhảy lên NY)"
          : "Switch within Florida only (~1,750 km from New York)",
        lat: city.includes("orlando") || city.includes("tampa") ? 28.5383 : 25.7617,
        lon: city.includes("orlando") || city.includes("tampa") ? -81.3792 : -80.1918,
      };
    }
    if (city.includes("atlanta") || city.includes("charlotte") || conn.startsWith("us-atl") || conn.startsWith("us-clt")) {
      return {
        clusterId: "use_southeast",
        clusterLabel: isVi
          ? "🇺🇸 Cụm Đông Nam Mỹ: Atlanta ↔ Charlotte (~365 km)"
          : "🇺🇸 US Southeast Cluster: Atlanta ↔ Charlotte (~365 km)",
        shortBadge: isVi ? "🟢 Cụm Atlanta ↔ Charlotte" : "🟢 Atlanta ↔ Charlotte",
        safeNeighborsNote: isVi
          ? "Đổi hợp lý: Atlanta ↔ Charlotte (~365 km). Cách New York ~1,200 km"
          : "Safe hop: Atlanta ↔ Charlotte (~365 km). ~1,200 km from New York",
        lat: city.includes("charlotte") || conn.startsWith("us-clt") ? 35.2271 : 33.749,
        lon: city.includes("charlotte") || conn.startsWith("us-clt") ? -80.8431 : -84.388,
      };
    }
    let lat = 40.7128;
    let lon = -74.006;
    if (city.includes("boston") || conn.startsWith("us-bos")) {
      lat = 42.3601;
      lon = -71.0589;
    } else if (city.includes("ashburn") || city.includes("washington") || conn.startsWith("us-ash")) {
      lat = 39.0438;
      lon = -77.4874;
    } else if (city.includes("latham") || conn.startsWith("us-ltm")) {
      lat = 42.747;
      lon = -73.759;
    } else if (city.includes("buffalo") || conn.startsWith("us-buf")) {
      lat = 42.8864;
      lon = -78.8784;
    } else if (city.includes("toronto") || conn.startsWith("ca-tor")) {
      lat = 43.6532;
      lon = -79.3832;
    } else if (city.includes("montreal") || conn.startsWith("ca-mon")) {
      lat = 45.5017;
      lon = -73.5673;
    } else if (city.includes("detroit") || conn.startsWith("us-dtw")) {
      lat = 42.3314;
      lon = -83.0458;
    }
    return {
      clusterId: "use_northeast",
      clusterLabel: isVi
        ? "🇺🇸🇨🇦 Cụm Đông Bắc Mỹ: New York ↔ Boston ↔ Ashburn ↔ Buffalo ↔ Toronto (< 550 km)"
        : "🇺🇸🇨🇦 Northeast Corridor: NY ↔ Boston ↔ Ashburn ↔ Buffalo ↔ Toronto (< 550 km)",
      shortBadge: isVi ? "🟢 Cụm Đông Bắc (NY/BOS/ASH/TOR)" : "🟢 Northeast (NY/BOS/ASH/TOR)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý trong trục NY / Newark / Boston / Ashburn / Buffalo / Toronto (< 550 km). Tránh nhảy xuống Miami (~1,750 km)"
        : "Safe hop within NY / Boston / Ashburn / Toronto corridor. Avoid Miami (~1,750 km)",
      lat,
      lon,
    };
  }

  // 5. US Central (UTC-6)
  if (tzGroup === "us_central") {
    if (city.includes("dallas") || city.includes("houston") || city.includes("austin") || conn.startsWith("us-dal") || conn.startsWith("us-hou")) {
      return {
        clusterId: "usc_texas",
        clusterLabel: isVi
          ? "🇺🇸 Cụm Texas: Dallas ↔ Houston (~360 km)"
          : "🇺🇸 Texas Cluster: Dallas ↔ Houston (~360 km)",
        shortBadge: isVi ? "🟢 Cụm Texas (Dallas ↔ Houston)" : "🟢 Texas (Dallas ↔ Houston)",
        safeNeighborsNote: isVi
          ? "Đổi hợp lý: Dallas ↔ Houston (~360 km). Tránh nhảy lên Chicago (~1,290 km)"
          : "Safe hop: Dallas ↔ Houston (~360 km). Avoid Chicago (~1,290 km)",
        lat: city.includes("houston") || conn.startsWith("us-hou") ? 29.7604 : 32.7767,
        lon: city.includes("houston") || conn.startsWith("us-hou") ? -95.3698 : -96.797,
      };
    }
    let lat = 41.8781;
    let lon = -87.6298;
    if (city.includes("st. louis") || city.includes("saint louis") || conn.startsWith("us-stl")) {
      lat = 38.627;
      lon = -90.1994;
    } else if (city.includes("kansas") || conn.startsWith("us-kan")) {
      lat = 39.0997;
      lon = -94.5786;
    } else if (city.includes("omaha") || conn.startsWith("us-oma")) {
      lat = 41.2565;
      lon = -95.9345;
    } else if (city.includes("nashville") || conn.startsWith("us-bna")) {
      lat = 36.1627;
      lon = -86.7816;
    }
    return {
      clusterId: "usc_midwest",
      clusterLabel: isVi
        ? "🇺🇸 Cụm Midwest: Chicago ↔ St. Louis ↔ Kansas ↔ Omaha (< 650 km)"
        : "🇺🇸 Midwest Cluster: Chicago ↔ St. Louis ↔ Kansas ↔ Omaha (< 650 km)",
      shortBadge: isVi ? "🟢 Cụm Midwest (CHI/STL/KAN)" : "🟢 Midwest (CHI/STL/KAN)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý trong cụm Midwest (< 650 km). Cách Texas (Dallas/Houston) ~1,290 km"
        : "Safe hop within Midwest (< 650 km). ~1,290 km from Texas",
      lat,
      lon,
    };
  }

  // 6. US Mountain (UTC-7)
  if (tzGroup === "us_mountain") {
    if (city.includes("phoenix") || conn.startsWith("us-phx")) {
      return {
        clusterId: "usm_phoenix",
        clusterLabel: isVi
          ? "🇺🇸 Cụm Tây Nam: Phoenix (Cách Denver ~940 km)"
          : "🇺🇸 Southwest Cluster: Phoenix (~940 km from Denver)",
        shortBadge: isVi ? "🟢 Cụm Arizona (Phoenix)" : "🟢 Arizona (Phoenix)",
        safeNeighborsNote: isVi
          ? "Cách Denver ~940 km: nên đổi nội bộ Phoenix"
          : "~940 km from Denver: prefer switching within Phoenix",
        lat: 33.4484,
        lon: -112.074,
      };
    }
    return {
      clusterId: "usm_rockies",
      clusterLabel: isVi
        ? "🇺🇸 Cụm Rockies: Denver ↔ Salt Lake City (~595 km)"
        : "🇺🇸 Rockies Cluster: Denver ↔ Salt Lake City (~595 km)",
      shortBadge: isVi ? "🟢 Cụm Denver ↔ Salt Lake" : "🟢 Denver ↔ Salt Lake",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý: Denver ↔ Salt Lake City (~595 km)"
        : "Safe hop: Denver ↔ Salt Lake City (~595 km)",
      lat: city.includes("salt lake") || conn.startsWith("us-slc") ? 40.7608 : 39.7392,
      lon: city.includes("salt lake") || conn.startsWith("us-slc") ? -111.891 : -104.9903,
    };
  }

  // 7. US & Canada West (UTC-8)
  if (tzGroup === "us_west") {
    if (city.includes("seattle") || city.includes("vancouver") || city.includes("bend") || conn.startsWith("us-sea") || conn.startsWith("ca-van") || conn.startsWith("us-bdn")) {
      return {
        clusterId: "usw_pnw",
        clusterLabel: isVi
          ? "🇺🇸🇨🇦 Cụm Tây Bắc (PNW): Seattle ↔ Vancouver ↔ Bend (< 420 km)"
          : "🇺🇸🇨🇦 Pacific Northwest: Seattle ↔ Vancouver ↔ Bend (< 420 km)",
        shortBadge: isVi ? "🟢 Cụm Seattle ↔ Vancouver" : "🟢 Seattle ↔ Vancouver",
        safeNeighborsNote: isVi
          ? "Đổi hợp lý: Seattle ↔ Vancouver (~190 km) / Bend (~420 km). Tránh nhảy xuống LA (~1,540 km)"
          : "Safe hop: Seattle ↔ Vancouver (~190 km). Avoid Los Angeles (~1,540 km)",
        lat: city.includes("vancouver") || conn.startsWith("ca-van") ? 49.2827 : city.includes("bend") || conn.startsWith("us-bdn") ? 44.0582 : 47.6062,
        lon: city.includes("vancouver") || conn.startsWith("ca-van") ? -123.1207 : city.includes("bend") || conn.startsWith("us-bdn") ? -121.3153 : -122.3321,
      };
    }
    let lat = 34.0522;
    let lon = -118.2437;
    if (city.includes("las vegas") || conn.startsWith("us-las")) {
      lat = 36.1699;
      lon = -115.1398;
    } else if (city.includes("san jose") || city.includes("san francisco") || conn.startsWith("us-sjc") || conn.startsWith("us-sfo")) {
      lat = 37.3382;
      lon = -121.8863;
    }
    return {
      clusterId: "usw_cal_nv",
      clusterLabel: isVi
        ? "🇺🇸 Cụm California & Nevada: Los Angeles ↔ Las Vegas ↔ San Jose/SF (< 550 km)"
        : "🇺🇸 California & Nevada: LA ↔ Las Vegas ↔ San Jose/SF (< 550 km)",
      shortBadge: isVi ? "🟢 Cụm LA ↔ Vegas ↔ San Jose" : "🟢 LA ↔ Vegas ↔ San Jose",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý: LA ↔ Las Vegas (~365 km) / San Jose (~500 km). Tránh nhảy lên Seattle (~1,540 km)"
        : "Safe hop: LA ↔ Las Vegas (~365 km) / San Jose (~500 km). Avoid Seattle (~1,540 km)",
      lat,
      lon,
    };
  }

  // 8. UK & Ireland (UTC+0)
  if (tzGroup === "eu_west") {
    let lat = 51.5074;
    let lon = -0.1278;
    if (city.includes("manchester") || conn.startsWith("uk-man")) {
      lat = 53.4808;
      lon = -2.2426;
    } else if (city.includes("glasgow") || conn.startsWith("uk-gla")) {
      lat = 55.8642;
      lon = -4.2518;
    } else if (cc === "IE" || city.includes("dublin") || conn.startsWith("ie-dub")) {
      lat = 53.3498;
      lon = -6.2603;
    }
    return {
      clusterId: "euw_uk_ie",
      clusterLabel: isVi
        ? "🇬🇧🇮🇪 Cụm Anh Quốc & Ireland: London ↔ Manchester ↔ Glasgow ↔ Dublin (< 555 km)"
        : "🇬🇧🇮🇪 UK & Ireland Cluster: London ↔ Manchester ↔ Glasgow ↔ Dublin (< 555 km)",
      shortBadge: isVi ? "🟢 Cụm UK ↔ Ireland (< 555 km)" : "🟢 UK ↔ Ireland (< 555 km)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý giữa London, Manchester (~260 km), Dublin (~460 km), Glasgow (~555 km)"
        : "Safe hop across London, Manchester (~260 km), Dublin (~460 km), Glasgow (~555 km)",
      lat,
      lon,
    };
  }

  // 9. Central Europe (UTC+1)
  if (tzGroup === "eu_central") {
    if (cc === "ES" || city.includes("madrid")) {
      return {
        clusterId: "euc_iberia",
        clusterLabel: isVi
          ? "🇪🇸 Cụm Bán Đảo Iberia: Madrid (Cách Frankfurt ~1,445 km)"
          : "🇪🇸 Iberia Cluster: Madrid (~1,445 km from Frankfurt)",
        shortBadge: isVi ? "⚠️ Cụm Madrid (Cách Trung Âu ~1,445 km)" : "⚠️ Madrid (~1,445 km from DE)",
        safeNeighborsNote: isVi
          ? "Madrid cách Frankfurt ~1,445 km: chỉ nên đổi nội bộ Tây Ban Nha"
          : "Madrid is ~1,445 km from Frankfurt: switch within Spain only",
        lat: 40.4168,
        lon: -3.7038,
      };
    }
    if (cc === "SE" || city.includes("stockholm")) {
      return {
        clusterId: "euc_nordic",
        clusterLabel: isVi
          ? "🇸🇪 Cụm Bắc Âu: Stockholm (Cách Frankfurt ~1,185 km)"
          : "🇸🇪 Nordic Cluster: Stockholm (~1,185 km from Frankfurt)",
        shortBadge: isVi ? "⚠️ Cụm Bắc Âu (Stockholm)" : "⚠️ Nordic (Stockholm)",
        safeNeighborsNote: isVi
          ? "Stockholm cách Trung Âu > 1,100 km: chỉ nên đổi nội bộ Thụy Điển"
          : "Stockholm is > 1,100 km from Central Europe: switch within Sweden only",
        lat: 59.3293,
        lon: 18.0686,
      };
    }
    let lat = 50.1109;
    let lon = 8.6821;
    if (city.includes("berlin") || conn.startsWith("de-ber")) {
      lat = 52.52;
      lon = 13.405;
    } else if (cc === "NL" || city.includes("amsterdam")) {
      lat = 52.3676;
      lon = 4.9041;
    } else if (cc === "BE" || city.includes("brussels")) {
      lat = 50.8503;
      lon = 4.3517;
    } else if (cc === "FR" || city.includes("paris")) {
      lat = 48.8566;
      lon = 2.3522;
    } else if (cc === "CH" || city.includes("zurich")) {
      lat = 47.3769;
      lon = 8.5417;
    } else if (cc === "AT" || city.includes("vienna")) {
      lat = 48.2082;
      lon = 16.3738;
    } else if (cc === "IT" || city.includes("milan")) {
      lat = 45.4642;
      lon = 9.19;
    }
    return {
      clusterId: "euc_core",
      clusterLabel: isVi
        ? "🇩🇪🇳🇱🇧🇪🇫🇷🇨🇭🇮🇹 Cụm Lõi Trung Âu: Frankfurt ↔ Amsterdam ↔ Brussels ↔ Paris ↔ Zurich ↔ Milan (< 520 km)"
        : "🇩🇪🇳🇱🇧🇪🇫🇷🇨🇭🇮🇹 Central Europe Core: Frankfurt ↔ Amsterdam ↔ Brussels ↔ Paris ↔ Zurich ↔ Milan (< 520 km)",
      shortBadge: isVi ? "🟢 Lõi Trung Âu (DE/NL/FR/CH)" : "🟢 EU Core (DE/NL/FR/CH)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý giữa Frankfurt, Amsterdam (~360 km), Zurich (~305 km), Paris (~475 km). Tránh nhảy sang Madrid (~1,445 km)"
        : "Safe hop across Frankfurt, Amsterdam (~360 km), Zurich (~305 km), Paris (~475 km). Avoid Madrid (~1,445 km)",
      lat,
      lon,
    };
  }

  // 10. Australia East (UTC+10)
  if (tzGroup === "au_east") {
    let lat = -33.8688;
    let lon = 151.2093;
    if (city.includes("melbourne") || conn.startsWith("au-mel")) {
      lat = -37.8136;
      lon = 144.9631;
    } else if (city.includes("brisbane") || conn.startsWith("au-bne")) {
      lat = -27.4698;
      lon = 153.0251;
    }
    return {
      clusterId: "aue_east",
      clusterLabel: isVi
        ? "🇦🇺 Cụm Bờ Đông Úc: Sydney ↔ Melbourne / Brisbane (~710 km)"
        : "🇦🇺 Australia East Coast: Sydney ↔ Melbourne / Brisbane (~710 km)",
      shortBadge: isVi ? "🟢 Cụm Đông Úc (SYD/MEL/BNE)" : "🟢 AU East (SYD/MEL/BNE)",
      safeNeighborsNote: isVi
        ? "Đổi hợp lý: Sydney ↔ Melbourne (~710 km) hoặc Sydney ↔ Brisbane (~730 km)"
        : "Safe hop: Sydney ↔ Melbourne (~710 km) or Sydney ↔ Brisbane (~730 km)",
      lat,
      lon,
    };
  }

  return {
    clusterId: "custom_cluster",
    clusterLabel: isVi ? "⚙ Cụm Máy chủ Tùy chỉnh (.conf)" : "⚙ Custom Imported Servers (.conf)",
    shortBadge: "⚙ Custom",
    safeNeighborsNote: isVi ? "Máy chủ tùy chỉnh (.conf)" : "Custom imported server (.conf)",
    lat: 0,
    lon: 0,
  };
}

function calculateGeoDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if ((lat1 === 0 && lon1 === 0) || (lat2 === 0 && lon2 === 0)) return 0;
  if (Math.abs(lat1 - lat2) < 0.01 && Math.abs(lon1 - lon2) < 0.01) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

type TravelRiskLevel = "same_city" | "nearby_safe" | "impossible_travel";

interface FailoverEvaluation {
  loc: SurfsharkLocation;
  distanceKm: number;
  sameCluster: boolean;
  riskLevel: TravelRiskLevel;
}

function evaluateSlotFailoverCandidate(
  currentLoc: SurfsharkLocation | undefined,
  slot: ProxySlotView,
  candidate: SurfsharkLocation
): FailoverEvaluation {
  const curGeo = currentLoc
    ? getGeoClusterAndCoords(
        currentLoc.countryCode,
        currentLoc.location,
        currentLoc.connectionName,
        currentLoc.tzGroup
      )
    : getGeoClusterAndCoords(
        slot.countryCode,
        slot.locationLabel,
        slot.connectionName,
        slot.tzGroup
      );
  const candGeo = getGeoClusterAndCoords(
    candidate.countryCode,
    candidate.location,
    candidate.connectionName,
    candidate.tzGroup
  );
  const distanceKm = calculateGeoDistanceKm(curGeo.lat, curGeo.lon, candGeo.lat, candGeo.lon);
  const sameCluster = curGeo.clusterId === candGeo.clusterId;

  let riskLevel: TravelRiskLevel = "impossible_travel";
  if (distanceKm <= 60) {
    riskLevel = "same_city";
  } else if (sameCluster && distanceKm <= 850) {
    riskLevel = "nearby_safe";
  } else {
    riskLevel = "impossible_travel";
  }

  return {
    loc: candidate,
    distanceKm,
    sameCluster,
    riskLevel,
  };
}

function getLocationTimezoneMeta(loc: SurfsharkLocation): {
  tzGroup: string;
  shortPill: string;
  tzBadge: string;
  groupLabel: string;
} {
  const tzGroup = loc.tzGroup || "custom";
  const info = getTimezoneGroupInfo(tzGroup, loc.utcOffset, loc.ianaTimezone);
  return {
    tzGroup,
    ...info,
  };
}

function renderGroupedLocationOptions(locations: SurfsharkLocation[]): string {
  const groups = new Map<string, SurfsharkLocation[]>();
  for (const loc of locations) {
    const geo = getGeoClusterAndCoords(
      loc.countryCode,
      loc.location,
      loc.connectionName,
      loc.tzGroup
    );
    const list = groups.get(geo.clusterLabel) || [];
    list.push(loc);
    groups.set(geo.clusterLabel, list);
  }
  let html = "";
  for (const [groupLabel, locs] of groups.entries()) {
    const opts = locs
      .map((loc) => {
        const meta = getLocationTimezoneMeta(loc);
        const geo = getGeoClusterAndCoords(
          loc.countryCode,
          loc.location,
          loc.connectionName,
          loc.tzGroup
        );
        const typeSuffix = loc.locationType === "static" ? " • Static IP" : "";
        return `<option value="${escapeHtml(loc.id)}" data-default-name="${escapeHtml(`${loc.countryCode} • ${loc.country} - ${loc.location}`)}">
          [${escapeHtml(loc.countryCode)}] ${escapeHtml(loc.country)} — ${escapeHtml(loc.location)} (${escapeHtml(meta.tzBadge)} • ${escapeHtml(geo.shortBadge)}${typeSuffix} • ${loc.load}% load)
        </option>`;
      })
      .join("");
    html += `<optgroup label="${escapeHtml(groupLabel)}">${opts}</optgroup>`;
  }
  return html;
}

// IPC helper wrappers
async function fetchSnapshot(): Promise<void> {
  try {
    const res = await invoke<HubSnapshot>("get_hub_snapshot");
    applySnapshot(res);
  } catch (err) {
    showToast(`Failed to load state: ${String(err)}`);
  }
}

function applySnapshot(newSnapshot: HubSnapshot): void {
  snapshot = newSnapshot;
  if (newSnapshot.settings.language) {
    currentLanguage = newSnapshot.settings.language;
    document.documentElement.lang = currentLanguage;
  }
  render();
}

async function handleRefreshSystem(): Promise<void> {
  showToast(currentLanguage === "vi" ? "Đang làm mới thông tin hệ thống..." : "Refreshing system adapters...");
  try {
    const res = await invoke<HubSnapshot>("refresh_system_state");
    applySnapshot(res);
    showToast(currentLanguage === "vi" ? "Đã cập nhật hệ thống!" : "System updated!");
  } catch (err) {
    showToast(`Error: ${String(err)}`);
  }
}

async function handleToggleSlot(slotId: string, start: boolean): Promise<void> {
  try {
    const res = await invoke<HubSnapshot>("toggle_slot", { slotId, start });
    applySnapshot(res);
    if (start && res.settings.autoVerifyIp) {
      const startedSlot = res.slots.find((s) => s.id === slotId);
      if (startedSlot && startedSlot.status === "running") {
        window.setTimeout(() => {
          void handleCheckSlotIp(slotId);
        }, 500);
      }
    }
  } catch (err) {
    showToast(`Error: ${String(err)}`);
  }
}

async function handleStartAllSlots(): Promise<void> {
  showToast(currentLanguage === "vi" ? "Đang bật tất cả các slot..." : "Starting all proxy slots...");
  try {
    const res = await invoke<HubSnapshot>("start_all_slots");
    applySnapshot(res);
    showToast(currentLanguage === "vi" ? "Đã bật các slot khả dụng!" : "Started available proxy slots!");
  } catch (err) {
    showToast(`Error: ${String(err)}`);
  }
}

async function handleStopAllSlots(): Promise<void> {
  try {
    const res = await invoke<HubSnapshot>("stop_all_slots");
    applySnapshot(res);
    showToast(currentLanguage === "vi" ? "Đã dừng tất cả slot!" : "All proxy slots stopped!");
  } catch (err) {
    showToast(`Error: ${String(err)}`);
  }
}

async function handleCheckAllSlotIps(): Promise<void> {
  if (!snapshot) return;
  const runningSlots = snapshot.slots.filter((s) => s.status === "running");
  if (runningSlots.length === 0) {
    showToast(
      currentLanguage === "vi"
        ? "Chưa có slot nào đang chạy để kiểm tra IP"
        : "No running proxy slots to check"
    );
    return;
  }
  showToast(
    currentLanguage === "vi"
      ? `Đang kiểm tra IP cho ${runningSlots.length} slot...`
      : `Checking exit IP for ${runningSlots.length} running slot(s)...`
  );
  for (const s of runningSlots) {
    await handleCheckSlotIp(s.id);
  }
}

async function handleCopyAllSocks5(): Promise<void> {
  if (!snapshot || snapshot.slots.length === 0) return;
  const lines = snapshot.slots.map((s) => s.socks5Uri).join("\n");
  try {
    await navigator.clipboard.writeText(lines);
    showToast(getStrings().hub.copiedAll);
  } catch {
    showToast("Copy failed");
  }
}

async function handleQuickSwitchLanguage(lang: AppLanguage): Promise<void> {
  if (!snapshot || currentLanguage === lang) return;
  currentLanguage = lang;
  document.documentElement.lang = lang;
  render();
  const payload: SettingsUpdatePayload = {
    wgPrivateKey: null,
    wgAddress: snapshot.settings.wgAddress,
    wgDns: snapshot.settings.wgDns,
    gologinToken: null,
    basePort: snapshot.settings.basePort,
    allowLan: snapshot.settings.allowLan,
    language: lang,
    wireproxyPath: snapshot.settings.wireproxyPath,
    killSwitchEnabled: snapshot.settings.killSwitchEnabled,
    dnsLeakProtection: snapshot.settings.dnsLeakProtection,
    ipv6LeakBlock: snapshot.settings.ipv6LeakBlock,
    ispIpGuard: snapshot.settings.ispIpGuard,
    autoVerifyIp: snapshot.settings.autoVerifyIp,
  };
  try {
    const res = await invoke<HubSnapshot>("save_settings", { payload });
    applySnapshot(res);
  } catch (err) {
    showToast(`Error: ${String(err)}`);
  }
}

async function handleToggleSecurityFeature(feature: string, enabled: boolean): Promise<void> {
  try {
    const res = await invoke<HubSnapshot>("set_security_toggle", { feature, enabled });
    applySnapshot(res);
    if (feature === "resetAll") {
      showToast(
        currentLanguage === "vi"
          ? "Đã khôi phục toàn bộ 6 lớp bảo vệ về mặc định (BẬT)!"
          : "All 6 security protections restored to safe defaults (ON)!"
      );
    } else {
      showToast(
        currentLanguage === "vi"
          ? `Đã ${enabled ? "BẬT (ON)" : "TẮT (OFF)"} tính năng bảo vệ`
          : `Protection ${enabled ? "ENABLED (ON)" : "DISABLED (OFF)"}`
      );
    }
  } catch (err) {
    showToast(`Security Toggle Error: ${String(err)}`);
  }
}

async function handleDeleteSlot(slotId: string): Promise<void> {
  const confirmMsg =
    currentLanguage === "vi"
      ? "Bạn có chắc chắn muốn xóa Slot Proxy này không?"
      : "Are you sure you want to delete this Proxy Slot?";
  if (!window.confirm(confirmMsg)) return;

  try {
    const res = await invoke<HubSnapshot>("delete_slot", { slotId });
    applySnapshot(res);
    showToast(currentLanguage === "vi" ? "Đã xóa slot" : "Slot deleted");
  } catch (err) {
    showToast(`Error: ${String(err)}`);
  }
}

async function handleCheckSlotIp(slotId: string): Promise<void> {
  showToast(currentLanguage === "vi" ? "Đang kiểm tra IP và rò rỉ DNS..." : "Checking IP & leak status...");
  try {
    const res = await invoke<HubSnapshot>("check_slot_ip", { slotId });
    applySnapshot(res);
    const slot = res.slots.find((s) => s.id === slotId);
    if (slot?.egress) {
      if (slot.egress.leakStatus === "safe") {
        showToast(
          currentLanguage === "vi"
            ? `An toàn! Exit IP: ${slot.egress.exitIp} (${slot.egress.country}) - ${slot.egress.latencyMs}ms`
            : `Safe! Exit IP: ${slot.egress.exitIp} (${slot.egress.country}) - ${slot.egress.latencyMs}ms`
        );
      } else if (slot.egress.leakStatus === "leak_blocked") {
        showToast(
          currentLanguage === "vi"
            ? `CẢNH BÁO RÒ RỈ: ${slot.egress.errorMessage}`
            : `LEAK BLOCKED: ${slot.egress.errorMessage}`
        );
      }
    }
  } catch (err) {
    showToast(`Error: ${String(err)}`);
  }
}

async function handleSwitchSlotLocation(slotId: string, locationId: string): Promise<void> {
  if (!slotId || !locationId) return;

  if (snapshot) {
    const slot = snapshot.slots.find((s) => s.id === slotId);
    const targetLoc = snapshot.locations.find((l) => l.id === locationId);
    if (slot && targetLoc) {
      const currentLoc = snapshot.locations.find(
        (l) => l.id === slot.locationId || l.connectionName === slot.connectionName
      );
      const evalRes = evaluateSlotFailoverCandidate(currentLoc, slot, targetLoc);
      if (evalRes.riskLevel === "impossible_travel") {
        const sameTzSafe = snapshot.locations
          .filter(
            (l) =>
              l.tzGroup === slot.tzGroup &&
              l.provider === slot.provider &&
              l.id !== slot.locationId &&
              l.connectionName !== slot.connectionName
          )
          .map((l) => evaluateSlotFailoverCandidate(currentLoc, slot, l))
          .filter((e) => e.riskLevel === "same_city" || e.riskLevel === "nearby_safe")
          .sort((a, b) => a.distanceKm - b.distanceKm || a.loc.load - b.loc.load);

        const safeSuggestion =
          sameTzSafe.length > 0
            ? `[${sameTzSafe[0].loc.countryCode}] ${sameTzSafe[0].loc.location} (${sameTzSafe[0].distanceKm === 0 ? "0 km" : `~${sameTzSafe[0].distanceKm} km`})`
            : currentLanguage === "vi"
              ? "máy chủ khác ngay tại cùng thành phố"
              : "another node in the exact same city";

        const curLabel = currentLoc
          ? `[${currentLoc.countryCode}] ${currentLoc.location}`
          : `[${slot.countryCode}] ${slot.locationLabel || slot.connectionName}`;
        const targetLabel = `[${targetLoc.countryCode}] ${targetLoc.location}`;

        const warnMsg =
          currentLanguage === "vi"
            ? `⚠️ CẢNH BÁO DI CHUYỂN PHI LOGIC (Impossible Travel Guard)!\n\n` +
              `• Hiện tại: ${curLabel}\n` +
              `• Đích chuyển tới: ${targetLabel}\n` +
              `• Khoảng cách thực tế: ~${evalRes.distanceKm.toLocaleString()} km (Dù cùng múi giờ ${slot.utcOffset || ""})\n\n` +
              `Việc đổi IP nhảy xa hàng nghìn km chỉ sau vài phút rất dễ bị các nền tảng (Google, Facebook, TikTok, Amazon, GoLogin...) phát hiện bất thường vị trí (Impossible Travel).\n\n` +
              `💡 Gợi ý an toàn: Hãy chọn ${safeSuggestion}.\n\n` +
              `Bạn có chắc chắn vẫn muốn ép buộc chuyển sang ${targetLabel}?`
            : `⚠️ IMPOSSIBLE TRAVEL WARNING!\n\n` +
              `• Current: ${curLabel}\n` +
              `• Target: ${targetLabel}\n` +
              `• Real Distance: ~${evalRes.distanceKm.toLocaleString()} km (Same timezone ${slot.utcOffset || ""})\n\n` +
              `Jumping thousands of kilometers within minutes triggers anti-fraud Impossible Travel detection on platforms.\n\n` +
              `💡 Safe recommendation: Pick ${safeSuggestion}.\n\n` +
              `Force switch to ${targetLabel} anyway?`;

        if (!window.confirm(warnMsg)) {
          render();
          return;
        }
      }
    }
  }

  showToast(
    currentLanguage === "vi"
      ? "Đang chuyển sang máy chủ mới cùng múi giờ..."
      : "Switching to backup server in the same timezone..."
  );
  try {
    const res = await invoke<HubSnapshot>("switch_slot_location", { slotId, locationId });
    applySnapshot(res);
    showToast(
      currentLanguage === "vi"
        ? "Đã chuyển máy chủ cùng múi giờ thành công!"
        : "Switched to same-timezone server!"
    );
    const updatedSlot = res.slots.find((s) => s.id === slotId);
    if (updatedSlot && updatedSlot.status === "running" && res.settings.autoVerifyIp) {
      window.setTimeout(() => {
        void handleCheckSlotIp(slotId);
      }, 500);
    }
  } catch (err) {
    showToast(`Switch Error: ${String(err)}`);
  }
}

async function handleCreateSlot(payload: CreateSlotPayload, switchToHub = false): Promise<void> {
  try {
    const prevIds = new Set((snapshot?.slots || []).map((s) => s.id));
    const res = await invoke<HubSnapshot>("create_slot", { payload });
    isCreateBridgeModalOpen = false;
    isCreateMultiModalOpen = false;
    if (switchToHub) {
      activeTab = "hub";
    }
    applySnapshot(res);
    showToast(currentLanguage === "vi" ? "Tạo slot thành công!" : "Slot created successfully!");
    if (payload.autoStart && res.settings.autoVerifyIp) {
      const created = res.slots.find((s) => !prevIds.has(s.id) && s.status === "running");
      if (created) {
        window.setTimeout(() => {
          void handleCheckSlotIp(created.id);
        }, 600);
      }
    }
  } catch (err) {
    showToast(`Error: ${String(err)}`);
  }
}

async function handleFetchGoLoginProfiles(): Promise<void> {
  showToast(currentLanguage === "vi" ? "Đang tải profile từ GoLogin API..." : "Fetching GoLogin profiles...");
  try {
    const res = await invoke<HubSnapshot>("fetch_gologin_profiles");
    applySnapshot(res);
    showToast(
      currentLanguage === "vi"
        ? `Đã tải ${res.gologinProfiles.length} profiles!`
        : `Fetched ${res.gologinProfiles.length} profiles!`
    );
  } catch (err) {
    showToast(`GoLogin Error: ${String(err)}`);
  }
}

async function handleAssignSlotToGoLogin(slotId: string, profileId: string, proxyMode: string): Promise<void> {
  if (!slotId || !profileId) {
    showToast(currentLanguage === "vi" ? "Vui lòng chọn slot và profile" : "Please select both slot and profile");
    return;
  }
  showToast(currentLanguage === "vi" ? "Đang đồng bộ tới GoLogin..." : "Syncing to GoLogin profile...");
  try {
    const res = await invoke<HubSnapshot>("assign_slot_to_gologin", {
      slotId,
      profileId,
      proxyMode,
    });
    applySnapshot(res);
    showToast(currentLanguage === "vi" ? "Đồng bộ proxy thành công!" : "Proxy synchronized successfully!");
  } catch (err) {
    showToast(`GoLogin Error: ${String(err)}`);
  }
}

async function handleSaveSettings(payload: SettingsUpdatePayload): Promise<void> {
  try {
    const res = await invoke<HubSnapshot>("save_settings", { payload });
    applySnapshot(res);
    showToast(getStrings().settings.savedSuccess);
  } catch (err) {
    showToast(`Settings Error: ${String(err)}`);
  }
}

async function handleImportWgConf(rawConf: string): Promise<void> {
  if (!rawConf.trim()) {
    showToast(currentLanguage === "vi" ? "Vui lòng dán nội dung file .conf" : "Please paste .conf content");
    return;
  }
  try {
    const res = await invoke<HubSnapshot>("import_wg_conf", { rawConf });
    applySnapshot(res);
    showToast(currentLanguage === "vi" ? "Đã nhập cấu hình .conf thành công!" : "Imported .conf successfully!");
  } catch (err) {
    showToast(`Import Error: ${String(err)}`);
  }
}

async function handleInstallWireproxy(): Promise<void> {
  showToast(getStrings().settings.installing);
  try {
    const res = await invoke<HubSnapshot>("install_wireproxy");
    applySnapshot(res);
    showToast(
      currentLanguage === "vi" ? "Đã tải và cài đặt wireproxy thành công!" : "wireproxy downloaded and installed!"
    );
  } catch (err) {
    showToast(`Install Error: ${String(err)}`);
  }
}

async function handleSaveProviderConfig(payload: SaveProviderPayload): Promise<void> {
  try {
    const res = await invoke<HubSnapshot>("save_provider_config", { payload });
    applySnapshot(res);
    showToast(getStrings().providersPage.savedToast);
  } catch (err) {
    showToast(`Provider Error: ${String(err)}`);
  }
}

async function handleSyncProviderCatalog(provider: VpnProvider, pendingToken?: string): Promise<void> {
  showToast(
    currentLanguage === "vi"
      ? `Đang đồng bộ danh sách máy chủ ${provider.toUpperCase()}...`
      : `Syncing ${provider.toUpperCase()} catalog & credentials...`
  );
  try {
    if (pendingToken && pendingToken.trim() && !pendingToken.includes("•") && snapshot) {
      const provView = snapshot.providers.find((p) => p.provider === provider);
      if (provView) {
        await invoke<HubSnapshot>("save_provider_config", {
          payload: {
            provider,
            privateKey: null,
            address: provView.address,
            dns: provView.dns,
            apiToken: pendingToken.trim(),
          } satisfies SaveProviderPayload,
        });
      }
    }
    const res = await invoke<HubSnapshot>("sync_provider_catalog", { provider });
    applySnapshot(res);
    showToast(getStrings().providersPage.syncedToast);
  } catch (err) {
    showToast(`Sync Error: ${String(err)}`);
  }
}

async function handleImportProviderConfs(provider: VpnProvider, files: FileList): Promise<void> {
  let latestSnap: HubSnapshot | null = null;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rawConf = await file.text();
      const label = file.name.replace(/\.conf$/i, "").replace(/\.txt$/i, "");
      latestSnap = await invoke<HubSnapshot>("import_provider_conf", {
        provider,
        rawConf,
        label,
      });
    }
    if (latestSnap) {
      applySnapshot(latestSnap);
      showToast(getStrings().providersPage.importedToast);
    }
  } catch (err) {
    showToast(`Import Error: ${String(err)}`);
  }
}

async function handleDeleteCustomServer(provider: VpnProvider, locationId: string): Promise<void> {
  try {
    const res = await invoke<HubSnapshot>("delete_custom_server", {
      provider,
      locationId,
    });
    applySnapshot(res);
  } catch (err) {
    showToast(`Delete Error: ${String(err)}`);
  }
}

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} ${getStrings().hub.copied}`);
  } catch {
    showToast(`Copy failed`);
  }
}

// 1. Sidebar Rail Component
function renderSidebarRail(): string {
  const strings = getStrings();
  return `
    <aside class="sidebar-rail">
      <div class="sidebar-logo" title="s-proxy Hub">
        <svg viewBox="0 0 256 256" width="36" height="36" fill="none">
          <path d="M191 36 C174 9 140 0 98 2 C62 4 40 14 35 42 C30 74 27 124 32 156 C36 182 59 205 102 226 C144 246 184 256 208 254 C226 252 229 230 225 196 C219 148 206 64 191 36 Z" fill="#2563EB"/>
          <path d="M94 168 A22 22 0 0 0 116 146 L116 76 A18 18 0 0 1 134 58 L141 58 A27 32 0 0 1 141 122 L116 122" stroke="#FFFFFF" stroke-width="23" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <nav class="sidebar-nav">
        <button type="button" class="nav-btn tab-btn ${activeTab === "hub" ? "active" : ""}" data-tab="hub" title="${escapeHtml(strings.tabs.proxyHub)}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </button>
        <button type="button" class="nav-btn tab-btn ${activeTab === "status" ? "active" : ""}" data-tab="status" title="${escapeHtml(strings.tabs.statusTab)}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </button>
        <button type="button" class="nav-btn tab-btn ${activeTab === "catalog" ? "active" : ""}" data-tab="catalog" title="${escapeHtml(strings.tabs.surfsharkCatalog)}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </button>
        <button type="button" class="nav-btn tab-btn ${activeTab === "providers" ? "active" : ""}" data-tab="providers" title="${escapeHtml(strings.tabs.providersTab)}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
        </button>
        <button type="button" class="nav-btn tab-btn ${activeTab === "gologin" ? "active" : ""}" data-tab="gologin" title="${escapeHtml(strings.tabs.gologinSync)}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="2" y1="9" x2="22" y2="9"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="10" y1="6" x2="10.01" y2="6"/>
          </svg>
        </button>
        <button type="button" class="nav-btn tab-btn ${activeTab === "settings" ? "active" : ""}" data-tab="settings" title="${escapeHtml(strings.tabs.settings)}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <div class="lang-switch-rail" role="group" aria-label="Language">
          <button type="button" class="lang-btn ${currentLanguage === "en" ? "active" : ""}" data-lang="en">EN</button>
          <button type="button" class="lang-btn ${currentLanguage === "vi" ? "active" : ""}" data-lang="vi">VI</button>
        </div>
      </div>
    </aside>
  `;
}

function renderStatusBadge(status: ProxySlotView["status"]): string {
  const strings = getStrings();
  switch (status) {
    case "running":
      return `<span class="badge badge-running">${escapeHtml(strings.status.running)}</span>`;
    case "stopped":
      return `<span class="badge badge-stopped">${escapeHtml(strings.status.stopped)}</span>`;
    case "kill_switch":
      return `<span class="badge badge-kill">${escapeHtml(strings.status.killSwitch)}</span>`;
    case "error":
      return `<span class="badge badge-kill">${escapeHtml(strings.status.error)}</span>`;
  }
}

function renderLeakBadge(slot: ProxySlotView): string {
  const strings = getStrings();
  const egress = slot.egress;
  if (!egress) {
    return `<span class="badge badge-stopped">${escapeHtml(strings.status.leakUnchecked)}</span>`;
  }
  switch (egress.leakStatus) {
    case "safe":
      return `<span class="badge badge-safe">${escapeHtml(strings.status.leakSafe)}</span>`;
    case "leak_blocked":
      return `<span class="badge badge-leak">${escapeHtml(strings.status.leakBlocked)}</span>`;
    case "error":
      return `<span class="badge badge-kill">${escapeHtml(strings.status.leakError)}</span>`;
    default:
      return `<span class="badge badge-stopped">${escapeHtml(strings.status.leakUnchecked)}</span>`;
  }
}

// 2. View 1: Proxy Hub Tab
function renderHubTab(snap: HubSnapshot): string {
  const strings = getStrings();
  const surf = snap.surfsharkAdapter;
  const isSurfConnected = surf && surf.statusUp && !surf.ipv4.startsWith("169.254.") && surf.ipv4 !== "";
  const isWireproxyReady = snap.settings.wireproxyReady;

  const slotCards =
    snap.slots.length === 0
      ? `<div class="empty-card">${escapeHtml(strings.hub.emptySlots)}</div>`
      : snap.slots
          .map((slot) => {
            const isRunning = slot.status === "running";
            const currentSelectedProfile =
              hubSlotGologinSelection[slot.id] || slot.linkedGologinProfileId || "";

            const profileOptions = snap.gologinProfiles
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.id)}" ${p.id === currentSelectedProfile ? "selected" : ""}>
                    ${escapeHtml(p.name)} (${escapeHtml(p.os)})
                  </option>`
              )
              .join("");

            const egressInfo = slot.egress
              ? `<span class="mono bold">${escapeHtml(slot.egress.exitIp)}</span>
                 <span class="subtext">${escapeHtml(slot.egress.city ? `${slot.egress.city}, ` : "")}${escapeHtml(slot.egress.country)} &bull; ${slot.egress.latencyMs}ms</span>`
              : `<span class="subtext">${escapeHtml(strings.status.leakUnchecked)}</span>`;

            const iconBadgeText =
              slot.mode === "adapter_bridge"
                ? "⚡"
                : `🌐 ${escapeHtml(slot.countryCode || "")}`;

            const slotTzInfo =
              slot.mode === "userspace_wg" && slot.tzGroup
                ? getTimezoneGroupInfo(slot.tzGroup, slot.utcOffset, slot.ianaTimezone)
                : null;

            const sameTzAlternatives =
              slot.mode === "userspace_wg" && slot.tzGroup
                ? snap.locations.filter(
                    (l) => l.tzGroup === slot.tzGroup && l.provider === slot.provider
                  )
                : [];

            const currentSlotLoc =
              slot.mode === "userspace_wg"
                ? snap.locations.find(
                    (l) => l.id === slot.locationId || l.connectionName === slot.connectionName
                  )
                : undefined;

            const currentSlotGeo =
              slot.mode === "userspace_wg"
                ? getGeoClusterAndCoords(
                    currentSlotLoc?.countryCode || slot.countryCode,
                    currentSlotLoc?.location || slot.locationLabel,
                    currentSlotLoc?.connectionName || slot.connectionName,
                    slot.tzGroup
                  )
                : null;

            const renderFailoverOptionsHtml = (): string => {
              const evaluated = sameTzAlternatives
                .map((alt) => evaluateSlotFailoverCandidate(currentSlotLoc, slot, alt))
                .sort((a, b) => a.distanceKm - b.distanceKm || a.loc.load - b.loc.load);

              const sameCityList = evaluated.filter((e) => e.riskLevel === "same_city");
              const nearbySafeList = evaluated.filter((e) => e.riskLevel === "nearby_safe");
              const impossibleList = evaluated.filter((e) => e.riskLevel === "impossible_travel");

              const renderOpt = (e: FailoverEvaluation): string => {
                const alt = e.loc;
                const isSelected =
                  alt.id === slot.locationId || alt.connectionName === slot.connectionName;
                const staticTag = alt.locationType === "static" ? " (Static)" : "";
                let prefixIcon = "🟢";
                let distText = "0 km";
                if (e.riskLevel === "nearby_safe") {
                  prefixIcon = "🟡";
                  distText =
                    currentLanguage === "vi"
                      ? `~${e.distanceKm} km • Hợp lý`
                      : `~${e.distanceKm} km • Safe hop`;
                } else if (e.riskLevel === "impossible_travel") {
                  prefixIcon = "🔴";
                  distText =
                    currentLanguage === "vi"
                      ? `~${e.distanceKm} km • Phi logic!`
                      : `~${e.distanceKm} km • Impossible Travel!`;
                } else {
                  distText =
                    isSelected
                      ? currentLanguage === "vi"
                        ? "Đang dùng"
                        : "Current"
                      : currentLanguage === "vi"
                        ? "0 km • Cùng vị trí"
                        : "0 km • Same city";
                }
                return `<option value="${escapeHtml(alt.id)}" ${isSelected ? "selected" : ""}>
                  ${prefixIcon} [${escapeHtml(alt.countryCode)}] ${escapeHtml(alt.location)}${staticTag} (${distText} • ${alt.load}% load)
                </option>`;
              };

              let out = "";
              if (sameCityList.length > 0) {
                const label =
                  currentLanguage === "vi"
                    ? "🟢 An toàn tuyệt đối — Cùng thành phố / vị trí (0 km)"
                    : "🟢 Safest — Same City / Location (0 km)";
                out += `<optgroup label="${escapeHtml(label)}">${sameCityList.map(renderOpt).join("")}</optgroup>`;
              }
              if (nearbySafeList.length > 0) {
                const label =
                  currentLanguage === "vi"
                    ? "🟡 Di chuyển hợp lý — Láng giềng gần (< 850 km, cùng cụm)"
                    : "🟡 Realistic Hop — Nearby Neighbor (< 850 km, same cluster)";
                out += `<optgroup label="${escapeHtml(label)}">${nearbySafeList.map(renderOpt).join("")}</optgroup>`;
              }
              if (impossibleList.length > 0) {
                const label =
                  currentLanguage === "vi"
                    ? "🔴 CẢNH BÁO PHI LOGIC — Quá xa (> 850 km, dễ bị detect Impossible Travel)"
                    : "🔴 IMPOSSIBLE TRAVEL WARNING — Too Far (> 850 km, platform detection risk)";
                out += `<optgroup label="${escapeHtml(label)}">${impossibleList.map(renderOpt).join("")}</optgroup>`;
              }
              return out;
            };

            const sameTzSwitcherHtml =
              slot.mode === "userspace_wg" && sameTzAlternatives.length > 1
                ? `<div class="slot-subtext subtext" style="margin-top:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                     <span class="badge badge-os mono" title="${escapeHtml(slotTzInfo?.groupLabel || "")}">🕒 ${escapeHtml(slotTzInfo?.tzBadge || "")}</span>
                     ${currentSlotGeo ? `<span class="badge badge-safe" title="${escapeHtml(currentSlotGeo.safeNeighborsNote)}">${escapeHtml(currentSlotGeo.shortBadge)}</span>` : ""}
                     <select class="select-input select-same-tz-switch" data-slot-id="${escapeHtml(slot.id)}" style="height:26px; font-size:12px; padding:2px 8px; max-width:320px;" title="${currentLanguage === "vi" ? "Bộ lọc chống Impossible Travel: Ưu tiên đổi cùng thành phố (🟢) hoặc láng giềng gần (🟡), cảnh báo nếu chọn nơi quá xa (🔴)" : "Impossible Travel Guard: Prioritizes same-city (🟢) or nearby neighbor (🟡), warns on distant jump (🔴)"}">
                       ${renderFailoverOptionsHtml()}
                     </select>
                   </div>`
                : slotTzInfo
                  ? `<div class="slot-subtext subtext" style="margin-top:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                       <span class="badge badge-os mono">🕒 ${escapeHtml(slotTzInfo.tzBadge)}</span>
                       ${currentSlotGeo ? `<span class="badge badge-safe" title="${escapeHtml(currentSlotGeo.safeNeighborsNote)}">${escapeHtml(currentSlotGeo.shortBadge)}</span>` : ""}
                     </div>`
                  : "";

            return `
              <div class="surf-card slot-card" data-slot-id="${escapeHtml(slot.id)}">
                <div class="slot-block-left">
                  <div class="dark-icon-badge" title="${slot.mode === "adapter_bridge" ? "Adapter Bridge" : "Multi-VPN"}">
                    ${iconBadgeText}
                  </div>
                  <div class="slot-left-info">
                    <div class="slot-name">${escapeHtml(slot.name)}</div>
                    <div class="slot-subtext subtext">
                      <span class="mono">${escapeHtml(slot.listenHost)}:${slot.port}</span>
                      <span class="bullet">&bull;</span>
                      <span class="badge ${slot.mode === "adapter_bridge" ? "badge-running" : "badge-safe"}">
                        ${slot.mode === "adapter_bridge" ? escapeHtml(strings.status.modeAdapterBridge) : escapeHtml(strings.status.modeUserspaceWg)}
                      </span>
                      <span class="bullet">&bull;</span>
                      <span class="mono">${escapeHtml(slot.connectionName || slot.boundAdapterName || slot.adapterHint || "auto")}</span>
                    </div>
                    ${sameTzSwitcherHtml}
                  </div>
                </div>

                <div class="slot-block-egress">
                  <div class="egress-top-row">
                    ${renderStatusBadge(slot.status)}
                    ${renderLeakBadge(slot)}
                    ${
                      isRunning
                        ? `<span class="traffic-text mono">${slot.activeConnections} conn &bull; ${formatBytes(slot.bytesTransferred)}</span>`
                        : ""
                    }
                  </div>
                  <div class="egress-ip-row">
                    ${egressInfo}
                  </div>
                </div>

                <div class="slot-block-gologin">
                  <select class="select-input select-hub-profile" data-slot-id="${escapeHtml(slot.id)}">
                    <option value="">${escapeHtml(strings.hub.selectProfilePrompt)}</option>
                    ${profileOptions}
                  </select>
                  <button type="button" class="btn btn-secondary btn-sm btn-hub-sync" data-slot-id="${escapeHtml(slot.id)}">
                    ${escapeHtml(strings.hub.sync)}
                  </button>
                </div>

                <div class="slot-block-actions">
                  <div class="btn-group-sm">
                    <button type="button" class="btn btn-sm btn-secondary btn-copy" data-copy="${escapeHtml(slot.socks5Uri)}" data-label="SOCKS5">
                      ${escapeHtml(strings.hub.copySocks5)}
                    </button>
                    <button type="button" class="btn btn-sm btn-secondary btn-copy" data-copy="${escapeHtml(slot.httpUri)}" data-label="HTTP">
                      ${escapeHtml(strings.hub.copyHttp)}
                    </button>
                    <button type="button" class="btn btn-sm btn-secondary btn-check-ip" data-slot-id="${escapeHtml(slot.id)}" ${!isRunning ? "disabled" : ""}>
                      ${escapeHtml(strings.hub.checkIp)}
                    </button>
                  </div>
                  <div class="btn-group-sm">
                    <button type="button" class="btn btn-sm ${isRunning ? "btn-danger" : "btn-primary"} btn-toggle-slot" data-slot-id="${escapeHtml(slot.id)}" data-start="${!isRunning}">
                      ${isRunning ? escapeHtml(strings.hub.stop) : escapeHtml(strings.hub.start)}
                    </button>
                    <button type="button" class="btn btn-sm btn-danger btn-delete-slot" data-slot-id="${escapeHtml(slot.id)}">
                      ${escapeHtml(strings.hub.delete)}
                    </button>
                  </div>
                </div>
              </div>
            `;
          })
          .join("");

  const adapterRows = snap.adapters
    .map((ad: DetectedAdapter) => {
      let kindBadge = `<span class="badge">${escapeHtml(ad.kind)}</span>`;
      if (ad.kind === "surfshark") {
        kindBadge = `<span class="badge badge-safe">${escapeHtml(strings.hub.kindSurfshark)}</span>`;
      } else if (ad.kind === "primary_isp") {
        kindBadge = `<span class="badge badge-kill">${escapeHtml(strings.hub.kindPrimaryIsp)}</span>`;
      } else if (ad.kind === "other_vpn") {
        kindBadge = `<span class="badge badge-stopped">${escapeHtml(strings.hub.kindOtherVpn)}</span>`;
      }

      return `
        <tr>
          <td><strong>${escapeHtml(ad.name)}</strong> ${ad.isDefaultRoute ? '<span class="badge badge-safe">Default Route</span>' : ""}</td>
          <td class="subtext">${escapeHtml(ad.description)}</td>
          <td class="mono">${escapeHtml(ad.ipv4 || "N/A")}</td>
          <td>
            <span class="badge ${ad.statusUp ? "badge-running" : "badge-stopped"}">
              ${ad.statusUp ? "UP" : "DOWN"}
            </span>
          </td>
          <td>${kindBadge}</td>
        </tr>
      `;
    })
    .join("");

  const sysTzInfo = detectSystemTimezoneInfo();
  const modalTzCounts = new Map<string, number>();
  for (const loc of snap.locations) {
    const g = loc.tzGroup || "custom";
    modalTzCounts.set(g, (modalTzCounts.get(g) || 0) + 1);
  }
  const availableModalTzGroups = ORDERED_TZ_GROUPS.filter(
    (g) => (modalTzCounts.get(g) || 0) > 0 || g === sysTzInfo.tzGroup
  );
  const effectiveModalTz =
    modalMultiTzFilter === "all" || modalTzCounts.has(modalMultiTzFilter)
      ? modalMultiTzFilter
      : modalTzCounts.has(sysTzInfo.tzGroup)
        ? sysTzInfo.tzGroup
        : availableModalTzGroups[0] || "all";

  const modalFilteredLocations =
    effectiveModalTz === "all"
      ? snap.locations
      : snap.locations.filter((l) => (l.tzGroup || "custom") === effectiveModalTz);
  const multiServerOptions = renderGroupedLocationOptions(modalFilteredLocations);

  const modalTzOptionsHtml = [
    ...availableModalTzGroups.map((g) => {
      const info = getTimezoneGroupInfo(g);
      const count = modalTzCounts.get(g) || 0;
      const sysTag =
        g === sysTzInfo.tzGroup
          ? currentLanguage === "vi"
            ? " ★ Múi giờ máy đang dùng"
            : " ★ System Timezone"
          : "";
      return `<option value="${escapeHtml(g)}" ${effectiveModalTz === g ? "selected" : ""}>
        ${escapeHtml(`${info.groupLabel} (${count} proxy)${sysTag}`)}
      </option>`;
    }),
    `<option value="all" ${effectiveModalTz === "all" ? "selected" : ""}>
      ${escapeHtml(
        currentLanguage === "vi"
          ? `🌐 Tất cả Múi giờ (${snap.locations.length} proxy)`
          : `🌐 All Timezones (${snap.locations.length} proxies)`
      )}
    </option>`,
  ].join("");

  const modalHtml = isCreateBridgeModalOpen
    ? `
      <div class="modal-backdrop">
        <div class="modal-card">
          <h3>${escapeHtml(strings.hub.modalCreateTitle)}</h3>
          <form id="create-bridge-form">
            <div class="form-group">
              <label for="bridge-slot-name">${escapeHtml(strings.hub.slotNameLabel)}</label>
              <input type="text" id="bridge-slot-name" class="text-input" placeholder="Surfshark Bridge" />
            </div>
            <div class="form-group">
              <label for="bridge-slot-port">${escapeHtml(strings.hub.slotPortLabel)}</label>
              <input type="number" id="bridge-slot-port" class="text-input" placeholder="${snap.settings.basePort}" min="1024" max="65535" />
              <div class="subtext">${escapeHtml(strings.hub.slotPortHint)}</div>
            </div>
            <div class="form-group">
              <label for="bridge-slot-adapter">${escapeHtml(strings.hub.adapterHintLabel)}</label>
              <input type="text" id="bridge-slot-adapter" class="text-input" placeholder="${escapeHtml(strings.hub.adapterHintPlaceholder)}" />
            </div>
            <div class="form-group checkbox-group">
              <label class="checkbox-label">
                <input type="checkbox" id="bridge-slot-autostart" checked />
                <span>${escapeHtml(strings.hub.autoStartLabel)}</span>
              </label>
            </div>
            <div class="btn-group-right">
              <button type="button" class="btn btn-secondary" id="btn-cancel-bridge-modal">
                ${escapeHtml(strings.hub.cancelBtn)}
              </button>
              <button type="submit" class="btn btn-primary">
                ${escapeHtml(strings.hub.createBtn)}
              </button>
            </div>
          </form>
        </div>
      </div>
    `
    : isCreateMultiModalOpen
      ? `
      <div class="modal-backdrop">
        <div class="modal-card">
          <h3>${escapeHtml(strings.hub.modalCreateMultiTitle)}</h3>
          <form id="create-multi-form">
            <div class="form-group">
              <label for="multi-slot-tz">${escapeHtml(currentLanguage === "vi" ? "1. Chọn Múi giờ (Mặc định theo máy đang dùng)" : "1. Select Timezone (Defaults to System Timezone)")}</label>
              <select id="multi-slot-tz" class="select-input">
                ${modalTzOptionsHtml}
              </select>
            </div>
            <div class="form-group">
              <label for="multi-slot-location">${escapeHtml(currentLanguage === "vi" ? `2. Chọn Proxy trong múi giờ (${modalFilteredLocations.length} máy chủ khả dụng)` : `2. Select Proxy in Timezone (${modalFilteredLocations.length} available)`)}</label>
              <select id="multi-slot-location" class="select-input" required>
                ${multiServerOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="multi-slot-name">${escapeHtml(strings.hub.slotNameLabel)}</label>
              <input type="text" id="multi-slot-name" class="text-input" placeholder="Auto-filled from server" />
            </div>
            <div class="form-group">
              <label for="multi-slot-port">${escapeHtml(strings.hub.slotPortLabel)}</label>
              <input type="number" id="multi-slot-port" class="text-input" placeholder="${snap.settings.basePort + 1}" min="1024" max="65535" />
              <div class="subtext">${escapeHtml(strings.hub.slotPortHint)}</div>
            </div>
            <div class="form-group checkbox-group">
              <label class="checkbox-label">
                <input type="checkbox" id="multi-slot-autostart" checked />
                <span>${escapeHtml(strings.hub.autoStartLabel)}</span>
              </label>
            </div>
            <div class="btn-group-right">
              <button type="button" class="btn btn-secondary" id="btn-cancel-multi-modal">
                ${escapeHtml(strings.hub.cancelBtn)}
              </button>
              <button type="submit" class="btn btn-primary">
                ${escapeHtml(strings.hub.createBtn)}
              </button>
            </div>
          </form>
        </div>
      </div>
    `
      : "";

  return `
    <!-- Top Status Banner Card -->
    <div class="surf-card hub-status-banner">
      <div class="banner-indicators">
        <div class="indicator-item">
          <span class="indicator-label">${escapeHtml(strings.header.surfsharkAdapter)}</span>
          <div class="indicator-value">
            <span class="status-dot ${isSurfConnected ? "dot-online" : "dot-offline"}"></span>
            <span class="bold">${isSurfConnected ? `${escapeHtml(strings.header.connected)} (${escapeHtml(surf?.ipv4 || "")})` : escapeHtml(strings.header.disconnected)}</span>
          </div>
        </div>
        <div class="indicator-divider"></div>
        <div class="indicator-item">
          <span class="indicator-label">${escapeHtml(strings.header.ispIp)}</span>
          <div class="indicator-value">
            <span class="mono bold">${escapeHtml(snap.hostIspIp || "Detecting...")}</span>
            <span class="badge badge-safe">Protected</span>
          </div>
        </div>
        <div class="indicator-divider"></div>
        <div class="indicator-item">
          <span class="indicator-label">${escapeHtml(strings.header.wireproxyCore)}</span>
          <div class="indicator-value">
            <span class="status-dot ${isWireproxyReady ? "dot-online" : "dot-warning"}"></span>
            <span class="bold">${isWireproxyReady ? escapeHtml(strings.header.ready) : escapeHtml(strings.header.missing)}</span>
          </div>
        </div>
        <div class="indicator-divider"></div>
        <div class="indicator-item">
          <span class="indicator-label">${escapeHtml(strings.tabs.statusTab)}</span>
          <div class="indicator-value">
            ${(() => {
              const s = snap.settings;
              const activeCount = [
                s.killSwitchEnabled,
                s.dnsLeakProtection,
                s.ipv6LeakBlock,
                s.ispIpGuard,
                s.autoVerifyIp,
                !s.allowLan,
              ].filter(Boolean).length;
              const allOn = activeCount === 6;
              return `
                <span class="status-dot ${allOn ? "dot-online" : "dot-warning"}"></span>
                <button type="button" class="btn btn-sm ${allOn ? "btn-secondary" : "btn-danger"} btn-open-status-tab" style="padding: 3px 10px;">
                  🛡 ${activeCount}/6 ON
                </button>
              `;
            })()}
          </div>
        </div>
      </div>

      <div class="banner-actions">
        <button type="button" class="btn btn-primary" id="btn-open-create-bridge">
          ${escapeHtml(strings.hub.addAdapterSlot)}
        </button>
        <button type="button" class="btn btn-primary" id="btn-open-create-multi">
          ${escapeHtml(strings.hub.addMultiVpnSlot)}
        </button>
        <button type="button" class="btn btn-secondary" id="btn-start-all-slots">
          ${escapeHtml(strings.hub.startAll)}
        </button>
        <button type="button" class="btn btn-secondary" id="btn-stop-all-slots">
          ${escapeHtml(strings.hub.stopAll)}
        </button>
        <button type="button" class="btn btn-secondary" id="btn-check-all-ips">
          ${escapeHtml(strings.hub.checkAllIps)}
        </button>
        <button type="button" class="btn btn-secondary" id="btn-copy-all-socks5">
          ${escapeHtml(strings.hub.copyAllSocks5)}
        </button>
        <button type="button" class="btn btn-secondary" id="btn-refresh-system">
          ⟳ ${escapeHtml(strings.hub.refreshSystem)}
        </button>
      </div>
    </div>

    <!-- Active Proxy Slots Section -->
    <div class="slots-section">
      <h2 class="section-title">${escapeHtml(strings.hub.slotsTitle)}</h2>
      <div class="slots-stack">
        ${slotCards}
      </div>
    </div>

    <!-- Network Adapters Collapsible Diagnostics Section -->
    <details class="adapters-details">
      <summary class="adapters-summary">
        <div class="summary-content">
          <span class="summary-title">${escapeHtml(strings.hub.adapterDiagnostics)}</span>
          <span class="subtext">${escapeHtml(strings.hub.adapterDiagnosticsDesc)}</span>
        </div>
        <span class="summary-chevron">▼</span>
      </summary>
      <div class="adapters-content">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>${escapeHtml(strings.hub.colAdapterName)}</th>
                <th>${escapeHtml(strings.hub.colAdapterDesc)}</th>
                <th>${escapeHtml(strings.hub.colAdapterIp)}</th>
                <th>${escapeHtml(strings.hub.colAdapterStatus)}</th>
                <th>${escapeHtml(strings.hub.colAdapterKind)}</th>
              </tr>
            </thead>
            <tbody>
              ${adapterRows}
            </tbody>
          </table>
        </div>
      </div>
    </details>

    ${modalHtml}
  `;
}

// 2b. View 1b: Status & Security Protections Tab
function renderStatusTab(snap: HubSnapshot): string {
  const strings = getStrings();
  const sp = strings.statusPage;
  const s = snap.settings;
  const surf = snap.surfsharkAdapter;
  const isSurfConnected = surf && surf.statusUp && !surf.ipv4.startsWith("169.254.") && surf.ipv4 !== "";
  const runningSlots = snap.slots.filter((slot) => slot.status === "running").length;

  const features = [
    {
      id: "killSwitchEnabled",
      enabled: s.killSwitchEnabled,
      title: sp.killSwitchTitle,
      desc: sp.killSwitchDesc,
      badge: "IP_UNICAST_IF / IP_BOUND_IF",
    },
    {
      id: "dnsLeakProtection",
      enabled: s.dnsLeakProtection,
      title: sp.dnsLeakTitle,
      desc: sp.dnsLeakDesc,
      badge: "RFC 1035 Tunnel DNS",
    },
    {
      id: "ipv6LeakBlock",
      enabled: s.ipv6LeakBlock,
      title: sp.ipv6BlockTitle,
      desc: sp.ipv6BlockDesc,
      badge: "IPv4-Only Lock",
    },
    {
      id: "ispIpGuard",
      enabled: s.ispIpGuard,
      title: sp.ispGuardTitle,
      desc: sp.ispGuardDesc,
      badge: snap.hostIspIp ? `ISP: ${snap.hostIspIp}` : "ISP Baseline",
    },
    {
      id: "autoVerifyIp",
      enabled: s.autoVerifyIp,
      title: sp.autoVerifyTitle,
      desc: sp.autoVerifyDesc,
      badge: "Auto Probe",
    },
    {
      id: "localhostOnly",
      enabled: !s.allowLan,
      title: sp.localhostOnlyTitle,
      desc: sp.localhostOnlyDesc,
      badge: !s.allowLan ? "127.0.0.1" : "0.0.0.0 (LAN)",
    },
  ];

  const allActive = features.every((f) => f.enabled);

  const featureCardsHtml = features
    .map(
      (f) => `
      <div class="surf-card security-card ${f.enabled ? "is-enabled" : "is-disabled"}">
        <div class="security-card-info">
          <div class="security-card-header">
            <span class="security-card-title">${escapeHtml(f.title)}</span>
            <span class="badge ${f.enabled ? "badge-running" : "badge-kill"}">
              ${escapeHtml(f.enabled ? sp.stateOn : sp.stateOff)}
            </span>
            <span class="badge badge-os mono">${escapeHtml(f.badge)}</span>
          </div>
          <div class="subtext">${escapeHtml(f.desc)}</div>
        </div>
        <div class="security-toggle-col">
          <label class="toggle-switch" title="${escapeHtml(f.title)}">
            <input
              type="checkbox"
              class="security-toggle-input"
              data-feature="${escapeHtml(f.id)}"
              ${f.enabled ? "checked" : ""}
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `
    )
    .join("");

  return `
    <!-- Top Overall Security Shield Banner -->
    <div class="surf-card status-shield-banner">
      <div class="shield-banner-left">
        <div class="shield-badge-icon ${allActive ? "shield-badge-safe" : "shield-badge-warn"}">
          ${allActive ? "🛡" : "⚠"}
        </div>
        <div class="shield-banner-meta">
          <div class="shield-banner-title">
            ${escapeHtml(allActive ? sp.allProtectionsActive : sp.customProtectionMode)}
          </div>
          <div class="subtext">
            ${escapeHtml(allActive ? sp.allProtectionsDesc : sp.customProtectionDesc)}
          </div>
        </div>
      </div>
      <div class="btn-group-sm">
        ${
          !allActive
            ? `<button type="button" class="btn btn-primary" id="btn-reset-all-security">
                 ${escapeHtml(sp.resetDefaultsBtn)}
               </button>`
            : ""
        }
        <button type="button" class="btn btn-secondary" id="btn-status-refresh">
          ⟳ ${escapeHtml(sp.refreshStatusBtn)}
        </button>
      </div>
    </div>

    <!-- Live Subsystem Health Grid -->
    <div class="slots-section">
      <div class="section-title-sm">${escapeHtml(sp.subsystemSectionTitle)}</div>
      <div class="subsystem-grid">
        <div class="surf-card subsystem-card">
          <div class="subsystem-card-top">
            <span class="subsystem-card-label">${escapeHtml(sp.vpnAdapterCardTitle)}</span>
            <span class="status-dot ${isSurfConnected ? "dot-online" : "dot-offline"}"></span>
          </div>
          <div class="subsystem-card-value mono">
            ${isSurfConnected ? escapeHtml(surf?.ipv4 || "") : escapeHtml(strings.header.disconnected)}
          </div>
          <div class="subtext-sm">
            ${escapeHtml(surf?.description || "Surfshark Wintun / utun / OpenVPN")}
          </div>
        </div>

        <div class="surf-card subsystem-card">
          <div class="subsystem-card-top">
            <span class="subsystem-card-label">${escapeHtml(sp.ispGuardCardTitle)}</span>
            <span class="status-dot ${snap.hostIspIp ? "dot-online" : "dot-warning"}"></span>
          </div>
          <div class="subsystem-card-value mono">
            ${escapeHtml(snap.hostIspIp || "Detecting...")}
          </div>
          <div class="subtext-sm">
            ${s.ispIpGuard ? escapeHtml(sp.stateOn) : escapeHtml(sp.stateOff)}
          </div>
        </div>

        <div class="surf-card subsystem-card">
          <div class="subsystem-card-top">
            <span class="subsystem-card-label">${escapeHtml(sp.wireguardEngineCardTitle)}</span>
            <span class="status-dot ${s.wireproxyReady && s.hasWgPrivateKey ? "dot-online" : "dot-warning"}"></span>
          </div>
          <div class="subsystem-card-value">
            ${s.wireproxyReady ? escapeHtml(strings.header.ready) : escapeHtml(strings.header.missing)}
          </div>
          <div class="subtext-sm">
            ${escapeHtml(s.hasWgPrivateKey ? sp.keyConfigured : sp.keyNotSet)}
          </div>
        </div>

        <div class="surf-card subsystem-card">
          <div class="subsystem-card-top">
            <span class="subsystem-card-label">${escapeHtml(sp.proxyHubCardTitle)}</span>
            <span class="status-dot ${runningSlots > 0 ? "dot-online" : "dot-warning"}"></span>
          </div>
          <div class="subsystem-card-value">
            ${escapeHtml(
              sp.activeSlotsCount
                .replace("{running}", String(runningSlots))
                .replace("{total}", String(snap.slots.length))
            )}
          </div>
          <div class="subtext-sm mono">
            ${s.allowLan ? "0.0.0.0" : "127.0.0.1"}:${s.basePort}+
          </div>
        </div>
      </div>
    </div>

    <!-- Interactive Security Toggles Grid -->
    <div class="slots-section">
      <h2 class="section-title" style="margin-bottom: 4px;">${escapeHtml(sp.protectionsSectionTitle)}</h2>
      <div class="subtext" style="margin-bottom: 10px;">${escapeHtml(sp.subtitle)}</div>
      <div class="security-grid">
        ${featureCardsHtml}
      </div>
    </div>
  `;
}

// 3. View 2: Locations Tab (Multi-Provider Catalog)
function renderCatalogTab(snap: HubSnapshot): string {
  const strings = getStrings();
  const sysTzInfo = detectSystemTimezoneInfo();

  // Available timezone groups for the active provider filter
  const tzCounts = new Map<string, number>();
  let totalForProvider = 0;
  for (const loc of snap.locations) {
    if (catalogProviderFilter !== "all" && loc.provider !== catalogProviderFilter) continue;
    const g = loc.tzGroup || "custom";
    tzCounts.set(g, (tzCounts.get(g) || 0) + 1);
    totalForProvider += 1;
  }

  // Put host machine's timezone group first in the dropdown list, followed by other available groups
  const availableTzGroups = ORDERED_TZ_GROUPS.filter(
    (g) => (tzCounts.get(g) || 0) > 0 || g === sysTzInfo.tzGroup
  );
  const orderedTzGroups = [
    ...availableTzGroups.filter((g) => g === sysTzInfo.tzGroup),
    ...availableTzGroups.filter((g) => g !== sysTzInfo.tzGroup),
  ];

  const effectiveTzFilter =
    catalogTzFilter === "all" || tzCounts.has(catalogTzFilter) || catalogTzFilter === sysTzInfo.tzGroup
      ? catalogTzFilter
      : tzCounts.has(sysTzInfo.tzGroup)
        ? sysTzInfo.tzGroup
        : orderedTzGroups[0] || "all";

  const query = catalogSearchQuery.trim().toLowerCase();
  const tzFilteredPool = snap.locations.filter((loc: SurfsharkLocation) => {
    if (catalogProviderFilter !== "all" && loc.provider !== catalogProviderFilter) {
      return false;
    }
    if (effectiveTzFilter !== "all" && (loc.tzGroup || "custom") !== effectiveTzFilter) {
      return false;
    }
    return true;
  });

  // Build Geo-Cluster options within the selected timezone (Impossible Travel Guard)
  const clusterMap = new Map<string, { meta: GeoClusterMeta; count: number }>();
  for (const loc of tzFilteredPool) {
    const geo = getGeoClusterAndCoords(
      loc.countryCode,
      loc.location,
      loc.connectionName,
      loc.tzGroup
    );
    const existing = clusterMap.get(geo.clusterId);
    if (existing) {
      existing.count += 1;
    } else {
      clusterMap.set(geo.clusterId, { meta: geo, count: 1 });
    }
  }

  const effectiveClusterFilter =
    catalogGeoClusterFilter !== "all" && clusterMap.has(catalogGeoClusterFilter)
      ? catalogGeoClusterFilter
      : "all";

  const filtered = tzFilteredPool.filter((loc: SurfsharkLocation) => {
    if (catalogFilterType !== "all" && loc.locationType !== catalogFilterType) {
      return false;
    }
    if (effectiveClusterFilter !== "all") {
      const geo = getGeoClusterAndCoords(
        loc.countryCode,
        loc.location,
        loc.connectionName,
        loc.tzGroup
      );
      if (geo.clusterId !== effectiveClusterFilter) {
        return false;
      }
    }
    if (!query) return true;
    return (
      loc.country.toLowerCase().includes(query) ||
      loc.location.toLowerCase().includes(query) ||
      loc.connectionName.toLowerCase().includes(query) ||
      loc.countryCode.toLowerCase().includes(query) ||
      (loc.ianaTimezone || "").toLowerCase().includes(query) ||
      (loc.utcOffset || "").toLowerCase().includes(query)
    );
  });

  const geoClusterSelectHtml =
    clusterMap.size > 1
      ? `<select id="catalog-cluster-select" class="select-input catalog-tz-select" title="${
          currentLanguage === "vi"
            ? "Lọc theo cụm địa lý gần nhau để tránh nền tảng phát hiện Impossible Travel khi đổi proxy"
            : "Filter by realistic geographic proximity cluster to prevent Impossible Travel detection"
        }">
          <option value="all" ${effectiveClusterFilter === "all" ? "selected" : ""}>
            ${escapeHtml(
              currentLanguage === "vi"
                ? `🛡 Tất cả cụm địa lý trong múi giờ (${clusterMap.size} cụm — Đã tách chống Impossible Travel)`
                : `🛡 All Geo-Clusters in Timezone (${clusterMap.size} clusters — Separated against Impossible Travel)`
            )}
          </option>
          ${Array.from(clusterMap.entries())
            .map(
              ([cid, entry]) =>
                `<option value="${escapeHtml(cid)}" ${effectiveClusterFilter === cid ? "selected" : ""}>
                  ${escapeHtml(`${entry.meta.clusterLabel} (${entry.count} proxy)`)}
                </option>`
            )
            .join("")}
        </select>`
      : "";

  const tzSelectOptionsHtml = [
    ...orderedTzGroups.map((g) => {
      const info = getTimezoneGroupInfo(g);
      const count = tzCounts.get(g) || 0;
      const isSystemTz = g === sysTzInfo.tzGroup;
      const sysSuffix = isSystemTz
        ? currentLanguage === "vi"
          ? " ★ Múi giờ máy đang dùng (Mặc định)"
          : " ★ System Timezone (Default)"
        : "";
      return `<option value="${escapeHtml(g)}" ${effectiveTzFilter === g ? "selected" : ""}>
        ${escapeHtml(`${info.groupLabel} — ${count} proxy${sysSuffix}`)}
      </option>`;
    }),
    `<option value="all" ${effectiveTzFilter === "all" ? "selected" : ""}>
      ${escapeHtml(
        currentLanguage === "vi"
          ? `🌐 Hiển thị tất cả múi giờ (${totalForProvider} proxy)`
          : `🌐 Show All Timezones (${totalForProvider} proxies)`
      )}
    </option>`,
  ].join("");

  const sysTzGroupMeta = getTimezoneGroupInfo(sysTzInfo.tzGroup);
  const isUsingSystemTz = effectiveTzFilter === sysTzInfo.tzGroup;

  // Recommended top 2 lowest-load servers within the same safe Geo-Cluster (Impossible Travel Guard)
  let primaryRecLoc: SurfsharkLocation | null = null;
  let backupRecLoc: SurfsharkLocation | null = null;

  if (filtered.length > 0) {
    const sortedByLoad = [...filtered].sort((a, b) => a.load - b.load);
    primaryRecLoc =
      effectiveTzFilter === "asia_utc7"
        ? sortedByLoad.find((l) => l.countryCode.toUpperCase() === "VN" && l.load <= 35) ||
          sortedByLoad[0]
        : sortedByLoad[0];
    if (primaryRecLoc) {
      const primaryGeo = getGeoClusterAndCoords(
        primaryRecLoc.countryCode,
        primaryRecLoc.location,
        primaryRecLoc.connectionName,
        primaryRecLoc.tzGroup
      );
      backupRecLoc =
        sortedByLoad.find((l) => {
          if (l.id === primaryRecLoc?.id) return false;
          const candGeo = getGeoClusterAndCoords(
            l.countryCode,
            l.location,
            l.connectionName,
            l.tzGroup
          );
          const dist = calculateGeoDistanceKm(
            primaryGeo.lat,
            primaryGeo.lon,
            candGeo.lat,
            candGeo.lon
          );
          return candGeo.clusterId === primaryGeo.clusterId && dist <= 850;
        }) || null;
    }
  }

  const providerTabsHtml = [
    { id: "all", label: `All (${snap.locations.length})` },
    ...snap.providers.map((p) => ({
      id: p.provider,
      label: `${p.displayName} (${p.serverCount})`,
    })),
  ]
    .map(
      (pt) => `
      <button type="button" class="pill-tab catalog-provider-tab ${catalogProviderFilter === pt.id ? "active" : ""}" data-provider="${escapeHtml(pt.id)}">
        ${escapeHtml(pt.label)}
      </button>
    `
    )
    .join("");

  const renderLocationCard = (loc: SurfsharkLocation): string => {
    const loadClass = loc.load > 70 ? "load-high" : loc.load > 40 ? "load-med" : "load-low";
    const provShort = loc.provider.toUpperCase();
    const isCustomLoc = loc.region === "Custom";
    const tzMeta = getLocationTimezoneMeta(loc);
    const geoMeta = getGeoClusterAndCoords(
      loc.countryCode,
      loc.location,
      loc.connectionName,
      loc.tzGroup
    );
    const typeBadge =
      loc.locationType === "static"
        ? `<span class="badge badge-os mono" style="font-size:10px;padding:1px 6px;">Static IP</span>`
        : "";
    return `
      <div class="surf-card location-card">
        <div class="loc-card-main">
          <div class="loc-flag-col">
            ${renderFlagBadge(loc.countryCode)}
          </div>
          <div class="loc-info-col">
            <div class="loc-country">${escapeHtml(loc.country)} ${typeBadge}</div>
            <div class="loc-city"><strong>${escapeHtml(loc.location)}</strong> &bull; <span class="mono">${escapeHtml(tzMeta.tzBadge)}</span></div>
            <div style="margin-top: 4px;">
              <span class="badge badge-safe" style="font-size:10.5px; padding:2px 7px;" title="${escapeHtml(geoMeta.safeNeighborsNote)}">${escapeHtml(geoMeta.shortBadge)}</span>
            </div>
          </div>
          <div class="loc-load-col">
            <span class="load-pill ${loadClass}">${loc.load}%</span>
          </div>
        </div>
        <div class="loc-card-footer">
          <span class="mono subtext-sm">[${escapeHtml(provShort)}] ${escapeHtml(loc.connectionName)}</span>
          <div style="display:flex; gap:6px; align-items:center;">
            ${
              isCustomLoc
                ? `<button type="button" class="btn btn-sm btn-danger btn-delete-custom-server" data-provider="${escapeHtml(loc.provider)}" data-loc-id="${escapeHtml(loc.id)}" title="Delete">✕</button>`
                : ""
            }
            <button type="button" class="btn btn-sm btn-primary btn-create-location-slot" data-loc-id="${escapeHtml(loc.id)}" data-loc-label="${escapeHtml(`${loc.countryCode} • ${loc.country} - ${loc.location}`)}">
              ${escapeHtml(strings.catalog.createAndStart)}
            </button>
          </div>
        </div>
      </div>
    `;
  };

  let groupedSectionsHtml = "";
  if (filtered.length === 0) {
    groupedSectionsHtml = `<div class="empty-card">${escapeHtml(strings.catalog.noServersMatch)}</div>`;
  } else {
    const byCluster = new Map<string, { meta: GeoClusterMeta; locs: SurfsharkLocation[] }>();
    for (const loc of filtered) {
      const geo = getGeoClusterAndCoords(
        loc.countryCode,
        loc.location,
        loc.connectionName,
        loc.tzGroup
      );
      const entry = byCluster.get(geo.clusterId);
      if (entry) {
        entry.locs.push(loc);
      } else {
        byCluster.set(geo.clusterId, { meta: geo, locs: [loc] });
      }
    }
    for (const [, group] of byCluster.entries()) {
      const countLabel =
        currentLanguage === "vi"
          ? `${group.locs.length} proxy trong cụm địa lý hợp lý (Chống Impossible Travel)`
          : `${group.locs.length} proxies in safe geo-cluster (Impossible Travel Guard)`;
      groupedSectionsHtml += `
        <div class="locations-section" style="margin-bottom: 18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:6px;">
            <div class="section-title-sm" style="margin-bottom:0;">${escapeHtml(group.meta.clusterLabel)}</div>
            <span class="badge badge-safe mono">${escapeHtml(countLabel)}</span>
          </div>
          <div class="subtext-sm" style="margin-bottom: 10px;">💡 ${escapeHtml(group.meta.safeNeighborsNote)}</div>
          <div class="locations-grid">
            ${group.locs.map(renderLocationCard).join("")}
          </div>
        </div>
      `;
    }
  }

  const primaryRecTitle =
    currentLanguage === "vi"
      ? "Máy chủ tối ưu nhất trong cụm địa lý (#1)"
      : "Best Server in Geo-Cluster (#1)";
  const backupRecTitle =
    currentLanguage === "vi"
      ? "Dự phòng an toàn cùng cụm (< 850 km • Chống Impossible Travel)"
      : "Safe Same-Cluster Failover (< 850 km • Impossible Travel Guard)";

  return `
    <!-- Multi-Provider Filter Bar -->
    <div class="provider-filter-bar">
      <div class="pill-tabs" role="tablist">
        ${providerTabsHtml}
      </div>
    </div>

    <!-- Timezone & Geo-Proximity Dropdown Selector Card (Defaults to Host System Timezone) -->
    <div class="surf-card tz-dropdown-bar">
      <div class="tz-dropdown-left">
        <label for="catalog-tz-select" class="tz-dropdown-label">
          🕒 ${escapeHtml(currentLanguage === "vi" ? "Chọn Múi Giờ & Cụm Địa Lý Hợp Lý:" : "Select Timezone & Safe Geo-Cluster:")}
        </label>
        <div class="subtext-sm">
          ${escapeHtml(
            currentLanguage === "vi"
              ? `Mặc định theo múi giờ máy (${sysTzGroupMeta.tzBadge}) • Tách cụm khoảng cách thật để chống nền tảng detect Impossible Travel`
              : `Defaults to system timezone (${sysTzGroupMeta.tzBadge}) • Separated by real-world distance against Impossible Travel detection`
          )}
        </div>
      </div>
      <div class="tz-dropdown-controls">
        <select id="catalog-tz-select" class="select-input catalog-tz-select">
          ${tzSelectOptionsHtml}
        </select>
        ${geoClusterSelectHtml}
        ${
          !isUsingSystemTz
            ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-reset-system-tz" title="${escapeHtml(sysTzGroupMeta.groupLabel)}">
                 ↺ ${escapeHtml(currentLanguage === "vi" ? `Về múi giờ máy (${sysTzInfo.utcOffsetLabel})` : `System Timezone (${sysTzInfo.utcOffsetLabel})`)}
               </button>`
            : `<span class="badge badge-running mono">🖥 ${escapeHtml(currentLanguage === "vi" ? `Múi giờ máy (${sysTzInfo.utcOffsetLabel})` : `System TZ (${sysTzInfo.utcOffsetLabel})`)}</span>`
        }
      </div>
    </div>

    <!-- Top Search & Filter Bar -->
    <div class="catalog-top-row">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#5E6675" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="search"
          id="catalog-search-input"
          class="search-input"
          placeholder="${escapeHtml(strings.catalog.searchPlaceholder)}"
          value="${escapeHtml(catalogSearchQuery)}"
        />
      </div>

      <div class="pill-tabs" role="tablist">
        <button type="button" class="pill-tab catalog-pill-tab ${catalogFilterType === "all" ? "active" : ""}" data-filter="all">
          ${escapeHtml(strings.catalog.filterAll)}
        </button>
        <button type="button" class="pill-tab catalog-pill-tab ${catalogFilterType === "generic" ? "active" : ""}" data-filter="generic">
          ${escapeHtml(strings.catalog.genericType)}
        </button>
        <button type="button" class="pill-tab catalog-pill-tab ${catalogFilterType === "static" ? "active" : ""}" data-filter="static">
          ${escapeHtml(strings.catalog.filterStatic)}
        </button>
      </div>

      <div class="catalog-count-badge">
        ${escapeHtml(
          currentLanguage === "vi"
            ? `Đang có ${filtered.length} proxy khả dụng trong múi giờ này`
            : `Showing ${filtered.length} available proxies in selected timezone`
        )}
      </div>
    </div>

    <!-- Recommended for you in Selected Timezone -->
    ${
      primaryRecLoc
        ? `
    <div class="recommended-section">
      <div class="section-title-sm">${escapeHtml(strings.catalog.recommendedTitle)}</div>
      <div class="recommended-grid">
        <div class="surf-card rec-card">
          <div class="rec-header">
            <div class="dark-icon-badge">📍</div>
            <div class="rec-meta">
              <span class="rec-title">${escapeHtml(primaryRecTitle)}</span>
              <span class="rec-location">${renderFlagBadge(primaryRecLoc.countryCode)} <strong>${escapeHtml(primaryRecLoc.country)}</strong> &bull; ${escapeHtml(primaryRecLoc.location)}</span>
            </div>
            <div class="rec-load-badge">${primaryRecLoc.load}% load</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm btn-create-location-slot" data-loc-id="${escapeHtml(primaryRecLoc.id)}" data-loc-label="${escapeHtml(`${primaryRecLoc.countryCode} • ${primaryRecLoc.country} - ${primaryRecLoc.location}`)}">
            ${escapeHtml(strings.catalog.createAndStart)}
          </button>
        </div>
        ${
          backupRecLoc
            ? `
          <div class="surf-card rec-card">
            <div class="rec-header">
              <div class="dark-icon-badge">⚡</div>
              <div class="rec-meta">
                <span class="rec-title">${escapeHtml(backupRecTitle)}</span>
                <span class="rec-location">${renderFlagBadge(backupRecLoc.countryCode)} <strong>${escapeHtml(backupRecLoc.country)}</strong> &bull; ${escapeHtml(backupRecLoc.location)}</span>
              </div>
              <div class="rec-load-badge">${backupRecLoc.load}% load</div>
            </div>
            <button type="button" class="btn btn-primary btn-sm btn-create-location-slot" data-loc-id="${escapeHtml(backupRecLoc.id)}" data-loc-label="${escapeHtml(`${backupRecLoc.countryCode} • ${backupRecLoc.country} - ${backupRecLoc.location}`)}">
              ${escapeHtml(strings.catalog.createAndStart)}
            </button>
          </div>
        `
            : ""
        }
      </div>
    </div>
    `
        : ""
    }

    <!-- Grouped By Exact Timezone Sections -->
    ${groupedSectionsHtml}
  `;
}

// 3b. View 2b: Multi-Provider Configuration Tab
function renderProvidersTab(snap: HubSnapshot): string {
  const strings = getStrings();
  const pp = strings.providersPage;

  const metaByProvider: Record<
    VpnProvider,
    { badgeText: string; badgeClass: string; desc: string; supportsApiSync: boolean; supportsToken: boolean }
  > = {
    surfshark: {
      badgeText: "SS",
      badgeClass: "prov-surfshark",
      desc: pp.surfsharkDesc,
      supportsApiSync: true,
      supportsToken: false,
    },
    nordvpn: {
      badgeText: "NV",
      badgeClass: "prov-nordvpn",
      desc: pp.nordvpnDesc,
      supportsApiSync: true,
      supportsToken: true,
    },
    mullvad: {
      badgeText: "MV",
      badgeClass: "prov-mullvad",
      desc: pp.mullvadDesc,
      supportsApiSync: true,
      supportsToken: false,
    },
    protonvpn: {
      badgeText: "PV",
      badgeClass: "prov-protonvpn",
      desc: pp.protonvpnDesc,
      supportsApiSync: false,
      supportsToken: false,
    },
    custom: {
      badgeText: "WG",
      badgeClass: "prov-custom",
      desc: pp.customDesc,
      supportsApiSync: false,
      supportsToken: false,
    },
  };

  const providerCardsHtml = snap.providers
    .map((p: ProviderView) => {
      const meta = metaByProvider[p.provider];
      const serverCountText = pp.serversAvailable.replace("{count}", String(p.serverCount));
      return `
        <div class="surf-card provider-card ${p.isReady ? "is-ready" : ""}" data-provider="${escapeHtml(p.provider)}">
          <div class="provider-card-header">
            <div class="provider-brand-row">
              <div class="provider-logo-badge ${meta.badgeClass}">${escapeHtml(meta.badgeText)}</div>
              <div>
                <div class="slot-name">${escapeHtml(p.displayName)}</div>
                <div class="subtext-sm">
                  <span class="badge ${p.hasPrivateKey ? "badge-running" : "badge-stopped"}">
                    ${escapeHtml(p.hasPrivateKey ? pp.statusReady : pp.statusMissingKey)}
                  </span>
                  <span class="badge badge-os mono">${escapeHtml(serverCountText)}</span>
                </div>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-secondary btn-browse-provider" data-provider="${escapeHtml(p.provider)}">
              ${escapeHtml(pp.browseServersBtn)}
            </button>
          </div>

          <div class="subtext">${escapeHtml(meta.desc)}</div>

          ${
            meta.supportsToken
              ? `
            <div class="form-group">
              <label>${escapeHtml(pp.apiTokenLabel)}</label>
              <input
                type="password"
                class="text-input mono prov-token-input"
                data-provider="${escapeHtml(p.provider)}"
                placeholder="${escapeHtml(p.hasApiToken ? p.apiTokenMasked : pp.apiTokenPlaceholder)}"
              />
            </div>
          `
              : ""
          }

          <div class="form-group">
            <label>${escapeHtml(pp.privateKeyLabel)}</label>
            <input
              type="password"
              class="text-input mono prov-key-input"
              data-provider="${escapeHtml(p.provider)}"
              placeholder="${escapeHtml(p.hasPrivateKey ? p.privateKeyMasked : pp.privateKeyPlaceholder)}"
            />
          </div>

          <div class="provider-form-grid">
            <div class="form-group">
              <label>${escapeHtml(pp.addressLabel)}</label>
              <input
                type="text"
                class="text-input mono prov-addr-input"
                data-provider="${escapeHtml(p.provider)}"
                value="${escapeHtml(p.address)}"
              />
            </div>
            <div class="form-group">
              <label>${escapeHtml(pp.dnsLabel)}</label>
              <input
                type="text"
                class="text-input mono prov-dns-input"
                data-provider="${escapeHtml(p.provider)}"
                value="${escapeHtml(p.dns)}"
              />
            </div>
          </div>

          <div class="provider-actions-row">
            <div class="btn-group-sm">
              <button type="button" class="btn btn-sm btn-primary btn-save-provider" data-provider="${escapeHtml(p.provider)}">
                ${escapeHtml(pp.saveProviderBtn)}
              </button>
              ${
                meta.supportsApiSync
                  ? `<button type="button" class="btn btn-sm btn-secondary btn-sync-provider" data-provider="${escapeHtml(p.provider)}">
                       ${escapeHtml(pp.syncCatalogBtn)}
                     </button>`
                  : ""
              }
            </div>
            <div>
              <button type="button" class="btn btn-sm btn-secondary btn-import-provider-conf" data-provider="${escapeHtml(p.provider)}">
                ${escapeHtml(pp.importConfFilesBtn)}
              </button>
              <input
                type="file"
                class="prov-conf-file-input"
                data-provider="${escapeHtml(p.provider)}"
                accept=".conf,.txt"
                multiple
                style="display:none"
              />
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="settings-view">
      <div class="settings-header-banner">
        <h2 class="section-title">${escapeHtml(pp.title)}</h2>
        <div class="subtext">${escapeHtml(pp.subtitle)}</div>
      </div>

      <div class="providers-grid">
        ${providerCardsHtml}
      </div>
    </div>
  `;
}

// 4. View 3: GoLogin Sync Tab
function renderGoLoginTab(snap: HubSnapshot): string {
  const strings = getStrings();

  const profileCards =
    snap.gologinProfiles.length === 0
      ? `<div class="empty-card" style="grid-column: 1 / -1;">${escapeHtml(strings.gologin.noProfiles)}</div>`
      : snap.gologinProfiles
          .map((prof: GoLoginProfileSummary) => {
            const hasProxy = prof.proxyHost && prof.proxyPort > 0;
            const currentProxyDisplay = hasProxy
              ? `<span class="mono bold">${escapeHtml(prof.proxyMode)}://${escapeHtml(prof.proxyHost)}:${prof.proxyPort}</span>`
              : `<span class="subtext">${escapeHtml(strings.gologin.directNoProxy)}</span>`;

            const currentSlotVal = gologinSlotSelection[prof.id] || "";
            const currentModeVal = gologinModeSelection[prof.id] || "socks5";

            const rowSlotOptions = snap.slots
              .map(
                (slot) =>
                  `<option value="${escapeHtml(slot.id)}" ${slot.id === currentSlotVal ? "selected" : ""}>
                    ${escapeHtml(slot.name)} (127.0.0.1:${slot.port})
                  </option>`
              )
              .join("");

            return `
              <div class="surf-card gologin-profile-card" data-profile-id="${escapeHtml(prof.id)}">
                <div class="profile-card-header">
                  <div class="profile-main-info">
                    <div class="profile-name">${escapeHtml(prof.name)}</div>
                    <div class="subtext mono">${escapeHtml(prof.id)}</div>
                  </div>
                  <span class="badge badge-os">${escapeHtml(prof.os)}</span>
                </div>
                <div class="profile-proxy-status">
                  <span class="subtext-label">${escapeHtml(strings.gologin.colCurrentProxy)}:</span>
                  ${currentProxyDisplay}
                </div>
                <div class="profile-card-actions">
                  <select class="select-input select-gologin-slot" data-profile-id="${escapeHtml(prof.id)}">
                    <option value="">${escapeHtml(strings.gologin.selectSlotPrompt)}</option>
                    ${rowSlotOptions}
                  </select>
                  <select class="select-input select-gologin-mode" data-profile-id="${escapeHtml(prof.id)}">
                    <option value="socks5" ${currentModeVal === "socks5" ? "selected" : ""}>SOCKS5</option>
                    <option value="http" ${currentModeVal === "http" ? "selected" : ""}>HTTP</option>
                  </select>
                  <button type="button" class="btn btn-primary btn-assign-gologin" data-profile-id="${escapeHtml(prof.id)}">
                    ${escapeHtml(strings.gologin.assignBtn)}
                  </button>
                </div>
              </div>
            `;
          })
          .join("");

  return `
    <div class="surf-card gologin-top-card">
      <div class="gologin-top-left">
        <h2 class="section-title" style="margin-bottom: 4px;">${escapeHtml(strings.gologin.title)}</h2>
        <span class="subtext">${escapeHtml(strings.gologin.fetchHint)}</span>
      </div>
      <button type="button" class="btn btn-primary" id="btn-fetch-gologin-profiles">
        ${escapeHtml(strings.gologin.fetchProfiles)}
      </button>
    </div>

    <div class="gologin-cards-grid">
      ${profileCards}
    </div>
  `;
}

// 5. View 4: Settings Tab
function renderSettingsTab(snap: HubSnapshot): string {
  const strings = getStrings();
  const s = snap.settings;

  return `
    <div class="settings-view">
      <div class="settings-header-banner">
        <h2 class="section-title">${escapeHtml(strings.settings.title)}</h2>
        <div class="subtext">${escapeHtml(strings.settings.subtitle)}</div>
      </div>

      <form id="settings-form">
        <div class="settings-grid">
          <!-- Card 1: Userspace WireGuard -->
          <div class="surf-card settings-card">
            <h3 class="card-section-title">${escapeHtml(strings.settings.wgSection)}</h3>

            <div class="form-group">
              <label for="setting-wg-key">${escapeHtml(strings.settings.wgPrivateKey)}</label>
              <input
                type="password"
                id="setting-wg-key"
                class="text-input mono"
                placeholder="${escapeHtml(s.hasWgPrivateKey ? s.wgPrivateKeyMasked : strings.settings.wgPrivateKeyPlaceholder)}"
              />
              <div class="subtext-row">
                <span class="subtext">${escapeHtml(strings.settings.wgPrivateKeyHint)}</span>
                <button type="button" class="btn btn-sm btn-secondary" id="btn-open-surfshark-web">
                  ${escapeHtml(strings.settings.openSurfsharkKeyPage)}
                </button>
              </div>
            </div>

            <div class="form-group">
              <label for="setting-wg-address">${escapeHtml(strings.settings.wgAddress)}</label>
              <input
                type="text"
                id="setting-wg-address"
                class="text-input mono"
                value="${escapeHtml(s.wgAddress)}"
                placeholder="10.14.0.2/16"
              />
            </div>

            <div class="form-group">
              <label for="setting-wg-dns">${escapeHtml(strings.settings.wgDns)}</label>
              <input
                type="text"
                id="setting-wg-dns"
                class="text-input mono"
                value="${escapeHtml(s.wgDns)}"
                placeholder="162.252.172.57"
              />
            </div>
          </div>

          <!-- Card 2: GoLogin & Network -->
          <div class="surf-card settings-card">
            <h3 class="card-section-title">${escapeHtml(strings.settings.gologinSection)}</h3>

            <div class="form-group">
              <label for="setting-gologin-token">${escapeHtml(strings.settings.gologinToken)}</label>
              <input
                type="password"
                id="setting-gologin-token"
                class="text-input mono"
                placeholder="${escapeHtml(s.hasGologinToken ? s.gologinTokenMasked : strings.settings.gologinTokenPlaceholder)}"
              />
              <div class="subtext">${escapeHtml(strings.settings.gologinTokenHint)}</div>
            </div>

            <h3 class="card-section-title" style="margin-top: 14px;">${escapeHtml(strings.settings.networkSection)}</h3>

            <div class="form-group">
              <label for="setting-base-port">${escapeHtml(strings.settings.basePort)}</label>
              <input
                type="number"
                id="setting-base-port"
                class="text-input"
                value="${s.basePort}"
                min="1024"
                max="65000"
              />
            </div>

            <div class="form-group checkbox-group">
              <label class="checkbox-label">
                <input type="checkbox" id="setting-allow-lan" ${s.allowLan ? "checked" : ""} />
                <span>${escapeHtml(strings.settings.allowLan)}</span>
              </label>
              <div class="subtext">${escapeHtml(strings.settings.allowLanDesc)}</div>
            </div>

            <div class="form-group">
              <label for="setting-language">${escapeHtml(strings.settings.language)}</label>
              <select id="setting-language" class="select-input">
                <option value="en" ${s.language === "en" ? "selected" : ""}>English (EN)</option>
                <option value="vi" ${s.language === "vi" ? "selected" : ""}>Tiếng Việt (VI)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-actions-bar">
          <button type="submit" class="btn btn-primary" id="btn-save-settings">
            ${escapeHtml(strings.settings.saveBtn)}
          </button>
        </div>
      </form>

      <div class="settings-grid" style="margin-top: 4px;">
        <!-- Card 3: Wireproxy Core -->
        <div class="surf-card settings-card">
          <h3 class="card-section-title">${escapeHtml(strings.settings.wireproxySection)}</h3>
          <div class="wireproxy-status-row">
            <span class="badge ${s.wireproxyReady ? "badge-safe" : "badge-kill"}">
              ${escapeHtml(s.wireproxyReady ? strings.settings.wireproxyReady : strings.settings.wireproxyMissing)}
            </span>
            <span class="mono subtext">${escapeHtml(s.wireproxyPath || "Auto-resolved in system PATH or AppData")}</span>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-install-wireproxy">
              ${escapeHtml(strings.settings.installWireproxy)}
            </button>
          </div>
        </div>

        <!-- Card 4: Quick Import -->
        <div class="surf-card settings-card">
          <h3 class="card-section-title">${escapeHtml(strings.settings.importConfSection)}</h3>
          <div class="subtext">${escapeHtml(strings.settings.importConfDesc)}</div>
          <textarea
            id="conf-import-textarea"
            class="text-input mono textarea-conf"
            rows="3"
            placeholder="${escapeHtml(strings.settings.importConfPlaceholder)}"
          ></textarea>
          <div class="btn-group-sm">
            <button type="button" class="btn btn-primary" id="btn-import-conf">
              ${escapeHtml(strings.settings.importConfBtn)}
            </button>
            <button type="button" class="btn btn-secondary" id="btn-upload-conf">
              ${escapeHtml(strings.settings.uploadConfBtn)}
            </button>
            <input type="file" id="conf-file-input" accept=".conf,.txt" style="display:none" />
          </div>
        </div>
      </div>
    </div>
  `;
}

// Master Render Function
function render(): void {
  const app = document.getElementById("app");
  if (!app) return;

  if (!snapshot) {
    app.innerHTML = `<div class="empty-card" style="margin: 40px auto; max-width: 400px;">Loading s-proxy Hub...</div>`;
    return;
  }

  let panelContent = "";
  switch (activeTab) {
    case "hub":
      panelContent = renderHubTab(snapshot);
      break;
    case "status":
      panelContent = renderStatusTab(snapshot);
      break;
    case "catalog":
      panelContent = renderCatalogTab(snapshot);
      break;
    case "providers":
      panelContent = renderProvidersTab(snapshot);
      break;
    case "gologin":
      panelContent = renderGoLoginTab(snapshot);
      break;
    case "settings":
      panelContent = renderSettingsTab(snapshot);
      break;
  }

  app.innerHTML = `
    <div class="app-shell">
      ${renderSidebarRail()}
      <main class="main-area">
        <div class="main-container">
          ${panelContent}
        </div>
      </main>
    </div>
  `;

  attachEventListeners();
}

function attachEventListeners(): void {
  // Quick language switcher in sidebar rail
  document.querySelectorAll<HTMLButtonElement>(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.getAttribute("data-lang") as AppLanguage | null;
      if (lang) {
        void handleQuickSwitchLanguage(lang);
      }
    });
  });

  // Tab switching in sidebar rail
  document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab") as typeof activeTab;
      if (tab) {
        activeTab = tab;
        render();
      }
    });
  });

  // Quick button in Hub banner to jump to Status & Security tab
  document.querySelectorAll<HTMLButtonElement>(".btn-open-status-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = "status";
      render();
    });
  });

  // Status tab: Security toggle switches
  document.querySelectorAll<HTMLInputElement>(".security-toggle-input").forEach((input) => {
    input.addEventListener("change", () => {
      const feature = input.getAttribute("data-feature");
      if (!feature) return;
      if (feature === "localhostOnly") {
        // Localhost-Only ON means allowLan = false
        void handleToggleSecurityFeature("allowLan", !input.checked);
      } else {
        void handleToggleSecurityFeature(feature, input.checked);
      }
    });
  });

  const btnResetAllSecurity = document.getElementById("btn-reset-all-security");
  if (btnResetAllSecurity) {
    btnResetAllSecurity.addEventListener("click", () => {
      void handleToggleSecurityFeature("resetAll", true);
    });
  }

  const btnStatusRefresh = document.getElementById("btn-status-refresh");
  if (btnStatusRefresh) {
    btnStatusRefresh.addEventListener("click", () => {
      void handleRefreshSystem();
    });
  }

  // Hub actions
  const btnOpenCreateBridge = document.getElementById("btn-open-create-bridge");
  if (btnOpenCreateBridge) {
    btnOpenCreateBridge.addEventListener("click", () => {
      isCreateBridgeModalOpen = true;
      isCreateMultiModalOpen = false;
      render();
    });
  }

  const btnCancelBridgeModal = document.getElementById("btn-cancel-bridge-modal");
  if (btnCancelBridgeModal) {
    btnCancelBridgeModal.addEventListener("click", () => {
      isCreateBridgeModalOpen = false;
      render();
    });
  }

  const createBridgeForm = document.getElementById("create-bridge-form") as HTMLFormElement | null;
  if (createBridgeForm) {
    createBridgeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("bridge-slot-name") as HTMLInputElement | null;
      const portInput = document.getElementById("bridge-slot-port") as HTMLInputElement | null;
      const adapterInput = document.getElementById("bridge-slot-adapter") as HTMLInputElement | null;
      const autoStartInput = document.getElementById("bridge-slot-autostart") as HTMLInputElement | null;

      const portVal = portInput?.value ? parseInt(portInput.value, 10) : null;
      void handleCreateSlot({
        name: nameInput?.value || "",
        port: portVal && !isNaN(portVal) ? portVal : null,
        mode: "adapter_bridge",
        locationId: null,
        adapterHint: adapterInput?.value || null,
        autoStart: autoStartInput ? autoStartInput.checked : true,
      });
    });
  }

  const btnOpenCreateMulti = document.getElementById("btn-open-create-multi");
  if (btnOpenCreateMulti) {
    btnOpenCreateMulti.addEventListener("click", () => {
      modalMultiTzFilter =
        catalogTzFilter && catalogTzFilter !== "all"
          ? catalogTzFilter
          : detectSystemTimezoneInfo().tzGroup;
      isCreateMultiModalOpen = true;
      isCreateBridgeModalOpen = false;
      render();
    });
  }

  const multiSlotTzSelect = document.getElementById("multi-slot-tz") as HTMLSelectElement | null;
  if (multiSlotTzSelect) {
    multiSlotTzSelect.addEventListener("change", () => {
      modalMultiTzFilter = multiSlotTzSelect.value;
      render();
    });
  }

  const btnCancelMultiModal = document.getElementById("btn-cancel-multi-modal");
  if (btnCancelMultiModal) {
    btnCancelMultiModal.addEventListener("click", () => {
      isCreateMultiModalOpen = false;
      render();
    });
  }

  const createMultiForm = document.getElementById("create-multi-form") as HTMLFormElement | null;
  if (createMultiForm) {
    createMultiForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const locSelect = document.getElementById("multi-slot-location") as HTMLSelectElement | null;
      const nameInput = document.getElementById("multi-slot-name") as HTMLInputElement | null;
      const portInput = document.getElementById("multi-slot-port") as HTMLInputElement | null;
      const autoStartInput = document.getElementById("multi-slot-autostart") as HTMLInputElement | null;

      const locId = locSelect?.value || "";
      const selectedOpt = locSelect?.selectedOptions?.[0];
      const defaultName = selectedOpt?.getAttribute("data-default-name") || "Surfshark WG";
      const portVal = portInput?.value ? parseInt(portInput.value, 10) : null;

      void handleCreateSlot({
        name: nameInput?.value.trim() || defaultName,
        port: portVal && !isNaN(portVal) ? portVal : null,
        mode: "userspace_wg",
        locationId: locId,
        adapterHint: null,
        autoStart: autoStartInput ? autoStartInput.checked : true,
      });
    });
  }

  const btnStartAll = document.getElementById("btn-start-all-slots");
  if (btnStartAll) {
    btnStartAll.addEventListener("click", () => {
      void handleStartAllSlots();
    });
  }

  const btnStopAll = document.getElementById("btn-stop-all-slots");
  if (btnStopAll) {
    btnStopAll.addEventListener("click", () => {
      void handleStopAllSlots();
    });
  }

  const btnCheckAllIps = document.getElementById("btn-check-all-ips");
  if (btnCheckAllIps) {
    btnCheckAllIps.addEventListener("click", () => {
      void handleCheckAllSlotIps();
    });
  }

  const btnCopyAllSocks5 = document.getElementById("btn-copy-all-socks5");
  if (btnCopyAllSocks5) {
    btnCopyAllSocks5.addEventListener("click", () => {
      void handleCopyAllSocks5();
    });
  }

  const btnRefreshSystem = document.getElementById("btn-refresh-system");
  if (btnRefreshSystem) {
    btnRefreshSystem.addEventListener("click", () => {
      void handleRefreshSystem();
    });
  }

  // Copy buttons
  document.querySelectorAll<HTMLButtonElement>(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-copy") || "";
      const label = btn.getAttribute("data-label") || "URI";
      void copyToClipboard(text, label);
    });
  });

  // Check IP buttons
  document.querySelectorAll<HTMLButtonElement>(".btn-check-ip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slotId = btn.getAttribute("data-slot-id");
      if (slotId) {
        void handleCheckSlotIp(slotId);
      }
    });
  });

  // Slot toggle start/stop
  document.querySelectorAll<HTMLButtonElement>(".btn-toggle-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slotId = btn.getAttribute("data-slot-id");
      const start = btn.getAttribute("data-start") === "true";
      if (slotId) {
        void handleToggleSlot(slotId, start);
      }
    });
  });

  // Slot delete
  document.querySelectorAll<HTMLButtonElement>(".btn-delete-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slotId = btn.getAttribute("data-slot-id");
      if (slotId) {
        void handleDeleteSlot(slotId);
      }
    });
  });

  // Hub same-timezone server failover switcher
  document.querySelectorAll<HTMLSelectElement>(".select-same-tz-switch").forEach((sel) => {
    sel.addEventListener("change", () => {
      const slotId = sel.getAttribute("data-slot-id");
      const newLocId = sel.value;
      if (slotId && newLocId) {
        void handleSwitchSlotLocation(slotId, newLocId);
      }
    });
  });

  // Hub GoLogin profile selector change
  document.querySelectorAll<HTMLSelectElement>(".select-hub-profile").forEach((sel) => {
    sel.addEventListener("change", () => {
      const slotId = sel.getAttribute("data-slot-id");
      if (slotId) {
        hubSlotGologinSelection[slotId] = sel.value;
      }
    });
  });

  // Hub GoLogin sync button
  document.querySelectorAll<HTMLButtonElement>(".btn-hub-sync").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slotId = btn.getAttribute("data-slot-id");
      if (slotId) {
        const profileId =
          hubSlotGologinSelection[slotId] ||
          snapshot?.slots.find((s) => s.id === slotId)?.linkedGologinProfileId ||
          "";
        if (!profileId) {
          showToast(currentLanguage === "vi" ? "Chọn profile GoLogin trước khi Sync" : "Select a GoLogin profile first");
          return;
        }
        void handleAssignSlotToGoLogin(slotId, profileId, "socks5");
      }
    });
  });

  // Catalog search input
  const catalogSearch = document.getElementById("catalog-search-input") as HTMLInputElement | null;
  if (catalogSearch) {
    catalogSearch.addEventListener("input", () => {
      catalogSearchQuery = catalogSearch.value;
      const selStart = catalogSearch.selectionStart;
      const selEnd = catalogSearch.selectionEnd;
      render();
      const reSearch = document.getElementById("catalog-search-input") as HTMLInputElement | null;
      if (reSearch) {
        reSearch.focus();
        if (selStart !== null && selEnd !== null) {
          reSearch.setSelectionRange(selStart, selEnd);
        }
      }
    });
  }

  // Catalog filter pill tabs
  document.querySelectorAll<HTMLButtonElement>(".catalog-pill-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.getAttribute("data-filter") as typeof catalogFilterType | null;
      if (filter) {
        catalogFilterType = filter;
        render();
      }
    });
  });

  // Catalog provider filter pill tabs
  document.querySelectorAll<HTMLButtonElement>(".catalog-provider-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prov = btn.getAttribute("data-provider") as typeof catalogProviderFilter | null;
      if (prov) {
        catalogProviderFilter = prov;
        render();
      }
    });
  });

  // Catalog timezone dropdown selector
  const catalogTzSelect = document.getElementById("catalog-tz-select") as HTMLSelectElement | null;
  if (catalogTzSelect) {
    catalogTzSelect.addEventListener("change", () => {
      catalogTzFilter = catalogTzSelect.value;
      catalogGeoClusterFilter = "all";
      render();
    });
  }

  // Catalog geo-cluster dropdown selector (Impossible Travel Guard)
  const catalogClusterSelect = document.getElementById("catalog-cluster-select") as HTMLSelectElement | null;
  if (catalogClusterSelect) {
    catalogClusterSelect.addEventListener("change", () => {
      catalogGeoClusterFilter = catalogClusterSelect.value;
      render();
    });
  }

  // Quick reset to host machine's default timezone
  const btnResetSystemTz = document.getElementById("btn-reset-system-tz");
  if (btnResetSystemTz) {
    btnResetSystemTz.addEventListener("click", () => {
      catalogTzFilter = detectSystemTimezoneInfo().tzGroup;
      catalogGeoClusterFilter = "all";
      render();
    });
  }

  // Providers tab actions
  document.querySelectorAll<HTMLButtonElement>(".btn-browse-provider").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prov = btn.getAttribute("data-provider") as VpnProvider | null;
      if (prov) {
        catalogProviderFilter = prov;
        activeTab = "catalog";
        render();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-save-provider").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prov = btn.getAttribute("data-provider") as VpnProvider | null;
      if (!prov || !snapshot) return;
      const card = btn.closest(".provider-card");
      if (!card) return;
      const keyInput = card.querySelector<HTMLInputElement>(".prov-key-input");
      const addrInput = card.querySelector<HTMLInputElement>(".prov-addr-input");
      const dnsInput = card.querySelector<HTMLInputElement>(".prov-dns-input");
      const tokenInput = card.querySelector<HTMLInputElement>(".prov-token-input");

      const currentProv = snapshot.providers.find((p) => p.provider === prov);
      const newKey = keyInput?.value.trim() ? keyInput.value.trim() : null;
      const newToken = tokenInput?.value.trim() ? tokenInput.value.trim() : null;

      void handleSaveProviderConfig({
        provider: prov,
        privateKey: newKey,
        address: addrInput?.value.trim() || currentProv?.address || "10.14.0.2/16",
        dns: dnsInput?.value.trim() || currentProv?.dns || "1.1.1.1",
        apiToken: newToken,
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-sync-provider").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prov = btn.getAttribute("data-provider") as VpnProvider | null;
      if (!prov) return;
      const card = btn.closest(".provider-card");
      const tokenInput = card?.querySelector<HTMLInputElement>(".prov-token-input");
      void handleSyncProviderCatalog(prov, tokenInput?.value);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-import-provider-conf").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".provider-card");
      const fileInput = card?.querySelector<HTMLInputElement>(".prov-conf-file-input");
      fileInput?.click();
    });
  });

  document.querySelectorAll<HTMLInputElement>(".prov-conf-file-input").forEach((input) => {
    input.addEventListener("change", () => {
      const prov = input.getAttribute("data-provider") as VpnProvider | null;
      if (prov && input.files && input.files.length > 0) {
        void handleImportProviderConfs(prov, input.files);
      }
    });
  });

  // Catalog delete custom server
  document.querySelectorAll<HTMLButtonElement>(".btn-delete-custom-server").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prov = btn.getAttribute("data-provider") as VpnProvider | null;
      const locId = btn.getAttribute("data-loc-id");
      if (prov && locId) {
        void handleDeleteCustomServer(prov, locId);
      }
    });
  });

  // Catalog create & start slot
  document.querySelectorAll<HTMLButtonElement>(".btn-create-location-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const locId = btn.getAttribute("data-loc-id");
      const locLabel = btn.getAttribute("data-loc-label") || "Surfshark WG";
      if (locId) {
        void handleCreateSlot(
          {
            name: locLabel,
            port: null,
            mode: "userspace_wg",
            locationId: locId,
            adapterHint: null,
            autoStart: true,
          },
          true
        );
      }
    });
  });

  // GoLogin fetch button
  const btnFetchGoLogin = document.getElementById("btn-fetch-gologin-profiles");
  if (btnFetchGoLogin) {
    btnFetchGoLogin.addEventListener("click", () => {
      void handleFetchGoLoginProfiles();
    });
  }

  // GoLogin select inputs
  document.querySelectorAll<HTMLSelectElement>(".select-gologin-slot").forEach((sel) => {
    sel.addEventListener("change", () => {
      const pid = sel.getAttribute("data-profile-id");
      if (pid) {
        gologinSlotSelection[pid] = sel.value;
      }
    });
  });

  document.querySelectorAll<HTMLSelectElement>(".select-gologin-mode").forEach((sel) => {
    sel.addEventListener("change", () => {
      const pid = sel.getAttribute("data-profile-id");
      if (pid) {
        gologinModeSelection[pid] = sel.value as "socks5" | "http";
      }
    });
  });

  // GoLogin assign button
  document.querySelectorAll<HTMLButtonElement>(".btn-assign-gologin").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-profile-id");
      if (pid) {
        const slotId = gologinSlotSelection[pid] || "";
        const mode = gologinModeSelection[pid] || "socks5";
        void handleAssignSlotToGoLogin(slotId, pid, mode);
      }
    });
  });

  // Settings form submit
  const settingsForm = document.getElementById("settings-form") as HTMLFormElement | null;
  if (settingsForm) {
    settingsForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!snapshot) return;

      const wgKeyInput = document.getElementById("setting-wg-key") as HTMLInputElement | null;
      const wgAddrInput = document.getElementById("setting-wg-address") as HTMLInputElement | null;
      const wgDnsInput = document.getElementById("setting-wg-dns") as HTMLInputElement | null;
      const glTokenInput = document.getElementById("setting-gologin-token") as HTMLInputElement | null;
      const basePortInput = document.getElementById("setting-base-port") as HTMLInputElement | null;
      const allowLanInput = document.getElementById("setting-allow-lan") as HTMLInputElement | null;
      const langInput = document.getElementById("setting-language") as HTMLSelectElement | null;

      const newKey = wgKeyInput?.value.trim() ? wgKeyInput.value.trim() : null;
      const newToken = glTokenInput?.value.trim() ? glTokenInput.value.trim() : null;
      const basePortVal = basePortInput?.value ? parseInt(basePortInput.value, 10) : snapshot.settings.basePort;

      const payload: SettingsUpdatePayload = {
        wgPrivateKey: newKey,
        wgAddress: wgAddrInput?.value.trim() || snapshot.settings.wgAddress,
        wgDns: wgDnsInput?.value.trim() || snapshot.settings.wgDns,
        gologinToken: newToken,
        basePort: isNaN(basePortVal) ? snapshot.settings.basePort : basePortVal,
        allowLan: allowLanInput ? allowLanInput.checked : snapshot.settings.allowLan,
        language: (langInput?.value as AppLanguage) || snapshot.settings.language,
        wireproxyPath: snapshot.settings.wireproxyPath,
        killSwitchEnabled: snapshot.settings.killSwitchEnabled,
        dnsLeakProtection: snapshot.settings.dnsLeakProtection,
        ipv6LeakBlock: snapshot.settings.ipv6LeakBlock,
        ispIpGuard: snapshot.settings.ispIpGuard,
        autoVerifyIp: snapshot.settings.autoVerifyIp,
      };

      void handleSaveSettings(payload);
    });
  }

  // Settings install wireproxy
  const btnInstallWireproxy = document.getElementById("btn-install-wireproxy");
  if (btnInstallWireproxy) {
    btnInstallWireproxy.addEventListener("click", () => {
      void handleInstallWireproxy();
    });
  }

  // Open Surfshark WireGuard Key Web Page
  const btnOpenSurfsharkWeb = document.getElementById("btn-open-surfshark-web");
  if (btnOpenSurfsharkWeb) {
    btnOpenSurfsharkWeb.addEventListener("click", () => {
      void openUrl("https://my.surfshark.com/vpn/manual-setup/main/wireguard");
    });
  }

  // Settings conf import
  const btnImportConf = document.getElementById("btn-import-conf");
  if (btnImportConf) {
    btnImportConf.addEventListener("click", () => {
      const textarea = document.getElementById("conf-import-textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        void handleImportWgConf(textarea.value);
      }
    });
  }

  // Direct .conf file picker upload
  const btnUploadConf = document.getElementById("btn-upload-conf");
  const confFileInput = document.getElementById("conf-file-input") as HTMLInputElement | null;
  if (btnUploadConf && confFileInput) {
    btnUploadConf.addEventListener("click", () => {
      confFileInput.click();
    });
    confFileInput.addEventListener("change", () => {
      const file = confFileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const content = typeof reader.result === "string" ? reader.result : "";
        const textarea = document.getElementById("conf-import-textarea") as HTMLTextAreaElement | null;
        if (textarea) {
          textarea.value = content;
        }
        void handleImportWgConf(content);
      };
      reader.readAsText(file);
    });
  }
}

// Bootstrapping
window.addEventListener("DOMContentLoaded", () => {
  void fetchSnapshot();
});
