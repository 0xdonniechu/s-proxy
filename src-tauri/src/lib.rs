pub mod gologin;
pub mod providers;
pub mod proxy_engine;
pub mod settings;
pub mod surfshark;
pub mod wireguard;

use gologin::{
    check_slot_egress_blocking, detect_host_isp_ip_with_interface_blocking,
    fetch_gologin_profiles_blocking, update_gologin_profile_proxy_blocking, EgressCheckResult,
    GoLoginProfileSummary, LeakStatus,
};
use providers::{
    fetch_mullvad_catalog_blocking, fetch_nordvpn_catalog_blocking,
    fetch_nordvpn_private_key_blocking, load_cached_provider_locations,
    parse_and_build_custom_location, validate_provider_network_fields, ProviderView,
    SaveProviderPayload, VpnProvider,
};
use proxy_engine::{start_proxy_listener, RunningProxyHandle, UpstreamConfig};
use serde::{Deserialize, Serialize};
use settings::{
    ensure_all_providers, load_state_from_path, parse_wg_conf, save_state_to_path, state_file_path,
    validate_slots, validate_wg_key_format, PersistedState, ProxySlotConfig, SettingsUpdatePayload,
    SettingsView, SlotMode,
};
use std::collections::{HashMap, HashSet};
use std::net::Ipv4Addr;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use surfshark::{
    detect_windows_adapters, load_local_catalog, AdapterKind, DetectedAdapter, SurfsharkLocation,
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use wireguard::{
    cleanup_stale_runtime_configs, install_wireproxy_binary, resolve_wireproxy_binary,
    spawn_wireproxy_for_slot, WireproxyHandle,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SlotRuntimeStatus {
    #[default]
    Stopped,
    Running,
    KillSwitch,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySlotView {
    pub id: String,
    pub name: String,
    pub port: u16,
    pub listen_host: String,
    pub socks5_uri: String,
    pub http_uri: String,
    pub mode: SlotMode,
    pub provider: VpnProvider,
    pub location_id: String,
    pub country_code: String,
    pub location_label: String,
    pub connection_name: String,
    pub tz_group: String,
    pub utc_offset: String,
    pub iana_timezone: String,
    pub adapter_hint: String,
    pub bound_adapter_name: String,
    pub bound_adapter_ip: String,
    pub status: SlotRuntimeStatus,
    pub status_detail: String,
    pub active_connections: usize,
    pub bytes_transferred: u64,
    pub egress: Option<EgressCheckResult>,
    pub linked_gologin_profile_id: String,
    pub linked_gologin_profile_name: String,
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubSnapshot {
    pub host_isp_ip: Option<String>,
    pub surfshark_adapter: Option<DetectedAdapter>,
    pub adapters: Vec<DetectedAdapter>,
    pub slots: Vec<ProxySlotView>,
    pub locations_count: usize,
    pub locations: Vec<SurfsharkLocation>,
    pub providers: Vec<ProviderView>,
    pub gologin_profiles: Vec<GoLoginProfileSummary>,
    pub settings: SettingsView,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSlotPayload {
    pub name: String,
    pub port: Option<u16>,
    pub mode: SlotMode,
    pub location_id: Option<String>,
    pub adapter_hint: Option<String>,
    pub auto_start: bool,
}

struct ActiveSlotRuntime {
    proxy_handle: Option<RunningProxyHandle>,
    wg_handle: Option<WireproxyHandle>,
    bound_adapter_name: String,
    bound_adapter_ip: String,
    status: SlotRuntimeStatus,
    status_detail: String,
    egress: Option<EgressCheckResult>,
}

impl ActiveSlotRuntime {
    fn stop_handles(&mut self) {
        if let Some(ref h) = self.proxy_handle {
            h.stop();
        }
        self.proxy_handle = None;
        if let Some(ref mut wg) = self.wg_handle {
            wg.stop();
        }
        self.wg_handle = None;
    }
}

pub struct HubCore {
    pub persisted: PersistedState,
    pub adapters: Vec<DetectedAdapter>,
    pub locations: Vec<SurfsharkLocation>,
    pub provider_catalogs: HashMap<VpnProvider, Vec<SurfsharkLocation>>,
    pub gologin_profiles: Vec<GoLoginProfileSummary>,
    pub host_isp_ip: Option<String>,
    runtimes: HashMap<String, ActiveSlotRuntime>,
}

impl Default for HubCore {
    fn default() -> Self {
        Self::new()
    }
}

impl HubCore {
    pub fn new() -> Self {
        cleanup_stale_runtime_configs();
        let persisted = load_state_from_path(&state_file_path());
        let locations = load_local_catalog();
        let mut provider_catalogs = HashMap::new();
        provider_catalogs.insert(
            VpnProvider::Nordvpn,
            load_cached_provider_locations(VpnProvider::Nordvpn),
        );
        provider_catalogs.insert(
            VpnProvider::Mullvad,
            load_cached_provider_locations(VpnProvider::Mullvad),
        );
        let adapters = detect_windows_adapters();
        Self {
            persisted,
            adapters,
            locations,
            provider_catalogs,
            gologin_profiles: Vec::new(),
            host_isp_ip: None,
            runtimes: HashMap::new(),
        }
    }

    pub fn provider_locations(&self, provider: VpnProvider) -> Vec<SurfsharkLocation> {
        let mut list = match provider {
            VpnProvider::Surfshark => self.locations.clone(),
            VpnProvider::Nordvpn | VpnProvider::Mullvad => self
                .provider_catalogs
                .get(&provider)
                .cloned()
                .unwrap_or_default(),
            VpnProvider::Protonvpn | VpnProvider::Custom => Vec::new(),
        };
        if let Some(cfg) = self
            .persisted
            .providers
            .iter()
            .find(|p| p.provider == provider)
        {
            for custom in &cfg.custom_locations {
                if !list.iter().any(|l| l.id == custom.id) {
                    list.push(custom.clone());
                }
            }
        }
        list
    }

    pub fn all_locations(&self) -> Vec<SurfsharkLocation> {
        let mut combined = Vec::new();
        for p in VpnProvider::all() {
            combined.append(&mut self.provider_locations(p));
        }
        combined
    }

    pub fn credentials_for_provider(&self, provider: VpnProvider) -> (String, String, String) {
        if let Some(cfg) = self
            .persisted
            .providers
            .iter()
            .find(|p| p.provider == provider)
        {
            if provider == VpnProvider::Surfshark && cfg.private_key.trim().is_empty() {
                return (
                    self.persisted.settings.wg_private_key.clone(),
                    self.persisted.settings.wg_address.clone(),
                    self.persisted.settings.wg_dns.clone(),
                );
            }
            return (cfg.private_key.clone(), cfg.address.clone(), cfg.dns.clone());
        }
        (
            self.persisted.settings.wg_private_key.clone(),
            self.persisted.settings.wg_address.clone(),
            self.persisted.settings.wg_dns.clone(),
        )
    }

    pub fn stop_all(&mut self) {
        for rt in self.runtimes.values_mut() {
            rt.stop_handles();
            rt.status = SlotRuntimeStatus::Stopped;
            rt.status_detail = "Stopped".to_string();
        }
    }

    fn primary_isp_ipv4(&self) -> Option<Ipv4Addr> {
        self.adapters
            .iter()
            .find(|a| a.is_default_route && a.kind == AdapterKind::PrimaryIsp)
            .or_else(|| {
                self.adapters
                    .iter()
                    .find(|a| a.kind == AdapterKind::PrimaryIsp && a.status_up)
            })
            .and_then(|a| a.ipv4.parse::<Ipv4Addr>().ok())
    }

    fn active_surfshark_adapter(&self) -> Option<DetectedAdapter> {
        self.adapters
            .iter()
            .find(|a| {
                a.kind == AdapterKind::Surfshark
                    && a.status_up
                    && !a.ipv4.starts_with("169.254.")
                    && !a.ipv4.is_empty()
            })
            .cloned()
            .or_else(|| {
                self.adapters
                    .iter()
                    .find(|a| a.kind == AdapterKind::Surfshark)
                    .cloned()
            })
    }

    fn select_adapter_for_slot(&self, adapter_hint: &str) -> Result<DetectedAdapter, String> {
        let ks_enabled = self.persisted.settings.kill_switch_enabled;
        let hint = adapter_hint.trim();
        if !hint.is_empty() {
            let matched = self
                .adapters
                .iter()
                .find(|a| {
                    a.name.eq_ignore_ascii_case(hint)
                        || a.description.to_lowercase().contains(&hint.to_lowercase())
                })
                .ok_or_else(|| format!("Configured adapter '{hint}' not found"))?;
            if ks_enabled && matched.kind == AdapterKind::PrimaryIsp {
                return Err(format!(
                    "Fail-closed: Adapter '{}' is the primary ISP interface and cannot be used as a VPN bridge",
                    matched.name
                ));
            }
            if !matched.status_up || matched.ipv4.is_empty() || matched.ipv4.starts_with("169.254.")
            {
                return Err(format!(
                    "Kill-switch active: Adapter '{}' is disconnected or has no tunnel IPv4 ({})",
                    matched.name, matched.ipv4
                ));
            }
            return Ok(matched.clone());
        }

        // Auto-select Surfshark adapter first
        if let Some(surf) = self.adapters.iter().find(|a| {
            a.kind == AdapterKind::Surfshark
                && a.status_up
                && !a.ipv4.is_empty()
                && !a.ipv4.starts_with("169.254.")
        }) {
            return Ok(surf.clone());
        }

        if !ks_enabled {
            if let Some(fallback) = self.adapters.iter().find(|a| {
                a.status_up && !a.ipv4.is_empty() && !a.ipv4.starts_with("169.254.")
            }) {
                return Ok(fallback.clone());
            }
        }

        Err("Kill-switch active: Surfshark VPN adapter is currently Disconnected. Connect Surfshark Desktop first (or use Userspace WireGuard mode).".to_string())
    }

    fn next_available_port(&self) -> u16 {
        let used: HashSet<u16> = self.persisted.slots.iter().map(|s| s.port).collect();
        let start = self.persisted.settings.base_port.max(1024);
        for p in start..=65000 {
            if !used.contains(&p) {
                return p;
            }
        }
        start
    }

    pub fn build_snapshot(&self) -> HubSnapshot {
        let listen_host = if self.persisted.settings.allow_lan {
            "0.0.0.0"
        } else {
            "127.0.0.1"
        };
        let wireproxy_ready =
            resolve_wireproxy_binary(&self.persisted.settings.wireproxy_path).is_some();

        let all_locs = self.all_locations();

        let slots = self
            .persisted
            .slots
            .iter()
            .map(|cfg| {
                let rt = self.runtimes.get(&cfg.id);
                let (status, status_detail, bound_name, bound_ip, active_conn, bytes_tx, egress) =
                    if let Some(r) = rt {
                        let (ac, bt) = if let Some(ref ph) = r.proxy_handle {
                            (
                                ph.metrics.active_connections.load(Ordering::Relaxed),
                                ph.metrics.bytes_transferred.load(Ordering::Relaxed),
                            )
                        } else {
                            (0, 0)
                        };
                        (
                            r.status,
                            r.status_detail.clone(),
                            r.bound_adapter_name.clone(),
                            r.bound_adapter_ip.clone(),
                            ac,
                            bt,
                            r.egress.clone(),
                        )
                    } else {
                        (
                            SlotRuntimeStatus::Stopped,
                            "Stopped".to_string(),
                            String::new(),
                            String::new(),
                            0,
                            0,
                            None,
                        )
                    };

                let (tz_group, utc_offset, iana_timezone) = all_locs
                    .iter()
                    .find(|l| l.id == cfg.location_id || l.connection_name == cfg.connection_name)
                    .map(|l| {
                        (
                            l.tz_group.clone(),
                            l.utc_offset.clone(),
                            l.iana_timezone.clone(),
                        )
                    })
                    .or_else(|| {
                        surfshark::classify_location_timezone(
                            &cfg.country_code,
                            &cfg.location_label,
                            &cfg.connection_name,
                            "",
                        )
                        .map(|m| {
                            (
                                m.tz_group.to_string(),
                                m.utc_offset.to_string(),
                                m.iana_timezone.to_string(),
                            )
                        })
                    })
                    .unwrap_or_default();

                ProxySlotView {
                    id: cfg.id.clone(),
                    name: cfg.name.clone(),
                    port: cfg.port,
                    listen_host: listen_host.to_string(),
                    socks5_uri: format!("socks5://127.0.0.1:{}", cfg.port),
                    http_uri: format!("http://127.0.0.1:{}", cfg.port),
                    mode: cfg.mode,
                    provider: cfg.provider,
                    location_id: cfg.location_id.clone(),
                    country_code: cfg.country_code.clone(),
                    location_label: cfg.location_label.clone(),
                    connection_name: cfg.connection_name.clone(),
                    tz_group,
                    utc_offset,
                    iana_timezone,
                    adapter_hint: cfg.adapter_hint.clone(),
                    bound_adapter_name: bound_name,
                    bound_adapter_ip: bound_ip,
                    status,
                    status_detail,
                    active_connections: active_conn,
                    bytes_transferred: bytes_tx,
                    egress,
                    linked_gologin_profile_id: cfg.linked_gologin_profile_id.clone(),
                    linked_gologin_profile_name: cfg.linked_gologin_profile_name.clone(),
                    auto_start: cfg.auto_start,
                }
            })
            .collect();

        let providers: Vec<ProviderView> = VpnProvider::all()
            .into_iter()
            .map(|p| {
                let count = self.provider_locations(p).len();
                if let Some(cfg) = self.persisted.providers.iter().find(|c| c.provider == p) {
                    cfg.to_view(count)
                } else {
                    providers::ProviderConfig::for_provider(p).to_view(count)
                }
            })
            .collect();

        HubSnapshot {
            host_isp_ip: self.host_isp_ip.clone(),
            surfshark_adapter: self.active_surfshark_adapter(),
            adapters: self.adapters.clone(),
            slots,
            locations_count: all_locs.len(),
            locations: all_locs,
            providers,
            gologin_profiles: self.gologin_profiles.clone(),
            settings: self.persisted.settings.to_view(wireproxy_ready),
        }
    }
}

pub type SharedHub = Arc<Mutex<HubCore>>;

async fn start_slot_internal(hub: &SharedHub, slot_id: &str) -> Result<(), String> {
    let (slot_cfg, settings, provider_creds, adapters_isp_ip, selected_adapter_res) = {
        let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        guard.adapters = detect_windows_adapters();
        let cfg = guard
            .persisted
            .slots
            .iter()
            .find(|s| s.id == slot_id)
            .cloned()
            .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;
        let settings = guard.persisted.settings.clone();
        let creds = guard.credentials_for_provider(cfg.provider);
        let isp_ip = guard.primary_isp_ipv4();
        let sel = if cfg.mode == SlotMode::AdapterBridge {
            Some(guard.select_adapter_for_slot(&cfg.adapter_hint))
        } else {
            None
        };
        if let Some(rt) = guard.runtimes.get_mut(slot_id) {
            rt.stop_handles();
        }
        (cfg, settings, creds, isp_ip, sel)
    };

    let bind_ip = if settings.allow_lan {
        Ipv4Addr::UNSPECIFIED
    } else {
        Ipv4Addr::LOCALHOST
    };
    let dns_ip = settings
        .wg_dns
        .split(',')
        .next()
        .unwrap_or("162.252.172.57")
        .trim()
        .parse::<Ipv4Addr>()
        .unwrap_or(Ipv4Addr::new(162, 252, 172, 57));

    match slot_cfg.mode {
        SlotMode::AdapterBridge => {
            let adapter = match selected_adapter_res.unwrap() {
                Ok(a) => a,
                Err(kill_msg) => {
                    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
                    guard.runtimes.insert(
                        slot_cfg.id.clone(),
                        ActiveSlotRuntime {
                            proxy_handle: None,
                            wg_handle: None,
                            bound_adapter_name: String::new(),
                            bound_adapter_ip: String::new(),
                            status: SlotRuntimeStatus::KillSwitch,
                            status_detail: kill_msg.clone(),
                            egress: None,
                        },
                    );
                    return Err(kill_msg);
                }
            };

            let adapter_ipv4 = adapter
                .ipv4
                .parse::<Ipv4Addr>()
                .map_err(|_| format!("Invalid adapter IPv4: {}", adapter.ipv4))?;

            let upstream = UpstreamConfig::AdapterBridge {
                adapter_ip: adapter_ipv4,
                if_index: adapter.if_index,
                dns_server: dns_ip,
                primary_isp_ip: adapters_isp_ip,
                kill_switch_enabled: settings.kill_switch_enabled,
                dns_leak_protection: settings.dns_leak_protection,
                ipv6_leak_block: settings.ipv6_leak_block,
            };

            match start_proxy_listener(bind_ip, slot_cfg.port, upstream).await {
                Ok(handle) => {
                    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
                    guard.runtimes.insert(
                        slot_cfg.id.clone(),
                        ActiveSlotRuntime {
                            proxy_handle: Some(handle),
                            wg_handle: None,
                            bound_adapter_name: adapter.name.clone(),
                            bound_adapter_ip: adapter.ipv4.clone(),
                            status: SlotRuntimeStatus::Running,
                            status_detail: format!(
                                "Bound to {} ({}, ifIndex {})",
                                adapter.name, adapter.ipv4, adapter.if_index
                            ),
                            egress: None,
                        },
                    );
                    Ok(())
                }
                Err(err) => {
                    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
                    guard.runtimes.insert(
                        slot_cfg.id.clone(),
                        ActiveSlotRuntime {
                            proxy_handle: None,
                            wg_handle: None,
                            bound_adapter_name: adapter.name,
                            bound_adapter_ip: adapter.ipv4,
                            status: SlotRuntimeStatus::Error,
                            status_detail: err.clone(),
                            egress: None,
                        },
                    );
                    Err(err)
                }
            }
        }
        SlotMode::UserspaceWg => {
            let (prov_key, prov_addr, prov_dns) = provider_creds;
            if prov_key.trim().is_empty() {
                let msg = format!(
                    "Missing {} WireGuard PrivateKey in Providers tab",
                    slot_cfg.provider.display_name()
                );
                let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
                guard.runtimes.insert(
                    slot_cfg.id.clone(),
                    ActiveSlotRuntime {
                        proxy_handle: None,
                        wg_handle: None,
                        bound_adapter_name: "wireproxy".to_string(),
                        bound_adapter_ip: prov_addr,
                        status: SlotRuntimeStatus::Error,
                        status_detail: msg.clone(),
                        egress: None,
                    },
                );
                return Err(msg);
            }

            let mut wg_handle = match spawn_wireproxy_for_slot(
                &slot_cfg.id,
                &settings.wireproxy_path,
                &prov_key,
                &prov_addr,
                &prov_dns,
                &slot_cfg.pub_key,
                &slot_cfg.connection_name,
            )
            .await
            {
                Ok(h) => h,
                Err(err) => {
                    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
                    guard.runtimes.insert(
                        slot_cfg.id.clone(),
                        ActiveSlotRuntime {
                            proxy_handle: None,
                            wg_handle: None,
                            bound_adapter_name: "wireproxy".to_string(),
                            bound_adapter_ip: String::new(),
                            status: SlotRuntimeStatus::Error,
                            status_detail: err.clone(),
                            egress: None,
                        },
                    );
                    return Err(err);
                }
            };

            let upstream = UpstreamConfig::UpstreamSocks5 {
                proxy_addr: wg_handle.internal_addr,
                ipv6_leak_block: settings.ipv6_leak_block,
            };
            match start_proxy_listener(bind_ip, slot_cfg.port, upstream).await {
                Ok(proxy_handle) => {
                    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
                    guard.runtimes.insert(
                        slot_cfg.id.clone(),
                        ActiveSlotRuntime {
                            proxy_handle: Some(proxy_handle),
                            wg_handle: Some(wg_handle),
                            bound_adapter_name: format!("Userspace WG ({})", slot_cfg.country_code),
                            bound_adapter_ip: slot_cfg.connection_name.clone(),
                            status: SlotRuntimeStatus::Running,
                            status_detail: format!(
                                "WireGuard tunnel -> {}:51820",
                                slot_cfg.connection_name
                            ),
                            egress: None,
                        },
                    );
                    Ok(())
                }
                Err(err) => {
                    wg_handle.stop();
                    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
                    guard.runtimes.insert(
                        slot_cfg.id.clone(),
                        ActiveSlotRuntime {
                            proxy_handle: None,
                            wg_handle: None,
                            bound_adapter_name: String::new(),
                            bound_adapter_ip: String::new(),
                            status: SlotRuntimeStatus::Error,
                            status_detail: err.clone(),
                            egress: None,
                        },
                    );
                    Err(err)
                }
            }
        }
    }
}

#[tauri::command]
async fn get_hub_snapshot(state: State<'_, SharedHub>) -> Result<HubSnapshot, String> {
    let guard = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn refresh_system_state(state: State<'_, SharedHub>) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let (adapters, locations, host_ip) = tokio::task::spawn_blocking(|| {
        let adapters = detect_windows_adapters();
        let locations = load_local_catalog();
        let isp_ipv4 = adapters
            .iter()
            .find(|a| a.is_default_route && a.kind == AdapterKind::PrimaryIsp)
            .or_else(|| adapters.iter().find(|a| a.kind == AdapterKind::PrimaryIsp && a.status_up))
            .map(|a| a.ipv4.clone());
        let host_ip = detect_host_isp_ip_with_interface_blocking(isp_ipv4.as_deref());
        (adapters, locations, host_ip)
    })
    .await
    .map_err(|e| format!("Refresh task failed: {e}"))?;

    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    guard.adapters = adapters;
    if !locations.is_empty() {
        guard.locations = locations;
    }
    if host_ip.is_some() {
        guard.host_isp_ip = host_ip;
    }

    // Re-verify active AdapterBridge slots: if Surfshark disconnected, trip kill-switch immediately!
    let slot_configs = guard.persisted.slots.clone();
    for slot in slot_configs {
        if slot.mode == SlotMode::AdapterBridge {
            let is_running = guard
                .runtimes
                .get(&slot.id)
                .is_some_and(|r| r.status == SlotRuntimeStatus::Running);
            if is_running {
                if let Err(kill_reason) = guard.select_adapter_for_slot(&slot.adapter_hint) {
                    if let Some(rt) = guard.runtimes.get_mut(&slot.id) {
                        rt.stop_handles();
                        rt.status = SlotRuntimeStatus::KillSwitch;
                        rt.status_detail = kill_reason;
                    }
                }
            }
        }
    }

    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn save_settings(
    payload: SettingsUpdatePayload,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let mut guard = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    guard.persisted.settings.apply_update(payload)?;
    let (sk, sa, sd) = (
        guard.persisted.settings.wg_private_key.clone(),
        guard.persisted.settings.wg_address.clone(),
        guard.persisted.settings.wg_dns.clone(),
    );
    if let Some(surf) = guard
        .persisted
        .providers
        .iter_mut()
        .find(|p| p.provider == VpnProvider::Surfshark)
    {
        surf.private_key = sk;
        surf.address = sa;
        surf.dns = sd;
    }
    save_state_to_path(&state_file_path(), &guard.persisted)?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn import_wg_conf(
    raw_conf: String,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let parsed = parse_wg_conf(&raw_conf)?;
    let mut guard = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    guard.persisted.settings.wg_private_key = parsed.private_key.clone();
    guard.persisted.settings.wg_address = parsed.address.clone();
    guard.persisted.settings.wg_dns = parsed.dns.clone();
    if let Some(surf) = guard
        .persisted
        .providers
        .iter_mut()
        .find(|p| p.provider == VpnProvider::Surfshark)
    {
        surf.private_key = parsed.private_key;
        surf.address = parsed.address;
        surf.dns = parsed.dns;
    }
    save_state_to_path(&state_file_path(), &guard.persisted)?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn save_provider_config(
    payload: SaveProviderPayload,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let slots_to_restart: Vec<String> = {
        let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        ensure_all_providers(&mut guard.persisted);
        let (clean_addr, clean_dns) =
            validate_provider_network_fields(&payload.address, &payload.dns)?;

        let prov_cfg = guard
            .persisted
            .providers
            .iter_mut()
            .find(|p| p.provider == payload.provider)
            .ok_or_else(|| "Provider not found".to_string())?;

        if let Some(ref pk) = payload.private_key {
            let trimmed = pk.trim();
            if !trimmed.is_empty() && !trimmed.contains('•') {
                validate_wg_key_format(trimmed)?;
                prov_cfg.private_key = trimmed.to_string();
            } else if trimmed.is_empty() {
                prov_cfg.private_key.clear();
            }
        }

        if let Some(ref tok) = payload.api_token {
            let trimmed = tok.trim();
            if !trimmed.contains('•') {
                prov_cfg.api_token = trimmed.to_string();
            }
        }

        prov_cfg.address = clean_addr.clone();
        prov_cfg.dns = clean_dns.clone();
        let updated_pk = prov_cfg.private_key.clone();

        if payload.provider == VpnProvider::Surfshark {
            guard.persisted.settings.wg_private_key = updated_pk;
            guard.persisted.settings.wg_address = clean_addr;
            guard.persisted.settings.wg_dns = clean_dns;
        }

        save_state_to_path(&state_file_path(), &guard.persisted)?;

        guard
            .persisted
            .slots
            .iter()
            .filter_map(|s| {
                let is_running = guard
                    .runtimes
                    .get(&s.id)
                    .is_some_and(|rt| rt.status == SlotRuntimeStatus::Running);
                if is_running && s.mode == SlotMode::UserspaceWg && s.provider == payload.provider {
                    Some(s.id.clone())
                } else {
                    None
                }
            })
            .collect()
    };

    for slot_id in slots_to_restart {
        let _ = start_slot_internal(&hub, &slot_id).await;
    }

    let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn sync_provider_catalog(
    provider: VpnProvider,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let api_token = {
        let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        guard
            .persisted
            .providers
            .iter()
            .find(|p| p.provider == provider)
            .map(|p| p.api_token.clone())
            .unwrap_or_default()
    };

    let (fetched_locs, maybe_fetched_pk) = tokio::task::spawn_blocking(move || match provider {
        VpnProvider::Surfshark => Ok::<_, String>((load_local_catalog(), None)),
        VpnProvider::Nordvpn => {
            let pk = if !api_token.trim().is_empty() {
                Some(fetch_nordvpn_private_key_blocking(&api_token)?)
            } else {
                None
            };
            let locs = fetch_nordvpn_catalog_blocking()?;
            Ok((locs, pk))
        }
        VpnProvider::Mullvad => {
            let locs = fetch_mullvad_catalog_blocking()?;
            Ok((locs, None))
        }
        VpnProvider::Protonvpn | VpnProvider::Custom => Ok((Vec::new(), None)),
    })
    .await
    .map_err(|e| format!("Provider sync task failed: {e}"))??;

    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    if provider == VpnProvider::Surfshark {
        if !fetched_locs.is_empty() {
            guard.locations = fetched_locs;
        }
    } else if !fetched_locs.is_empty() {
        guard.provider_catalogs.insert(provider, fetched_locs);
    }

    if let Some(new_pk) = maybe_fetched_pk {
        if let Some(cfg) = guard
            .persisted
            .providers
            .iter_mut()
            .find(|p| p.provider == provider)
        {
            cfg.private_key = new_pk;
        }
        save_state_to_path(&state_file_path(), &guard.persisted)?;
    }

    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn import_provider_conf(
    provider: VpnProvider,
    raw_conf: String,
    label: String,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let (private_key, address, dns, maybe_loc) =
        parse_and_build_custom_location(provider, &raw_conf, &label)?;
    let mut guard = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    ensure_all_providers(&mut guard.persisted);
    if let Some(cfg) = guard
        .persisted
        .providers
        .iter_mut()
        .find(|p| p.provider == provider)
    {
        cfg.private_key = private_key.clone();
        cfg.address = address.clone();
        cfg.dns = dns.clone();
        if let Some(loc) = maybe_loc {
            if provider != VpnProvider::Surfshark {
                cfg.custom_locations.retain(|l| l.id != loc.id);
                cfg.custom_locations.push(loc);
            }
        }
    }
    if provider == VpnProvider::Surfshark {
        guard.persisted.settings.wg_private_key = private_key;
        guard.persisted.settings.wg_address = address;
        guard.persisted.settings.wg_dns = dns;
    }
    save_state_to_path(&state_file_path(), &guard.persisted)?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn delete_custom_server(
    provider: VpnProvider,
    location_id: String,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let mut guard = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    if let Some(cfg) = guard
        .persisted
        .providers
        .iter_mut()
        .find(|p| p.provider == provider)
    {
        cfg.custom_locations.retain(|l| l.id != location_id);
        save_state_to_path(&state_file_path(), &guard.persisted)?;
    }
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn create_slot(
    payload: CreateSlotPayload,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let new_slot_id = {
        let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        let port = payload.port.unwrap_or_else(|| guard.next_available_port());
        let id = format!("slot-{port}");

        let (provider, loc_id, country_code, loc_label, conn_name, pub_key) =
            if payload.mode == SlotMode::UserspaceWg {
                let target_loc_id = payload.location_id.as_deref().unwrap_or("");
                let all_locs = guard.all_locations();
                let loc = all_locs
                    .into_iter()
                    .find(|l| l.id == target_loc_id || l.connection_name == target_loc_id)
                    .ok_or_else(|| "Selected VPN location not found in catalog".to_string())?;
                (
                    loc.provider,
                    loc.id,
                    loc.country_code.clone(),
                    format!("{} - {}", loc.country, loc.location),
                    loc.connection_name,
                    loc.pub_key,
                )
            } else {
                (
                    VpnProvider::Surfshark,
                    String::new(),
                    "VPN".to_string(),
                    "Active Surfshark Adapter".to_string(),
                    String::new(),
                    String::new(),
                )
            };

        let slot_name = if payload.name.trim().is_empty() {
            if payload.mode == SlotMode::UserspaceWg {
                format!("{country_code} • {loc_label}")
            } else {
                format!("Surfshark Bridge #{port}")
            }
        } else {
            payload.name.trim().to_string()
        };

        let new_slot = ProxySlotConfig {
            id: id.clone(),
            name: slot_name,
            port,
            mode: payload.mode,
            provider,
            location_id: loc_id,
            country_code,
            location_label: loc_label,
            connection_name: conn_name,
            pub_key,
            adapter_hint: payload.adapter_hint.unwrap_or_default().trim().to_string(),
            linked_gologin_profile_id: String::new(),
            linked_gologin_profile_name: String::new(),
            auto_start: payload.auto_start,
        };

        let mut candidate_slots = guard.persisted.slots.clone();
        candidate_slots.push(new_slot);
        validate_slots(&candidate_slots)?;
        guard.persisted.slots = candidate_slots;
        save_state_to_path(&state_file_path(), &guard.persisted)?;
        id
    };

    if payload.auto_start {
        let _ = start_slot_internal(&hub, &new_slot_id).await;
    }

    let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn switch_slot_location(
    slot_id: String,
    location_id: String,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let should_restart = {
        let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        let all_locs = guard.all_locations();
        let new_loc = all_locs
            .into_iter()
            .find(|l| l.id == location_id || l.connection_name == location_id)
            .ok_or_else(|| "Selected replacement VPN server not found".to_string())?;

        let slot = guard
            .persisted
            .slots
            .iter_mut()
            .find(|s| s.id == slot_id)
            .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;

        if slot.mode != SlotMode::UserspaceWg {
            return Err("Only Multi-VPN (Userspace WireGuard) slots can switch servers directly".to_string());
        }

        let old_auto_name = format!("{} • {}", slot.country_code, slot.location_label);
        let new_loc_label = format!("{} - {}", new_loc.country, new_loc.location);
        if slot.name.trim().is_empty() || slot.name == old_auto_name || slot.name.contains(" • ") {
            slot.name = format!("{} • {}", new_loc.country_code, new_loc_label);
        }
        slot.provider = new_loc.provider;
        slot.location_id = new_loc.id;
        slot.country_code = new_loc.country_code;
        slot.location_label = new_loc_label;
        slot.connection_name = new_loc.connection_name;
        slot.pub_key = new_loc.pub_key;

        let was_active = guard.runtimes.get(&slot_id).is_some_and(|rt| {
            matches!(
                rt.status,
                SlotRuntimeStatus::Running
                    | SlotRuntimeStatus::Error
                    | SlotRuntimeStatus::KillSwitch
            )
        });
        if let Some(rt) = guard.runtimes.get_mut(&slot_id) {
            rt.egress = None;
        }
        save_state_to_path(&state_file_path(), &guard.persisted)?;
        was_active
    };

    if should_restart {
        start_slot_internal(&hub, &slot_id).await?;
    }

    let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn toggle_slot(
    slot_id: String,
    start: bool,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    if start {
        start_slot_internal(&hub, &slot_id).await?;
    } else {
        let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        if let Some(rt) = guard.runtimes.get_mut(&slot_id) {
            rt.stop_handles();
            rt.status = SlotRuntimeStatus::Stopped;
            rt.status_detail = "Stopped by user".to_string();
        }
    }
    let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn start_all_slots(state: State<'_, SharedHub>) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let slot_ids: Vec<String> = {
        let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        guard
            .persisted
            .slots
            .iter()
            .filter(|s| {
                guard
                    .runtimes
                    .get(&s.id)
                    .map(|r| r.status != SlotRuntimeStatus::Running)
                    .unwrap_or(true)
            })
            .map(|s| s.id.clone())
            .collect()
    };

    for sid in slot_ids {
        let _ = start_slot_internal(&hub, &sid).await;
    }

    let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn stop_all_slots(state: State<'_, SharedHub>) -> Result<HubSnapshot, String> {
    let mut guard = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    guard.stop_all();
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn delete_slot(
    slot_id: String,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let mut guard = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    if let Some(mut rt) = guard.runtimes.remove(&slot_id) {
        rt.stop_handles();
    }
    guard.persisted.slots.retain(|s| s.id != slot_id);
    save_state_to_path(&state_file_path(), &guard.persisted)?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn check_slot_ip(
    slot_id: String,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let (port, host_isp_ip, isp_ipv4) = {
        let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        let slot = guard
            .persisted
            .slots
            .iter()
            .find(|s| s.id == slot_id)
            .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;
        let is_running = guard
            .runtimes
            .get(&slot_id)
            .is_some_and(|r| r.status == SlotRuntimeStatus::Running);
        if !is_running {
            return Err("Start the proxy slot before checking its exit IP".to_string());
        }
        let isp_ipv4 = guard
            .adapters
            .iter()
            .find(|a| a.is_default_route && a.kind == AdapterKind::PrimaryIsp)
            .or_else(|| {
                guard
                    .adapters
                    .iter()
                    .find(|a| a.kind == AdapterKind::PrimaryIsp && a.status_up)
            })
            .map(|a| a.ipv4.clone());
        (slot.port, guard.host_isp_ip.clone(), isp_ipv4)
    };

    let check_res = tokio::task::spawn_blocking(move || {
        let isp = host_isp_ip
            .or_else(|| detect_host_isp_ip_with_interface_blocking(isp_ipv4.as_deref()));
        let egress = check_slot_egress_blocking(port, isp.as_deref());
        (isp, egress)
    })
    .await
    .map_err(|e| format!("Egress check task failed: {e}"))?;

    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    if check_res.0.is_some() {
        guard.host_isp_ip = check_res.0;
    }
    let isp_guard_enabled = guard.persisted.settings.isp_ip_guard;
    if let Some(rt) = guard.runtimes.get_mut(&slot_id) {
        if check_res.1.leak_status == LeakStatus::LeakBlocked && isp_guard_enabled {
            rt.stop_handles();
            rt.status = SlotRuntimeStatus::KillSwitch;
            rt.status_detail = check_res.1.error_message.clone();
        }
        rt.egress = Some(check_res.1);
    }

    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn set_security_toggle(
    feature: String,
    enabled: bool,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let slots_to_restart: Vec<String> = {
        let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        match feature.as_str() {
            "killSwitchEnabled" => guard.persisted.settings.kill_switch_enabled = enabled,
            "dnsLeakProtection" => guard.persisted.settings.dns_leak_protection = enabled,
            "ipv6LeakBlock" => guard.persisted.settings.ipv6_leak_block = enabled,
            "ispIpGuard" => guard.persisted.settings.isp_ip_guard = enabled,
            "autoVerifyIp" => guard.persisted.settings.auto_verify_ip = enabled,
            "allowLan" => guard.persisted.settings.allow_lan = enabled,
            "resetAll" => {
                guard.persisted.settings.kill_switch_enabled = true;
                guard.persisted.settings.dns_leak_protection = true;
                guard.persisted.settings.ipv6_leak_block = true;
                guard.persisted.settings.isp_ip_guard = true;
                guard.persisted.settings.auto_verify_ip = true;
                guard.persisted.settings.allow_lan = false;
            }
            other => return Err(format!("Unknown security feature '{other}'")),
        }
        save_state_to_path(&state_file_path(), &guard.persisted)?;

        let needs_listener_restart = matches!(
            feature.as_str(),
            "killSwitchEnabled" | "dnsLeakProtection" | "ipv6LeakBlock" | "allowLan" | "resetAll"
        );
        if needs_listener_restart {
            guard
                .runtimes
                .iter()
                .filter_map(|(id, rt)| {
                    if matches!(
                        rt.status,
                        SlotRuntimeStatus::Running | SlotRuntimeStatus::KillSwitch
                    ) {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
                .collect()
        } else {
            Vec::new()
        }
    };

    for slot_id in slots_to_restart {
        let _ = start_slot_internal(&hub, &slot_id).await;
    }

    let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn fetch_gologin_profiles(state: State<'_, SharedHub>) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let token = {
        let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        guard.persisted.settings.gologin_token.clone()
    };
    let profiles = tokio::task::spawn_blocking(move || fetch_gologin_profiles_blocking(&token))
        .await
        .map_err(|e| format!("GoLogin task failed: {e}"))??;

    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    guard.gologin_profiles = profiles;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn assign_slot_to_gologin(
    slot_id: String,
    profile_id: String,
    proxy_mode: String,
    state: State<'_, SharedHub>,
) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let (token, port, profile_name) = {
        let guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
        let slot = guard
            .persisted
            .slots
            .iter()
            .find(|s| s.id == slot_id)
            .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;
        let prof_name = guard
            .gologin_profiles
            .iter()
            .find(|p| p.id == profile_id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| profile_id.clone());
        (
            guard.persisted.settings.gologin_token.clone(),
            slot.port,
            prof_name,
        )
    };

    let pid_clone = profile_id.clone();
    let mode_clone = proxy_mode.clone();
    tokio::task::spawn_blocking(move || {
        update_gologin_profile_proxy_blocking(&token, &pid_clone, &mode_clone, "127.0.0.1", port)
    })
    .await
    .map_err(|e| format!("GoLogin update task failed: {e}"))??;

    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    if let Some(slot) = guard.persisted.slots.iter_mut().find(|s| s.id == slot_id) {
        slot.linked_gologin_profile_id = profile_id.clone();
        slot.linked_gologin_profile_name = profile_name;
    }
    if let Some(prof) = guard
        .gologin_profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
    {
        prof.proxy_mode = proxy_mode;
        prof.proxy_host = "127.0.0.1".to_string();
        prof.proxy_port = port;
    }
    save_state_to_path(&state_file_path(), &guard.persisted)?;
    Ok(guard.build_snapshot())
}

#[tauri::command]
async fn install_wireproxy(state: State<'_, SharedHub>) -> Result<HubSnapshot, String> {
    let hub = Arc::clone(&state);
    let exe_path = tokio::task::spawn_blocking(install_wireproxy_binary)
        .await
        .map_err(|e| format!("Install wireproxy task failed: {e}"))??;

    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    guard.persisted.settings.wireproxy_path = exe_path.to_string_lossy().to_string();
    save_state_to_path(&state_file_path(), &guard.persisted)?;
    Ok(guard.build_snapshot())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &AppHandle, hub: SharedHub) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Open s-proxy Hub", true, None::<&str>)?;
    let stop_all_item = MenuItem::with_id(
        app,
        "stop_all",
        "Stop All Proxy Slots",
        true,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit s-proxy", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &stop_all_item, &sep, &quit_item])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon must exist");

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("s-proxy — Surfshark & GoLogin Proxy Hub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app_handle, event| match event.id().as_ref() {
            "open" => show_main_window(app_handle),
            "stop_all" => {
                if let Ok(mut guard) = hub.lock() {
                    guard.stop_all();
                }
            }
            "quit" => {
                if let Ok(mut guard) = hub.lock() {
                    guard.stop_all();
                }
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn run() {
    let shared_hub: SharedHub = Arc::new(Mutex::new(HubCore::new()));
    let hub_for_setup = Arc::clone(&shared_hub);
    let hub_for_exit = Arc::clone(&shared_hub);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(shared_hub)
        .setup(move |app| {
            let handle = app.handle();
            if let Some(conf) = app.config().app.windows.first() {
                let win =
                    tauri::WebviewWindowBuilder::from_config(handle, conf)?.build()?;
                if let Some(icon) = handle.default_window_icon().cloned() {
                    let _ = win.set_icon(icon);
                }
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("ie4uinit.exe")
                    .arg("-show")
                    .creation_flags(0x08000000)
                    .spawn();
            }
            setup_tray(handle, Arc::clone(&hub_for_setup))?;

            // Server 24/7 Boot Auto-Start & Wireproxy Watchdog Auto-Heal
            let hub_for_daemon = Arc::clone(&hub_for_setup);
            tauri::async_runtime::spawn(async move {
                // 1. On startup, auto-start all slots that have `auto_start = true`
                let auto_ids: Vec<String> = {
                    if let Ok(guard) = hub_for_daemon.lock() {
                        guard
                            .persisted
                            .slots
                            .iter()
                            .filter(|s| s.auto_start)
                            .map(|s| s.id.clone())
                            .collect()
                    } else {
                        Vec::new()
                    }
                };
                for sid in auto_ids {
                    let _ = start_slot_internal(&hub_for_daemon, &sid).await;
                }

                // 2. 24/7 Server Watchdog: every 12 seconds, check if any running wireproxy child exited unexpectedly and auto-heal it
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(12)).await;
                    let crashed_ids: Vec<String> = {
                        if let Ok(mut guard) = hub_for_daemon.lock() {
                            guard
                                .runtimes
                                .iter_mut()
                                .filter_map(|(sid, rt)| {
                                    if rt.status == SlotRuntimeStatus::Running {
                                        if let Some(ref mut wg) = rt.wg_handle {
                                            if !wg.is_alive() {
                                                return Some(sid.clone());
                                            }
                                        }
                                    }
                                    None
                                })
                                .collect()
                        } else {
                            Vec::new()
                        }
                    };
                    for sid in crashed_ids {
                        let _ = start_slot_internal(&hub_for_daemon, &sid).await;
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_hub_snapshot,
            refresh_system_state,
            save_settings,
            set_security_toggle,
            import_wg_conf,
            save_provider_config,
            sync_provider_catalog,
            import_provider_conf,
            delete_custom_server,
            create_slot,
            switch_slot_location,
            toggle_slot,
            start_all_slots,
            stop_all_slots,
            delete_slot,
            check_slot_ip,
            fetch_gologin_profiles,
            assign_slot_to_gologin,
            install_wireproxy
        ])
        .build(tauri::generate_context!())
        .expect("error while building s-proxy tauri application");

    app.run(move |app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            show_main_window(app_handle);
        }
        tauri::RunEvent::Exit => {
            let _ = app_handle;
            if let Ok(mut guard) = hub_for_exit.lock() {
                guard.stop_all();
            }
        }
        _ => {}
    });
}
