pub mod gologin;
pub mod proxy_engine;
pub mod settings;
pub mod surfshark;
pub mod wireguard;

use gologin::{
    check_slot_egress_blocking, detect_host_isp_ip_blocking, fetch_gologin_profiles_blocking,
    update_gologin_profile_proxy_blocking, EgressCheckResult, GoLoginProfileSummary, LeakStatus,
};
use proxy_engine::{start_proxy_listener, RunningProxyHandle, UpstreamConfig};
use serde::{Deserialize, Serialize};
use settings::{
    load_state_from_path, parse_wg_conf, save_state_to_path, state_file_path, validate_slots,
    PersistedState, ProxySlotConfig, SettingsUpdatePayload, SettingsView, SlotMode,
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
    pub location_id: String,
    pub country_code: String,
    pub location_label: String,
    pub connection_name: String,
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
        let adapters = detect_windows_adapters();
        Self {
            persisted,
            adapters,
            locations,
            gologin_profiles: Vec::new(),
            host_isp_ip: None,
            runtimes: HashMap::new(),
        }
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
            if matched.kind == AdapterKind::PrimaryIsp {
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

        // Auto-select Surfshark adapter ONLY (never auto-select NetBird wt0 or PrimaryIsp!)
        let surf = self
            .adapters
            .iter()
            .find(|a| {
                a.kind == AdapterKind::Surfshark
                    && a.status_up
                    && !a.ipv4.is_empty()
                    && !a.ipv4.starts_with("169.254.")
            })
            .ok_or_else(|| {
                "Kill-switch active: Surfshark VPN adapter is currently Disconnected. Connect Surfshark Desktop first (or use Userspace WireGuard mode).".to_string()
            })?;
        Ok(surf.clone())
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

                ProxySlotView {
                    id: cfg.id.clone(),
                    name: cfg.name.clone(),
                    port: cfg.port,
                    listen_host: listen_host.to_string(),
                    socks5_uri: format!("socks5://127.0.0.1:{}", cfg.port),
                    http_uri: format!("http://127.0.0.1:{}", cfg.port),
                    mode: cfg.mode,
                    location_id: cfg.location_id.clone(),
                    country_code: cfg.country_code.clone(),
                    location_label: cfg.location_label.clone(),
                    connection_name: cfg.connection_name.clone(),
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

        HubSnapshot {
            host_isp_ip: self.host_isp_ip.clone(),
            surfshark_adapter: self.active_surfshark_adapter(),
            adapters: self.adapters.clone(),
            slots,
            locations_count: self.locations.len(),
            locations: self.locations.clone(),
            gologin_profiles: self.gologin_profiles.clone(),
            settings: self.persisted.settings.to_view(wireproxy_ready),
        }
    }
}

pub type SharedHub = Arc<Mutex<HubCore>>;

async fn start_slot_internal(hub: &SharedHub, slot_id: &str) -> Result<(), String> {
    let (slot_cfg, settings, adapters_isp_ip, selected_adapter_res) = {
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
        let isp_ip = guard.primary_isp_ipv4();
        let sel = if cfg.mode == SlotMode::AdapterBridge {
            Some(guard.select_adapter_for_slot(&cfg.adapter_hint))
        } else {
            None
        };
        if let Some(rt) = guard.runtimes.get_mut(slot_id) {
            rt.stop_handles();
        }
        (cfg, settings, isp_ip, sel)
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
            if settings.wg_private_key.trim().is_empty() {
                let msg = "Missing Surfshark WireGuard PrivateKey in Settings".to_string();
                let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
                guard.runtimes.insert(
                    slot_cfg.id.clone(),
                    ActiveSlotRuntime {
                        proxy_handle: None,
                        wg_handle: None,
                        bound_adapter_name: "wireproxy".to_string(),
                        bound_adapter_ip: settings.wg_address.clone(),
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
                &settings.wg_private_key,
                &settings.wg_address,
                &settings.wg_dns,
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
        let host_ip = detect_host_isp_ip_blocking();
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
    guard.persisted.settings.wg_private_key = parsed.private_key;
    guard.persisted.settings.wg_address = parsed.address;
    guard.persisted.settings.wg_dns = parsed.dns;
    save_state_to_path(&state_file_path(), &guard.persisted)?;
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

        let (loc_id, country_code, loc_label, conn_name, pub_key) =
            if payload.mode == SlotMode::UserspaceWg {
                let target_loc_id = payload.location_id.as_deref().unwrap_or("");
                let loc = guard
                    .locations
                    .iter()
                    .find(|l| l.id == target_loc_id || l.connection_name == target_loc_id)
                    .ok_or_else(|| "Selected Surfshark location not found in catalog".to_string())?
                    .clone();
                (
                    loc.id,
                    loc.country_code.clone(),
                    format!("{} - {}", loc.country, loc.location),
                    loc.connection_name,
                    loc.pub_key,
                )
            } else {
                (
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
    let (port, host_isp_ip) = {
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
        (slot.port, guard.host_isp_ip.clone())
    };

    let check_res = tokio::task::spawn_blocking(move || {
        let isp = host_isp_ip.or_else(detect_host_isp_ip_blocking);
        let egress = check_slot_egress_blocking(port, isp.as_deref());
        (isp, egress)
    })
    .await
    .map_err(|e| format!("Egress check task failed: {e}"))?;

    let mut guard = hub.lock().map_err(|_| "State lock poisoned".to_string())?;
    if check_res.0.is_some() {
        guard.host_isp_ip = check_res.0;
    }
    if let Some(rt) = guard.runtimes.get_mut(&slot_id) {
        if check_res.1.leak_status == LeakStatus::LeakBlocked {
            rt.stop_handles();
            rt.status = SlotRuntimeStatus::KillSwitch;
            rt.status_detail = check_res.1.error_message.clone();
        }
        rt.egress = Some(check_res.1);
    }

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(shared_hub)
        .setup(move |app| {
            let handle = app.handle();
            if let Some(conf) = app.config().app.windows.first() {
                let win =
                    tauri::WebviewWindowBuilder::from_config(handle, conf)?.build()?;
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }
            setup_tray(handle, Arc::clone(&hub_for_setup))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_hub_snapshot,
            refresh_system_state,
            save_settings,
            import_wg_conf,
            create_slot,
            toggle_slot,
            delete_slot,
            check_slot_ip,
            fetch_gologin_profiles,
            assign_slot_to_gologin,
            install_wireproxy
        ])
        .run(tauri::generate_context!())
        .expect("error while running s-proxy tauri application");
}
