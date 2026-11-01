use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocationType {
    Generic,
    Static,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfsharkLocation {
    pub id: String,
    #[serde(default)]
    pub provider: crate::providers::VpnProvider,
    pub country: String,
    pub country_code: String,
    pub location: String,
    pub region: String,
    pub load: u32,
    pub connection_name: String,
    pub pub_key: String,
    pub location_type: LocationType,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLocationEntry {
    #[serde(default)]
    id: String,
    #[serde(default, rename = "type")]
    entry_type: String,
    #[serde(default)]
    country: String,
    #[serde(default)]
    country_code: String,
    #[serde(default)]
    location: String,
    #[serde(default)]
    region: String,
    #[serde(default)]
    load: u32,
    #[serde(default)]
    connection_name: String,
    #[serde(default)]
    pub_key: String,
}

pub fn parse_locations_json(
    raw: &str,
    location_type: LocationType,
) -> Result<Vec<SurfsharkLocation>, String> {
    let entries: Vec<RawLocationEntry> =
        serde_json::from_str(raw).map_err(|e| e.to_string())?;

    let locations = entries
        .into_iter()
        .filter(|e| !e.connection_name.trim().is_empty() && !e.pub_key.trim().is_empty())
        .map(|e| {
            let loc_type = if e.entry_type.eq_ignore_ascii_case("static") {
                LocationType::Static
            } else if e.entry_type.eq_ignore_ascii_case("generic") {
                LocationType::Generic
            } else {
                location_type
            };
            SurfsharkLocation {
                id: e.id,
                provider: crate::providers::VpnProvider::Surfshark,
                country: e.country,
                country_code: e.country_code,
                location: e.location,
                region: e.region,
                load: e.load,
                connection_name: e.connection_name,
                pub_key: e.pub_key,
                location_type: loc_type,
            }
        })
        .collect();

    Ok(locations)
}

fn read_catalog_file(filename: &str) -> Option<String> {
    let program_data =
        std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    let primary = PathBuf::from(&program_data).join("Surfshark").join(filename);
    if let Ok(content) = std::fs::read_to_string(&primary) {
        return Some(content);
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        let fallback = PathBuf::from(app_data).join("Surfshark").join(filename);
        if let Ok(content) = std::fs::read_to_string(&fallback) {
            return Some(content);
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let mac_fallback = PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Surfshark")
            .join(filename);
        if let Ok(content) = std::fs::read_to_string(&mac_fallback) {
            return Some(content);
        }
    }

    let hardcoded = PathBuf::from(r"C:\ProgramData").join("Surfshark").join(filename);
    if hardcoded != primary {
        if let Ok(content) = std::fs::read_to_string(&hardcoded) {
            return Some(content);
        }
    }

    None
}

/// Returns `(timezone_tier, country_rank)` for curated high-quality countries in the
/// same timezone (`UTC+7`) and adjacent high-bandwidth APAC submarine cable hubs (`UTC+8` / `UTC+9`).
/// Returns `None` for non-priority countries so only high-quality regional nodes are shown.
pub fn priority_country_rank(country_code: &str) -> Option<(u8, u8)> {
    match country_code.trim().to_ascii_uppercase().as_str() {
        // Tier 1: Same Timezone (UTC+7 — Direct SEA Peering)
        "VN" => Some((1, 1)),
        "TH" => Some((1, 2)),
        "ID" => Some((1, 3)),
        "KH" => Some((1, 4)),
        // Tier 2: Adjacent Timezone (UTC+8 — Tier-1 APAC Submarine Cable Hubs)
        "SG" => Some((2, 1)),
        "HK" => Some((2, 2)),
        "TW" => Some((2, 3)),
        "MY" => Some((2, 4)),
        "PH" => Some((2, 5)),
        // Tier 3: East Asia High-Capacity Backbone (UTC+9)
        "JP" => Some((3, 1)),
        "KR" => Some((3, 2)),
        _ => None,
    }
}

pub fn location_sort_key(loc: &SurfsharkLocation) -> (u8, u8, u8, u32, String, String) {
    if loc.region.eq_ignore_ascii_case("Custom") {
        return (
            0,
            0,
            0,
            loc.load,
            loc.location.clone(),
            loc.connection_name.clone(),
        );
    }
    let (tier, country_rank) = priority_country_rank(&loc.country_code).unwrap_or((9, 99));
    let type_rank = match loc.location_type {
        LocationType::Generic => 0,
        LocationType::Static => 1,
    };
    (
        tier,
        type_rank,
        country_rank,
        loc.load,
        loc.location.clone(),
        loc.connection_name.clone(),
    )
}

pub fn curate_and_sort_locations(catalog: Vec<SurfsharkLocation>) -> Vec<SurfsharkLocation> {
    let mut filtered: Vec<SurfsharkLocation> = catalog
        .into_iter()
        .filter(|loc| {
            loc.region.eq_ignore_ascii_case("Custom")
                || priority_country_rank(&loc.country_code).is_some()
        })
        .collect();

    filtered.sort_by_key(location_sort_key);

    let mut counts: std::collections::HashMap<(String, u8), usize> =
        std::collections::HashMap::new();
    let mut curated = Vec::with_capacity(filtered.len());

    for loc in filtered {
        if loc.region.eq_ignore_ascii_case("Custom") {
            curated.push(loc);
            continue;
        }
        let type_tag = match loc.location_type {
            LocationType::Generic => 0,
            LocationType::Static => 1,
        };
        let key = (loc.country_code.to_ascii_uppercase(), type_tag);
        let current_count = counts.entry(key).or_insert(0);
        let max_per_country = match loc.location_type {
            LocationType::Generic => 2,
            LocationType::Static => 3,
        };
        if *current_count >= max_per_country {
            continue;
        }
        if *current_count > 0 && loc.load > 65 {
            continue;
        }
        *current_count += 1;
        curated.push(loc);
    }

    curated
}

pub fn load_local_catalog() -> Vec<SurfsharkLocation> {
    let mut catalog = Vec::new();

    if let Some(raw_generic) = read_catalog_file("general_locations.dat") {
        if let Ok(mut locs) = parse_locations_json(&raw_generic, LocationType::Generic) {
            catalog.append(&mut locs);
        }
    }

    if let Some(raw_static) = read_catalog_file("static_locations.dat") {
        if let Ok(mut locs) = parse_locations_json(&raw_static, LocationType::Static) {
            catalog.append(&mut locs);
        }
    }

    if catalog.is_empty() {
        let mac_clusters_paths = [
            PathBuf::from("/Applications/Surfshark.app/Contents/Resources/clusters.json"),
            std::env::var("HOME")
                .map(|h| {
                    PathBuf::from(h)
                        .join("Applications/Surfshark.app/Contents/Resources/clusters.json")
                })
                .unwrap_or_default(),
        ];
        for path in &mac_clusters_paths {
            if path.as_os_str().is_empty() {
                continue;
            }
            if let Ok(raw_clusters) = std::fs::read_to_string(path) {
                if let Ok(mut locs) = parse_locations_json(&raw_clusters, LocationType::Generic) {
                    if !locs.is_empty() {
                        catalog.append(&mut locs);
                        break;
                    }
                }
            }
        }
    }

    curate_and_sort_locations(catalog)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    Surfshark,
    OtherVpn,
    PrimaryIsp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedAdapter {
    pub name: String,
    pub description: String,
    pub if_index: u32,
    pub ipv4: String,
    pub status_up: bool,
    pub is_default_route: bool,
    pub kind: AdapterKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAdapter {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    if_index: u32,
    #[serde(default)]
    ipv4: String,
    #[serde(default)]
    status_up: bool,
    #[serde(default)]
    is_default_route: bool,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawAdapterPayload {
    Multiple(Vec<RawAdapter>),
    Single(RawAdapter),
}

pub fn is_cgnat_ipv4(ipv4: &str) -> bool {
    match ipv4.trim().parse::<Ipv4Addr>() {
        Ok(ip) => {
            let octets = ip.octets();
            octets[0] == 100 && (64..=127).contains(&octets[1])
        }
        Err(_) => false,
    }
}

pub fn classify_adapter(
    name: &str,
    description: &str,
    ipv4: &str,
    _is_default_route: bool,
) -> AdapterKind {
    let name_l = name.to_ascii_lowercase();
    let desc_l = description.to_ascii_lowercase();

    if name_l.contains("surfshark")
        || desc_l.contains("surfshark")
        || ipv4.starts_with("10.14.")
        || desc_l.contains("openvpn data channel offload")
        || (desc_l.contains("wintun userspace tunnel")
            && name_l != "wt0"
            && !is_cgnat_ipv4(ipv4))
        || ((name_l.starts_with("utun") || desc_l.contains("wintun") || desc_l.contains("openvpn"))
            && (ipv4.starts_with("10.8.") || ipv4.starts_with("10.14.")))
    {
        AdapterKind::Surfshark
    } else if name_l == "wt0"
        || name_l.starts_with("utun")
        || is_cgnat_ipv4(ipv4)
        || desc_l.contains("wireguard")
        || desc_l.contains("wintun")
        || desc_l.contains("netbird")
        || desc_l.contains("tailscale")
        || desc_l.contains("tap-windows")
        || desc_l.contains("openvpn")
        || desc_l.contains("vpn")
    {
        AdapterKind::OtherVpn
    } else {
        AdapterKind::PrimaryIsp
    }
}

pub fn parse_adapters_json(json_str: &str) -> Vec<DetectedAdapter> {
    let clean_str = json_str.trim().trim_start_matches('\u{feff}').trim();
    if clean_str.is_empty() {
        return Vec::new();
    }

    let raw_list: Vec<RawAdapter> = match serde_json::from_str::<RawAdapterPayload>(clean_str) {
        Ok(RawAdapterPayload::Multiple(list)) => list,
        Ok(RawAdapterPayload::Single(item)) => vec![item],
        Err(_) => match serde_json::from_str::<Vec<RawAdapter>>(clean_str) {
            Ok(list) => list,
            Err(_) => return Vec::new(),
        },
    };

    let mut detected = Vec::new();
    for raw in raw_list {
        let ipv4 = raw.ipv4.trim();
        if ipv4.is_empty() || ipv4.starts_with("127.") {
            continue;
        }
        let kind = classify_adapter(&raw.name, &raw.description, ipv4, raw.is_default_route);
        detected.push(DetectedAdapter {
            name: raw.name,
            description: raw.description,
            if_index: raw.if_index,
            ipv4: ipv4.to_string(),
            status_up: raw.status_up,
            is_default_route: raw.is_default_route,
            kind,
        });
    }
    detected
}

pub fn parse_macos_default_route_interfaces(netstat_or_route_out: &str) -> Vec<String> {
    let mut ifaces = Vec::new();
    for raw_line in netstat_or_route_out.lines() {
        let trimmed = raw_line.trim();
        if trimmed.starts_with("default ") || trimmed.starts_with("default\t") {
            let tokens: Vec<&str> = trimmed.split_whitespace().collect();
            if let Some(last) = tokens.last() {
                let iface = last.trim().to_string();
                if !iface.is_empty() && !ifaces.contains(&iface) {
                    ifaces.push(iface);
                }
            }
        } else if let Some(rest) = trimmed.strip_prefix("interface:") {
            if let Some(first) = rest.split_whitespace().next() {
                let iface = first.trim().to_string();
                if !iface.is_empty() && !ifaces.contains(&iface) {
                    ifaces.push(iface);
                }
            }
        }
    }
    ifaces
}

#[derive(Default)]
struct MacosIfaceState {
    name: String,
    if_index: u32,
    has_up: bool,
    has_running: bool,
    is_loopback: bool,
    ipv4: String,
    explicit_status: Option<bool>,
    hw_type: String,
    ne_desc: String,
}

pub fn parse_macos_ifconfig_v(raw: &str, default_ifaces: &[String]) -> Vec<DetectedAdapter> {
    let mut adapters = Vec::new();
    let mut current: Option<MacosIfaceState> = None;

    let finalize = |state: MacosIfaceState, out: &mut Vec<DetectedAdapter>| {
        let ipv4 = state.ipv4.trim();
        if state.is_loopback || ipv4.is_empty() || ipv4.starts_with("127.") {
            return;
        }
        let status_up = state.has_up && state.has_running && state.explicit_status.unwrap_or(true);
        let description = if !state.ne_desc.is_empty() {
            state.ne_desc
        } else if state.name.starts_with("utun") {
            if ipv4.starts_with("10.14.") {
                "Surfshark WireGuard Tunnel (utun)".to_string()
            } else if is_cgnat_ipv4(ipv4) {
                "Userspace Mesh / CGNAT Tunnel (utun)".to_string()
            } else {
                "macOS Tunnel Interface (utun)".to_string()
            }
        } else if !state.hw_type.is_empty() {
            format!("macOS {} ({})", state.hw_type, state.name)
        } else {
            format!("macOS Network Interface ({})", state.name)
        };
        let is_default_route = default_ifaces.iter().any(|d| d == &state.name);
        let kind = classify_adapter(&state.name, &description, ipv4, is_default_route);
        out.push(DetectedAdapter {
            name: state.name,
            description,
            if_index: state.if_index,
            ipv4: ipv4.to_string(),
            status_up,
            is_default_route,
            kind,
        });
    };

    for line in raw.lines() {
        if !line.starts_with(' ') && !line.starts_with('\t') && line.contains(": flags=") {
            if let Some(prev) = current.take() {
                finalize(prev, &mut adapters);
            }
            let name = line.split(':').next().unwrap_or("").trim().to_string();
            let flags_str = if let (Some(start), Some(end)) = (line.find('<'), line.find('>')) {
                if end > start {
                    &line[start + 1..end]
                } else {
                    ""
                }
            } else {
                ""
            };
            let has_up = flags_str.split(',').any(|f| f.trim() == "UP");
            let has_running = flags_str.split(',').any(|f| f.trim() == "RUNNING");
            let is_loopback = flags_str.split(',').any(|f| f.trim() == "LOOPBACK");
            let if_index = if let Some(idx_pos) = line.find("index ") {
                line[idx_pos + "index ".len()..]
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(0)
            } else {
                0
            };

            current = Some(MacosIfaceState {
                name,
                if_index,
                has_up,
                has_running,
                is_loopback,
                ipv4: String::new(),
                explicit_status: None,
                hw_type: String::new(),
                ne_desc: String::new(),
            });
            continue;
        }

        if let Some(ref mut cur) = current {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("inet ") {
                if cur.ipv4.is_empty() {
                    let mut parts = rest.split_whitespace();
                    if let Some(first) = parts.next() {
                        let ip = first.trim();
                        if !ip.is_empty() && !ip.starts_with("127.") {
                            cur.ipv4 = ip.to_string();
                        }
                    }
                }
            } else if let Some(rest) = trimmed.strip_prefix("status:") {
                let val = rest.trim();
                cur.explicit_status = Some(val == "active");
            } else if let Some(rest) = trimmed.strip_prefix("type:") {
                let val = rest.trim();
                if !val.is_empty() {
                    cur.hw_type = val.to_string();
                }
            } else if trimmed.contains("agent domain:NetworkExtension") {
                if let Some(desc_idx) = trimmed.find("desc:\"") {
                    let after_desc = &trimmed[desc_idx + "desc:\"".len()..];
                    if let Some(end_quote) = after_desc.find('"') {
                        let desc = after_desc[..end_quote].trim();
                        if !desc.is_empty() {
                            cur.ne_desc = desc.to_string();
                        }
                    }
                }
            }
        }
    }

    if let Some(last) = current.take() {
        finalize(last, &mut adapters);
    }

    adapters
}

pub fn detect_macos_adapters() -> Vec<DetectedAdapter> {
    let mut default_ifaces = Vec::new();
    if let Ok(out) = std::process::Command::new("/usr/sbin/netstat")
        .args(["-rn", "-f", "inet"])
        .output()
    {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            default_ifaces = parse_macos_default_route_interfaces(&stdout);
        }
    }
    if default_ifaces.is_empty() {
        if let Ok(out) = std::process::Command::new("/sbin/route")
            .args(["-n", "get", "default"])
            .output()
        {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                default_ifaces = parse_macos_default_route_interfaces(&stdout);
            }
        }
    }

    let ifconfig_out = match std::process::Command::new("/sbin/ifconfig")
        .arg("-v")
        .output()
    {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => return Vec::new(),
    };

    parse_macos_ifconfig_v(&ifconfig_out, &default_ifaces)
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
pub fn detect_windows_adapters() -> Vec<DetectedAdapter> {
    use std::os::windows::process::CommandExt;

    let ps_script = r#"$routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric); $defaultIfIndex = if ($routes.Count -gt 0) { $routes[0].InterfaceIndex } else { -1 }; $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue); $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue); $res = @(foreach ($ip in $ips) { $adapter = $adapters | Where-Object { $_.InterfaceIndex -eq $ip.InterfaceIndex } | Select-Object -First 1; $desc = if ($adapter) { $adapter.InterfaceDescription } else { '' }; $alias = if ($adapter) { $adapter.Name } else { $ip.InterfaceAlias }; $up = if ($adapter) { $adapter.Status -eq 'Up' } else { $false }; $isDef = ($ip.InterfaceIndex -eq $defaultIfIndex); [PSCustomObject]@{ name = [string]$alias; description = [string]$desc; ifIndex = [int]$ip.InterfaceIndex; ipv4 = [string]$ip.IPAddress; statusUp = [bool]$up; isDefaultRoute = [bool]$isDef; } }); if (-not $res -or $res.Count -eq 0) { '[]' } else { $json = ConvertTo-Json -InputObject @($res) -Compress; if ($json.StartsWith('[')) { $json } else { '[' + $json + ']' } }"#;

    let output = match std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(out) => out,
        Err(_) => return Vec::new(),
    };

    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_adapters_json(&stdout)
}

#[cfg(target_os = "macos")]
pub fn detect_windows_adapters() -> Vec<DetectedAdapter> {
    detect_macos_adapters()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn detect_windows_adapters() -> Vec<DetectedAdapter> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sample_surfshark_locations_json() {
        let sample = r#"[
            {
                "id": "us-nyc",
                "country": "United States",
                "countryCode": "US",
                "location": "New York",
                "region": "Americas",
                "load": 25,
                "connectionName": "us-nyc.prod.surfshark.com",
                "pubKey": "abcdef123456="
            },
            {
                "id": "empty-conn",
                "country": "Invalid",
                "connectionName": "",
                "pubKey": "some-key"
            },
            {
                "id": "missing-key",
                "country": "Invalid2",
                "connectionName": "server.com",
                "pubKey": "   "
            }
        ]"#;

        let locations = parse_locations_json(sample, LocationType::Generic).expect("should parse");
        assert_eq!(locations.len(), 1);
        let loc = &locations[0];
        assert_eq!(loc.id, "us-nyc");
        assert_eq!(loc.country, "United States");
        assert_eq!(loc.country_code, "US");
        assert_eq!(loc.location, "New York");
        assert_eq!(loc.region, "Americas");
        assert_eq!(loc.load, 25);
        assert_eq!(loc.connection_name, "us-nyc.prod.surfshark.com");
        assert_eq!(loc.pub_key, "abcdef123456=");
        assert_eq!(loc.location_type, LocationType::Generic);
    }

    #[test]
    fn loads_real_surfshark_catalog_if_present() {
        let catalog = load_local_catalog();
        if !catalog.is_empty() {
            for window in catalog.windows(2) {
                let a = &window[0];
                let b = &window[1];
                let ord = location_sort_key(a).cmp(&location_sort_key(b));
                assert!(
                    ord != std::cmp::Ordering::Greater,
                    "Catalog must be sorted by timezone tier & quality"
                );
            }
            for loc in &catalog {
                assert!(
                    priority_country_rank(&loc.country_code).is_some(),
                    "Only curated same/adjacent timezone countries should be included, found {}",
                    loc.country_code
                );
            }
        }
    }

    #[test]
    fn classifies_surfshark_vs_netbird_wt0_vs_wifi() {
        assert_eq!(
            classify_adapter("SurfsharkWireGuard", "WireGuard Tunnel", "10.14.0.2", false),
            AdapterKind::Surfshark
        );
        assert_eq!(
            classify_adapter("Ethernet 2", "Surfshark Virtual Adapter", "192.168.100.2", false),
            AdapterKind::Surfshark
        );
        assert_eq!(
            classify_adapter("CustomInterface", "Unknown Adapter", "10.14.1.5", false),
            AdapterKind::Surfshark
        );
        assert_eq!(
            classify_adapter("Tunnel", "Wintun Userspace Tunnel", "10.8.0.3", false),
            AdapterKind::Surfshark
        );
        assert_eq!(
            classify_adapter("Ethernet 3", "OpenVPN Data Channel Offload", "10.8.0.10", false),
            AdapterKind::Surfshark
        );

        // NetBird wt0 with CGNAT IP, even if is_default_route is true
        assert_eq!(
            classify_adapter("wt0", "NetBird", "100.87.25.169", false),
            AdapterKind::OtherVpn
        );
        assert_eq!(
            classify_adapter("wt0", "NetBird", "100.87.25.169", true),
            AdapterKind::OtherVpn
        );

        assert_eq!(
            classify_adapter("custom-vpn", "Virtual Adapter", "100.80.1.2", false),
            AdapterKind::OtherVpn
        );
        assert_eq!(
            classify_adapter("Tailscale", "Tailscale Tunnel", "100.100.100.100", false),
            AdapterKind::OtherVpn
        );
        assert_eq!(
            classify_adapter("LocalAreaConnection", "TAP-Windows Adapter V9", "10.0.0.5", false),
            AdapterKind::OtherVpn
        );
        assert_eq!(
            classify_adapter("GenericOpenVPN", "OpenVPN TAP-Windows6", "172.16.0.2", false),
            AdapterKind::OtherVpn
        );

        // Primary ISP
        assert_eq!(
            classify_adapter("Wi-Fi", "Intel Wi-Fi 6 AX200", "192.168.1.15", true),
            AdapterKind::PrimaryIsp
        );
        assert_eq!(
            classify_adapter("Ethernet", "Realtek Gaming 2.5GbE", "192.168.1.20", false),
            AdapterKind::PrimaryIsp
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn detects_live_windows_adapters_non_empty() {
        let adapters = detect_windows_adapters();
        assert!(
            !adapters.is_empty(),
            "detect_windows_adapters() returned empty list on Windows host"
        );
    }

    #[test]
    fn test_is_cgnat_ipv4() {
        assert!(is_cgnat_ipv4("100.64.0.1"));
        assert!(is_cgnat_ipv4("100.127.255.254"));
        assert!(!is_cgnat_ipv4("100.63.255.255"));
        assert!(!is_cgnat_ipv4("100.128.0.1"));
        assert!(!is_cgnat_ipv4("192.168.1.1"));
        assert!(!is_cgnat_ipv4("invalid"));
    }

    #[test]
    fn test_parse_adapters_json() {
        let json = r#"[
            {
                "name": "Wi-Fi",
                "description": "Intel Wi-Fi 6 AX200",
                "ifIndex": 12,
                "ipv4": "192.168.1.50",
                "statusUp": true,
                "isDefaultRoute": true
            },
            {
                "name": "Loopback",
                "description": "Software Loopback",
                "ifIndex": 1,
                "ipv4": "127.0.0.1",
                "statusUp": true,
                "isDefaultRoute": false
            }
        ]"#;

        let adapters = parse_adapters_json(json);
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "Wi-Fi");
        assert_eq!(adapters[0].kind, AdapterKind::PrimaryIsp);
    }

    #[test]
    fn parses_locations_json_with_entry_types() {
        let sample = r#"[
            {
                "id": "static-1",
                "country": "Germany",
                "countryCode": "DE",
                "location": "Frankfurt",
                "region": "Europe",
                "load": 10,
                "connectionName": "de-fra-st001.prod.surfshark.com",
                "pubKey": "pubkey1=",
                "type": "static"
            },
            {
                "id": "generic-1",
                "country": "Japan",
                "countryCode": "JP",
                "location": "Tokyo",
                "region": "Asia",
                "load": 20,
                "connectionName": "jp-tok.prod.surfshark.com",
                "pubKey": "pubkey2=",
                "type": "generic"
            },
            {
                "id": "fallback-1",
                "country": "France",
                "countryCode": "FR",
                "location": "Paris",
                "region": "Europe",
                "load": 15,
                "connectionName": "fr-par.prod.surfshark.com",
                "pubKey": "pubkey3="
            }
        ]"#;

        let locs = parse_locations_json(sample, LocationType::Generic).expect("should parse");
        assert_eq!(locs.len(), 3);
        assert_eq!(locs[0].location_type, LocationType::Static);
        assert_eq!(locs[1].location_type, LocationType::Generic);
        assert_eq!(locs[2].location_type, LocationType::Generic);
    }

    #[test]
    fn test_parse_macos_default_route_interfaces() {
        let netstat_sample = "Destination        Gateway            Flags               Netif Expire\n\
                              default            192.168.31.1       UGScg                 en1\n\
                              127.0.0.1          127.0.0.1          UH                    lo0";
        let ifaces = parse_macos_default_route_interfaces(netstat_sample);
        assert_eq!(ifaces, vec!["en1"]);

        let route_sample = "   route to: default\n\
                            destination: default\n\
                                   mask: default\n\
                                gateway: 192.168.1.1\n\
                              interface: en0\n\
                                  flags: <UP,GATEWAY,DONE,STATIC,PRCLONING>";
        let ifaces_route = parse_macos_default_route_interfaces(route_sample);
        assert_eq!(ifaces_route, vec!["en0"]);
    }

    #[test]
    fn test_parse_macos_ifconfig_v() {
        let sample = r#"
lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384 index 1
	inet 127.0.0.1 netmask 0xff000000
	status: active
en1: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500 index 12
	inet 192.168.31.86 netmask 0xffffff00 broadcast 192.168.31.255
	status: active
	type: Wi-Fi
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1500 index 21
	inet 10.14.0.2 --> 10.14.0.2 netmask 0xffffffff
	agent domain:NetworkExtension type:VPN flags:0x4 desc:"VPN: Surfshark. WireGuard®"
utun100: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280 index 22
	inet 100.87.215.217 --> 100.87.215.217 netmask 0xff000000
"#;
        let default_ifaces = vec!["en1".to_string()];
        let adapters = parse_macos_ifconfig_v(sample, &default_ifaces);
        assert_eq!(adapters.len(), 3);

        let en1 = adapters.iter().find(|a| a.name == "en1").expect("en1 found");
        assert_eq!(en1.if_index, 12);
        assert_eq!(en1.ipv4, "192.168.31.86");
        assert!(en1.status_up);
        assert!(en1.is_default_route);
        assert_eq!(en1.description, "macOS Wi-Fi (en1)");
        assert_eq!(en1.kind, AdapterKind::PrimaryIsp);

        let utun4 = adapters.iter().find(|a| a.name == "utun4").expect("utun4 found");
        assert_eq!(utun4.if_index, 21);
        assert_eq!(utun4.ipv4, "10.14.0.2");
        assert!(utun4.status_up);
        assert!(!utun4.is_default_route);
        assert_eq!(utun4.description, "VPN: Surfshark. WireGuard®");
        assert_eq!(utun4.kind, AdapterKind::Surfshark);

        let utun100 = adapters.iter().find(|a| a.name == "utun100").expect("utun100 found");
        assert_eq!(utun100.if_index, 22);
        assert_eq!(utun100.ipv4, "100.87.215.217");
        assert!(utun100.status_up);
        assert!(!utun100.is_default_route);
        assert_eq!(utun100.description, "Userspace Mesh / CGNAT Tunnel (utun)");
        assert_eq!(utun100.kind, AdapterKind::OtherVpn);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn detects_live_macos_adapters_non_empty() {
        let adapters = detect_windows_adapters();
        assert!(
            !adapters.is_empty(),
            "detect_windows_adapters() returned empty list on macOS host"
        );
        if std::path::Path::new("/Applications/Surfshark.app/Contents/Resources/clusters.json")
            .exists()
        {
            let catalog = load_local_catalog();
            assert!(!catalog.is_empty());
            assert_eq!(catalog[0].country_code, "VN");
            assert!(catalog.iter().any(|l| l.country_code == "SG"));
            assert!(catalog
                .iter()
                .any(|l| l.location_type == LocationType::Generic));
            assert!(catalog
                .iter()
                .any(|l| l.location_type == LocationType::Static));
        }
    }
}
