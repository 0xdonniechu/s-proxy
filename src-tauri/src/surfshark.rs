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
        .map(|e| SurfsharkLocation {
            id: e.id,
            provider: crate::providers::VpnProvider::Surfshark,
            country: e.country,
            country_code: e.country_code,
            location: e.location,
            region: e.region,
            load: e.load,
            connection_name: e.connection_name,
            pub_key: e.pub_key,
            location_type,
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

    let hardcoded = PathBuf::from(r"C:\ProgramData").join("Surfshark").join(filename);
    if hardcoded != primary {
        if let Ok(content) = std::fs::read_to_string(&hardcoded) {
            return Some(content);
        }
    }

    None
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

    catalog.sort_by(|a, b| {
        a.country
            .cmp(&b.country)
            .then_with(|| a.location.cmp(&b.location))
            .then_with(|| a.load.cmp(&b.load))
    });

    catalog
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
        || ((desc_l.contains("wintun") || desc_l.contains("openvpn"))
            && (ipv4.starts_with("10.8.") || ipv4.starts_with("10.14.")))
    {
        AdapterKind::Surfshark
    } else if name_l == "wt0"
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

#[cfg(not(target_os = "windows"))]
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
                let ord = a
                    .country
                    .cmp(&b.country)
                    .then_with(|| a.location.cmp(&b.location))
                    .then_with(|| a.load.cmp(&b.load));
                assert!(ord != std::cmp::Ordering::Greater, "Catalog must be sorted");
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
}
