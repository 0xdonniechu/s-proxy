import { invoke } from "@tauri-apps/api/core";
import { DICTIONARY, type I18nStrings } from "./strings";
import type {
  AppLanguage,
  CreateSlotPayload,
  DetectedAdapter,
  GoLoginProfileSummary,
  HubSnapshot,
  ProxySlotView,
  SettingsUpdatePayload,
  SurfsharkLocation,
} from "./types";

// State
let snapshot: HubSnapshot | null = null;
let currentLanguage: AppLanguage = "vi";
let activeTab: "hub" | "catalog" | "gologin" | "settings" = "hub";

// Catalog filter state
let catalogSearchQuery = "";
let catalogFilterType: "all" | "generic" | "static" = "all";

// GoLogin assignment selection state: profileId -> slotId
const gologinSlotSelection: Record<string, string> = {};
const gologinModeSelection: Record<string, "socks5" | "http"> = {};

// Hub slot GoLogin selection state: slotId -> profileId
const hubSlotGologinSelection: Record<string, string> = {};

// Modal state for creating Adapter Bridge slot
let isCreateBridgeModalOpen = false;

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
  } catch (err) {
    showToast(`Error: ${String(err)}`);
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

async function handleCreateSlot(payload: CreateSlotPayload, switchToHub = false): Promise<void> {
  try {
    const res = await invoke<HubSnapshot>("create_slot", { payload });
    isCreateBridgeModalOpen = false;
    if (switchToHub) {
      activeTab = "hub";
    }
    applySnapshot(res);
    showToast(currentLanguage === "vi" ? "Tạo slot thành công!" : "Slot created successfully!");
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

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} ${getStrings().hub.copied}`);
  } catch {
    showToast(`Copy failed`);
  }
}

// Rendering components
function renderTopBar(snap: HubSnapshot): string {
  const strings = getStrings();
  const surf = snap.surfsharkAdapter;
  const isSurfConnected = surf && surf.statusUp && !surf.ipv4.startsWith("169.254.") && surf.ipv4 !== "";
  const isWireproxyReady = snap.settings.wireproxyReady;

  return `
    <header class="top-bar">
      <div class="brand">
        <span class="brand-title">s-proxy</span>
        <span class="brand-subtitle">${escapeHtml(strings.header.brandSubtitle)}</span>
      </div>
      <div class="status-pills">
        <div class="pill ${snap.hostIspIp ? "pill-safe" : "pill-warn"}">
          <span class="pill-label">${escapeHtml(strings.header.ispIp)}:</span>
          <span class="mono">${escapeHtml(snap.hostIspIp || "Detecting...")}</span>
        </div>
        <div class="pill ${isSurfConnected ? "pill-safe" : "pill-danger"}">
          <span class="pill-label">${escapeHtml(strings.header.surfsharkAdapter)}:</span>
          <span>${isSurfConnected ? `${escapeHtml(strings.header.connected)} (${escapeHtml(surf?.ipv4 || "")})` : escapeHtml(strings.header.disconnected)}</span>
        </div>
        <div class="pill ${isWireproxyReady ? "pill-safe" : "pill-warn"}">
          <span class="pill-label">${escapeHtml(strings.header.wireproxyCore)}:</span>
          <span>${isWireproxyReady ? escapeHtml(strings.header.ready) : escapeHtml(strings.header.missing)}</span>
        </div>
      </div>
    </header>
  `;
}

function renderTabBar(): string {
  const strings = getStrings();
  return `
    <nav class="tab-bar">
      <button class="tab-btn ${activeTab === "hub" ? "active" : ""}" data-tab="hub">
        ${escapeHtml(strings.tabs.proxyHub)}
      </button>
      <button class="tab-btn ${activeTab === "catalog" ? "active" : ""}" data-tab="catalog">
        ${escapeHtml(strings.tabs.surfsharkCatalog)}
      </button>
      <button class="tab-btn ${activeTab === "gologin" ? "active" : ""}" data-tab="gologin">
        ${escapeHtml(strings.tabs.gologinSync)}
      </button>
      <button class="tab-btn ${activeTab === "settings" ? "active" : ""}" data-tab="settings">
        ${escapeHtml(strings.tabs.settings)}
      </button>
    </nav>
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

function renderHubTab(snap: HubSnapshot): string {
  const strings = getStrings();

  const slotRows =
    snap.slots.length === 0
      ? `<tr><td colspan="7" class="empty-state">${escapeHtml(strings.hub.emptySlots)}</td></tr>`
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
              ? `<div class="egress-info">
                   <div class="mono"><strong>${escapeHtml(slot.egress.exitIp)}</strong></div>
                   <div class="subtext">${escapeHtml(slot.egress.city ? `${slot.egress.city}, ` : "")}${escapeHtml(slot.egress.country)} &bull; ${slot.egress.latencyMs}ms</div>
                   <div>${renderLeakBadge(slot)}</div>
                 </div>`
              : `<div class="subtext">${escapeHtml(strings.status.leakUnchecked)}</div>`;

            return `
              <tr data-slot-id="${escapeHtml(slot.id)}">
                <td>
                  <div class="slot-name-cell">
                    <strong>${escapeHtml(slot.name)}</strong>
                    <div class="subtext mono">${escapeHtml(slot.connectionName || slot.boundAdapterName || slot.adapterHint || "auto")}</div>
                  </div>
                </td>
                <td>
                  <span class="badge ${slot.mode === "adapter_bridge" ? "badge-running" : "badge-safe"}">
                    ${slot.mode === "adapter_bridge" ? escapeHtml(strings.status.modeAdapterBridge) : escapeHtml(strings.status.modeUserspaceWg)}
                  </span>
                </td>
                <td>
                  <div class="endpoint-cell">
                    <span class="mono">${escapeHtml(slot.listenHost)}:${slot.port}</span>
                    <div class="btn-group-sm">
                      <button class="btn btn-sm btn-secondary btn-copy" data-copy="${escapeHtml(slot.socks5Uri)}" data-label="SOCKS5">
                        ${escapeHtml(strings.hub.copySocks5)}
                      </button>
                      <button class="btn btn-sm btn-secondary btn-copy" data-copy="${escapeHtml(slot.httpUri)}" data-label="HTTP">
                        ${escapeHtml(strings.hub.copyHttp)}
                      </button>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="status-cell">
                    ${renderStatusBadge(slot.status)}
                    <div class="subtext" title="${escapeHtml(slot.statusDetail)}">${escapeHtml(slot.statusDetail)}</div>
                    ${
                      isRunning
                        ? `<div class="traffic-text mono">${slot.activeConnections} conn &bull; ${formatBytes(slot.bytesTransferred)}</div>`
                        : ""
                    }
                  </div>
                </td>
                <td>
                  <div class="egress-cell">
                    ${egressInfo}
                    <button class="btn btn-sm btn-secondary btn-check-ip" data-slot-id="${escapeHtml(slot.id)}" ${!isRunning ? "disabled" : ""}>
                      ${escapeHtml(strings.hub.checkIp)}
                    </button>
                  </div>
                </td>
                <td>
                  <div class="gologin-cell">
                    <select class="select-input select-hub-profile" data-slot-id="${escapeHtml(slot.id)}">
                      <option value="">${escapeHtml(strings.hub.selectProfilePrompt)}</option>
                      ${profileOptions}
                    </select>
                    <button class="btn btn-sm btn-secondary btn-hub-sync" data-slot-id="${escapeHtml(slot.id)}">
                      ${escapeHtml(strings.hub.sync)}
                    </button>
                  </div>
                </td>
                <td>
                  <div class="slot-actions">
                    <button class="btn btn-sm ${isRunning ? "btn-danger" : "btn-primary"} btn-toggle-slot" data-slot-id="${escapeHtml(slot.id)}" data-start="${!isRunning}">
                      ${isRunning ? escapeHtml(strings.hub.stop) : escapeHtml(strings.hub.start)}
                    </button>
                    <button class="btn btn-sm btn-danger btn-delete-slot" data-slot-id="${escapeHtml(slot.id)}">
                      ${escapeHtml(strings.hub.delete)}
                    </button>
                  </div>
                </td>
              </tr>
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

  const modalHtml = isCreateBridgeModalOpen
    ? `
      <div class="modal-backdrop">
        <div class="modal-card">
          <h3>${escapeHtml(strings.hub.modalCreateTitle)}</h3>
          <form id="create-bridge-form">
            <div class="form-group">
              <label>${escapeHtml(strings.hub.slotNameLabel)}</label>
              <input type="text" id="bridge-slot-name" class="text-input" placeholder="Surfshark Bridge" />
            </div>
            <div class="form-group">
              <label>${escapeHtml(strings.hub.slotPortLabel)}</label>
              <input type="number" id="bridge-slot-port" class="text-input" placeholder="${snap.settings.basePort}" min="1024" max="65535" />
              <div class="subtext">${escapeHtml(strings.hub.slotPortHint)}</div>
            </div>
            <div class="form-group">
              <label>${escapeHtml(strings.hub.adapterHintLabel)}</label>
              <input type="text" id="bridge-slot-adapter" class="text-input" placeholder="${escapeHtml(strings.hub.adapterHintPlaceholder)}" />
            </div>
            <div class="form-group checkbox-group">
              <label>
                <input type="checkbox" id="bridge-slot-autostart" checked />
                ${escapeHtml(strings.hub.autoStartLabel)}
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
    : "";

  return `
    <div class="panel">
      <div class="toolbar">
        <button class="btn btn-primary" id="btn-open-create-bridge">
          ${escapeHtml(strings.hub.addAdapterSlot)}
        </button>
        <button class="btn btn-secondary" id="btn-switch-to-catalog">
          ${escapeHtml(strings.hub.addMultiVpnSlot)}
        </button>
        <button class="btn btn-secondary" id="btn-refresh-system">
          ${escapeHtml(strings.hub.refreshSystem)}
        </button>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${escapeHtml(strings.hub.colSlotName)}</th>
              <th>${escapeHtml(strings.hub.colMode)}</th>
              <th>${escapeHtml(strings.hub.colEndpoint)}</th>
              <th>${escapeHtml(strings.hub.colStatus)}</th>
              <th>${escapeHtml(strings.hub.colEgress)}</th>
              <th>${escapeHtml(strings.hub.colGoLogin)}</th>
              <th>${escapeHtml(strings.hub.colActions)}</th>
            </tr>
          </thead>
          <tbody>
            ${slotRows}
          </tbody>
        </table>
      </div>

      <div class="section-divider"></div>

      <div class="diagnostics-header">
        <h4>${escapeHtml(strings.hub.adapterDiagnostics)}</h4>
        <div class="subtext">${escapeHtml(strings.hub.adapterDiagnosticsDesc)}</div>
      </div>

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

      ${modalHtml}
    </div>
  `;
}

function renderCatalogTab(snap: HubSnapshot): string {
  const strings = getStrings();

  const query = catalogSearchQuery.trim().toLowerCase();
  const filtered = snap.locations.filter((loc: SurfsharkLocation) => {
    if (catalogFilterType !== "all" && loc.locationType !== catalogFilterType) {
      return false;
    }
    if (!query) return true;
    return (
      loc.country.toLowerCase().includes(query) ||
      loc.location.toLowerCase().includes(query) ||
      loc.connectionName.toLowerCase().includes(query) ||
      loc.countryCode.toLowerCase().includes(query)
    );
  });

  const rows =
    filtered.length === 0
      ? `<tr><td colspan="6" class="empty-state">${escapeHtml(strings.catalog.noServersMatch)}</td></tr>`
      : filtered
          .map((loc: SurfsharkLocation) => {
            const typeLabel =
              loc.locationType === "static" ? strings.catalog.staticType : strings.catalog.genericType;
            const typeBadge =
              loc.locationType === "static"
                ? `<span class="badge badge-safe">${escapeHtml(typeLabel)}</span>`
                : `<span class="badge">${escapeHtml(typeLabel)}</span>`;

            return `
              <tr>
                <td><strong>${escapeHtml(loc.country)}</strong> (${escapeHtml(loc.countryCode)})</td>
                <td>${escapeHtml(loc.location)}</td>
                <td>${typeBadge}</td>
                <td>
                  <div class="load-bar-wrap">
                    <div class="load-bar" style="width: ${Math.min(loc.load, 100)}%;"></div>
                    <span class="subtext">${loc.load}%</span>
                  </div>
                </td>
                <td class="mono subtext">${escapeHtml(loc.connectionName)}</td>
                <td>
                  <button class="btn btn-sm btn-primary btn-create-location-slot" data-loc-id="${escapeHtml(loc.id)}" data-loc-label="${escapeHtml(`${loc.countryCode} • ${loc.country} - ${loc.location}`)}">
                    ${escapeHtml(strings.catalog.createAndStart)}
                  </button>
                </td>
              </tr>
            `;
          })
          .join("");

  return `
    <div class="panel">
      <div class="toolbar">
        <input
          type="search"
          id="catalog-search-input"
          class="search-input"
          placeholder="${escapeHtml(strings.catalog.searchPlaceholder)}"
          value="${escapeHtml(catalogSearchQuery)}"
        />
        <select id="catalog-filter-select" class="select-input">
          <option value="all" ${catalogFilterType === "all" ? "selected" : ""}>${escapeHtml(strings.catalog.filterAll)}</option>
          <option value="generic" ${catalogFilterType === "generic" ? "selected" : ""}>${escapeHtml(strings.catalog.filterGeneric)}</option>
          <option value="static" ${catalogFilterType === "static" ? "selected" : ""}>${escapeHtml(strings.catalog.filterStatic)}</option>
        </select>
        <span class="subtext">
          ${escapeHtml(strings.catalog.serverCount.replace("{count}", String(filtered.length)))}
        </span>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${escapeHtml(strings.catalog.colCountry)}</th>
              <th>${escapeHtml(strings.catalog.colCity)}</th>
              <th>${escapeHtml(strings.catalog.colType)}</th>
              <th>${escapeHtml(strings.catalog.colLoad)}</th>
              <th>${escapeHtml(strings.catalog.colServer)}</th>
              <th>${escapeHtml(strings.catalog.colAction)}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderGoLoginTab(snap: HubSnapshot): string {
  const strings = getStrings();

  const rows =
    snap.gologinProfiles.length === 0
      ? `<tr><td colspan="6" class="empty-state">${escapeHtml(strings.gologin.noProfiles)}</td></tr>`
      : snap.gologinProfiles
          .map((prof: GoLoginProfileSummary) => {
            const hasProxy = prof.proxyHost && prof.proxyPort > 0;
            const currentProxyDisplay = hasProxy
              ? `<span class="mono">${escapeHtml(prof.proxyMode)}://${escapeHtml(prof.proxyHost)}:${prof.proxyPort}</span>`
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
              <tr data-profile-id="${escapeHtml(prof.id)}">
                <td><strong>${escapeHtml(prof.name)}</strong></td>
                <td class="mono subtext">${escapeHtml(prof.id)}</td>
                <td><span class="badge">${escapeHtml(prof.os)}</span></td>
                <td>${currentProxyDisplay}</td>
                <td>
                  <div class="assign-inputs">
                    <select class="select-input select-gologin-slot" data-profile-id="${escapeHtml(prof.id)}">
                      <option value="">${escapeHtml(strings.gologin.selectSlotPrompt)}</option>
                      ${rowSlotOptions}
                    </select>
                    <select class="select-input select-gologin-mode" data-profile-id="${escapeHtml(prof.id)}">
                      <option value="socks5" ${currentModeVal === "socks5" ? "selected" : ""}>SOCKS5</option>
                      <option value="http" ${currentModeVal === "http" ? "selected" : ""}>HTTP</option>
                    </select>
                  </div>
                </td>
                <td>
                  <button class="btn btn-sm btn-primary btn-assign-gologin" data-profile-id="${escapeHtml(prof.id)}">
                    ${escapeHtml(strings.gologin.assignBtn)}
                  </button>
                </td>
              </tr>
            `;
          })
          .join("");

  return `
    <div class="panel">
      <div class="toolbar">
        <button class="btn btn-primary" id="btn-fetch-gologin-profiles">
          ${escapeHtml(strings.gologin.fetchProfiles)}
        </button>
        <span class="subtext">${escapeHtml(strings.gologin.fetchHint)}</span>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${escapeHtml(strings.gologin.colProfileName)}</th>
              <th>${escapeHtml(strings.gologin.colProfileId)}</th>
              <th>${escapeHtml(strings.gologin.colProfileOs)}</th>
              <th>${escapeHtml(strings.gologin.colCurrentProxy)}</th>
              <th>${escapeHtml(strings.gologin.colAssignSlot)}</th>
              <th>${escapeHtml(strings.gologin.colAction)}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSettingsTab(snap: HubSnapshot): string {
  const strings = getStrings();
  const s = snap.settings;

  return `
    <div class="panel">
      <div class="settings-header">
        <h3>${escapeHtml(strings.settings.title)}</h3>
        <div class="subtext">${escapeHtml(strings.settings.subtitle)}</div>
      </div>

      <form id="settings-form">
        <div class="form-grid">
          <div class="settings-section">
            <h4>${escapeHtml(strings.settings.wgSection)}</h4>

            <div class="form-group">
              <label>${escapeHtml(strings.settings.wgPrivateKey)}</label>
              <input
                type="password"
                id="setting-wg-key"
                class="text-input mono"
                placeholder="${escapeHtml(s.hasWgPrivateKey ? s.wgPrivateKeyMasked : strings.settings.wgPrivateKeyPlaceholder)}"
              />
              <div class="subtext">${escapeHtml(strings.settings.wgPrivateKeyHint)}</div>
            </div>

            <div class="form-group">
              <label>${escapeHtml(strings.settings.wgAddress)}</label>
              <input
                type="text"
                id="setting-wg-address"
                class="text-input mono"
                value="${escapeHtml(s.wgAddress)}"
                placeholder="10.14.0.2/16"
              />
            </div>

            <div class="form-group">
              <label>${escapeHtml(strings.settings.wgDns)}</label>
              <input
                type="text"
                id="setting-wg-dns"
                class="text-input mono"
                value="${escapeHtml(s.wgDns)}"
                placeholder="162.252.172.57"
              />
            </div>
          </div>

          <div class="settings-section">
            <h4>${escapeHtml(strings.settings.gologinSection)}</h4>

            <div class="form-group">
              <label>${escapeHtml(strings.settings.gologinToken)}</label>
              <input
                type="password"
                id="setting-gologin-token"
                class="text-input mono"
                placeholder="${escapeHtml(s.hasGologinToken ? s.gologinTokenMasked : strings.settings.gologinTokenPlaceholder)}"
              />
              <div class="subtext">${escapeHtml(strings.settings.gologinTokenHint)}</div>
            </div>

            <h4>${escapeHtml(strings.settings.networkSection)}</h4>

            <div class="form-group">
              <label>${escapeHtml(strings.settings.basePort)}</label>
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
              <label>
                <input type="checkbox" id="setting-allow-lan" ${s.allowLan ? "checked" : ""} />
                ${escapeHtml(strings.settings.allowLan)}
              </label>
              <div class="subtext">${escapeHtml(strings.settings.allowLanDesc)}</div>
            </div>

            <div class="form-group">
              <label>${escapeHtml(strings.settings.language)}</label>
              <select id="setting-language" class="select-input">
                <option value="vi" ${s.language === "vi" ? "selected" : ""}>Tiếng Việt (VI)</option>
                <option value="en" ${s.language === "en" ? "selected" : ""}>English (EN)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="btn-group-right">
          <button type="submit" class="btn btn-primary" id="btn-save-settings">
            ${escapeHtml(strings.settings.saveBtn)}
          </button>
        </div>
      </form>

      <div class="section-divider"></div>

      <div class="settings-section">
        <h4>${escapeHtml(strings.settings.wireproxySection)}</h4>
        <div class="wireproxy-status-row">
          <span class="badge ${s.wireproxyReady ? "badge-safe" : "badge-kill"}">
            ${escapeHtml(s.wireproxyReady ? strings.settings.wireproxyReady : strings.settings.wireproxyMissing)}
          </span>
          <span class="mono subtext">${escapeHtml(s.wireproxyPath || "Auto-resolved in system PATH or Local AppData")}</span>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-install-wireproxy">
            ${escapeHtml(strings.settings.installWireproxy)}
          </button>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="settings-section">
        <h4>${escapeHtml(strings.settings.importConfSection)}</h4>
        <div class="subtext">${escapeHtml(strings.settings.importConfDesc)}</div>
        <textarea
          id="conf-import-textarea"
          class="text-input mono textarea-conf"
          rows="5"
          placeholder="${escapeHtml(strings.settings.importConfPlaceholder)}"
        ></textarea>
        <button type="button" class="btn btn-secondary" id="btn-import-conf">
          ${escapeHtml(strings.settings.importConfBtn)}
        </button>
      </div>
    </div>
  `;
}

// Master Render Function
function render(): void {
  const app = document.getElementById("app");
  if (!app) return;

  if (!snapshot) {
    app.innerHTML = `<div class="loading-state">Loading s-proxy Hub...</div>`;
    return;
  }

  let panelContent = "";
  switch (activeTab) {
    case "hub":
      panelContent = renderHubTab(snapshot);
      break;
    case "catalog":
      panelContent = renderCatalogTab(snapshot);
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
      ${renderTopBar(snapshot)}
      ${renderTabBar()}
      <main class="main-content">
        ${panelContent}
      </main>
      <div id="toast-container"></div>
    </div>
  `;

  attachEventListeners();
}

function attachEventListeners(): void {
  // Tab switching
  document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab") as typeof activeTab;
      if (tab) {
        activeTab = tab;
        render();
      }
    });
  });

  // Hub actions
  const btnOpenCreateBridge = document.getElementById("btn-open-create-bridge");
  if (btnOpenCreateBridge) {
    btnOpenCreateBridge.addEventListener("click", () => {
      isCreateBridgeModalOpen = true;
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

  const btnSwitchToCatalog = document.getElementById("btn-switch-to-catalog");
  if (btnSwitchToCatalog) {
    btnSwitchToCatalog.addEventListener("click", () => {
      activeTab = "catalog";
      render();
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
      // Re-render table body without full redraw to keep focus if possible, or redraw
      const tableWrap = document.querySelector(".table-wrap");
      if (tableWrap && snapshot) {
        render();
        const reSearch = document.getElementById("catalog-search-input") as HTMLInputElement | null;
        if (reSearch) {
          reSearch.focus();
          reSearch.setSelectionRange(reSearch.value.length, reSearch.value.length);
        }
      }
    });
  }

  // Catalog filter select
  const catalogFilter = document.getElementById("catalog-filter-select") as HTMLSelectElement | null;
  if (catalogFilter) {
    catalogFilter.addEventListener("change", () => {
      catalogFilterType = catalogFilter.value as typeof catalogFilterType;
      render();
    });
  }

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
}

// Bootstrapping
window.addEventListener("DOMContentLoaded", () => {
  void fetchSnapshot();
});
