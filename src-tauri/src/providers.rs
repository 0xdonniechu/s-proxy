use crate::settings::{
    app_data_dir, mask_secret, parse_wg_conf, validate_wg_address_cidr, validate_wg_key_format,
};
use crate::surfshark::{LocationType, SurfsharkLocation};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VpnProvider {
    #[default]
    Surfshark,
    Nordvpn,
    Mullvad,
    Protonvpn,
    Custom,
}

impl VpnProvider {
    pub fn id_str(self) -> &'static str {
        match self {
            Self::Surfshark => "surfshark",
            Self::Nordvpn => "nordvpn",
            Self::Mullvad => "mullvad",
            Self::Protonvpn => "protonvpn",
            Self::Custom => "custom",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Surfshark => "Surfshark",
            Self::Nordvpn => "NordVPN (NordLynx)",
            Self::Mullvad => "Mullvad VPN",
            Self::Protonvpn => "ProtonVPN",
            Self::Custom => "Custom WireGuard",
        }
    }

    pub fn default_address(self) -> &'static str {
        match self {
            Self::Surfshark => "10.14.0.2/16",
            Self::Nordvpn => "10.5.0.2/16",
            Self::Mullvad => "10.64.0.1/32",
            Self::Protonvpn => "10.2.0.2/32",
            Self::Custom => "10.8.0.2/24",
        }
    }

    pub fn default_dns(self) -> &'static str {
        match self {
            Self::Surfshark => "162.252.172.57",
            Self::Nordvpn => "103.86.96.100",
            Self::Mullvad => "10.64.0.1",
            Self::Protonvpn => "10.2.0.1",
            Self::Custom => "1.1.1.1",
        }
    }

    pub fn all() -> [VpnProvider; 5] {
        [
            Self::Surfshark,
            Self::Nordvpn,
            Self::Mullvad,
            Self::Protonvpn,
            Self::Custom,
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: VpnProvider,
    pub private_key: String,
    pub address: String,
    pub dns: String,
    pub api_token: String,
    pub custom_locations: Vec<SurfsharkLocation>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self::for_provider(VpnProvider::Surfshark)
    }
}

impl ProviderConfig {
    pub fn for_provider(provider: VpnProvider) -> Self {
        Self {
            provider,
            private_key: String::new(),
            address: provider.default_address().to_string(),
            dns: provider.default_dns().to_string(),
            api_token: String::new(),
            custom_locations: Vec::new(),
        }
    }

    pub fn to_view(&self, server_count: usize) -> ProviderView {
        let has_pk = !self.private_key.trim().is_empty();
        ProviderView {
            provider: self.provider,
            display_name: self.provider.display_name().to_string(),
            has_private_key: has_pk,
            private_key_masked: mask_secret(&self.private_key),
            address: self.address.clone(),
            dns: self.dns.clone(),
            has_api_token: !self.api_token.trim().is_empty(),
            api_token_masked: mask_secret(&self.api_token),
            server_count,
            is_ready: has_pk && server_count > 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub provider: VpnProvider,
    pub display_name: String,
    pub has_private_key: bool,
    pub private_key_masked: String,
    pub address: String,
    pub dns: String,
    pub has_api_token: bool,
    pub api_token_masked: String,
    pub server_count: usize,
    pub is_ready: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProviderPayload {
    pub provider: VpnProvider,
    pub private_key: Option<String>,
    pub address: String,
    pub dns: String,
    pub api_token: Option<String>,
}

fn provider_cache_dir() -> PathBuf {
    app_data_dir().join("providers")
}

fn provider_cache_file(provider: VpnProvider) -> PathBuf {
    provider_cache_dir().join(format!("{}_locations.json", provider.id_str()))
}

pub fn load_cached_provider_locations(provider: VpnProvider) -> Vec<SurfsharkLocation> {
    let path = provider_cache_file(provider);
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<SurfsharkLocation>>(&raw).unwrap_or_default()
}

pub fn save_cached_provider_locations(
    provider: VpnProvider,
    locations: &[SurfsharkLocation],
) -> Result<(), String> {
    let dir = provider_cache_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create provider cache dir: {e}"))?;
    let path = provider_cache_file(provider);
    let json = serde_json::to_string_pretty(locations)
        .map_err(|e| format!("Failed to serialize provider catalog: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write provider catalog: {e}"))?;
    Ok(())
}

pub fn validate_provider_network_fields(address: &str, dns: &str) -> Result<(String, String), String> {
    let validated_addr = validate_wg_address_cidr(address)?;

    let dns_trimmed = dns.trim();
    let first_dns = dns_trimmed.split(',').next().unwrap_or("").trim();
    if first_dns.parse::<Ipv4Addr>().is_err() {
        return Err(format!("Invalid tunnel DNS IPv4 address: {dns_trimmed}"));
    }

    Ok((validated_addr, first_dns.to_string()))
}

fn run_curl_get(url: &str, basic_auth: Option<&str>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let curl_bin = r"C:\Windows\System32\curl.exe";
    #[cfg(not(target_os = "windows"))]
    let curl_bin = "/usr/bin/curl";

    let mut cmd = Command::new(curl_bin);
    cmd.args([
        "-sS",
        "-fL",
        "--max-time",
        "25",
        "-H",
        "Accept: application/json",
    ]);
    if basic_auth.is_some() {
        cmd.args(["-K", "-"]).stdin(Stdio::piped());
    }
    cmd.arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn curl: {e}"))?;
    if let Some(auth) = basic_auth {
        let safe_auth: String = auth
            .chars()
            .filter(|c| !matches!(c, '\r' | '\n' | '"'))
            .collect();
        let config_line = format!("user = \"{safe_auth}\"\n");
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(config_line.as_bytes())
                .map_err(|e| format!("Failed to pass auth config to curl: {e}"))?;
        }
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("Failed to execute curl: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("HTTP request failed with status {}", out.status)
        } else {
            format!("HTTP request failed: {stderr}")
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// --- NordVPN API Parser & Sync ---

#[derive(Debug, Deserialize)]
struct NordCredentialsResponse {
    #[serde(default)]
    nordlynx_private_key: String,
}

#[derive(Debug, Deserialize)]
struct NordServerEntry {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    station: String,
    #[serde(default)]
    load: u32,
    #[serde(default)]
    locations: Vec<NordLocationWrapper>,
    #[serde(default)]
    technologies: Vec<NordTechnology>,
}

#[derive(Debug, Deserialize)]
struct NordLocationWrapper {
    #[serde(default)]
    country: NordCountry,
}

#[derive(Debug, Default, Deserialize)]
struct NordCountry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    city: NordCity,
}

#[derive(Debug, Default, Deserialize)]
struct NordCity {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct NordTechnology {
    #[serde(default)]
    identifier: String,
    #[serde(default)]
    metadata: Vec<NordMetadata>,
}

#[derive(Debug, Deserialize)]
struct NordMetadata {
    #[serde(default)]
    name: String,
    #[serde(default)]
    value: String,
}

pub fn parse_nordvpn_servers_json(raw: &str) -> Result<Vec<SurfsharkLocation>, String> {
    let entries: Vec<NordServerEntry> =
        serde_json::from_str(raw).map_err(|e| format!("Invalid NordVPN JSON: {e}"))?;
    let mut locations = Vec::new();

    for entry in entries {
        let wg_tech = entry
            .technologies
            .iter()
            .find(|t| t.identifier == "wireguard_udp");
        let Some(tech) = wg_tech else { continue };
        let pub_key = tech
            .metadata
            .iter()
            .find(|m| m.name == "public_key")
            .map(|m| m.value.trim().to_string())
            .unwrap_or_default();
        if validate_wg_key_format(&pub_key).is_err() {
            continue;
        }

        let conn_host = if !entry.hostname.trim().is_empty() {
            entry.hostname.trim().to_string()
        } else {
            entry.station.trim().to_string()
        };
        if conn_host.is_empty() {
            continue;
        }

        let (country, country_code, city) = entry
            .locations
            .first()
            .map(|l| {
                (
                    if l.country.name.is_empty() {
                        "NordVPN".to_string()
                    } else {
                        l.country.name.clone()
                    },
                    if l.country.code.is_empty() {
                        "UN".to_string()
                    } else {
                        l.country.code.to_uppercase()
                    },
                    if l.country.city.name.is_empty() {
                        entry.name.clone()
                    } else {
                        l.country.city.name.clone()
                    },
                )
            })
            .unwrap_or_else(|| ("NordVPN".to_string(), "UN".to_string(), entry.name.clone()));

        locations.push(SurfsharkLocation {
            id: format!("nordvpn-{}", entry.id),
            provider: VpnProvider::Nordvpn,
            country,
            country_code,
            location: city,
            region: "Global".to_string(),
            load: entry.load,
            connection_name: conn_host,
            pub_key,
            location_type: LocationType::Generic,
        });
    }

    locations.sort_by(|a, b| {
        a.country
            .cmp(&b.country)
            .then_with(|| a.location.cmp(&b.location))
            .then_with(|| a.load.cmp(&b.load))
    });

    Ok(locations)
}

pub fn fetch_nordvpn_private_key_blocking(access_token: &str) -> Result<String, String> {
    let token = access_token.trim();
    if token.is_empty() {
        return Err("NordVPN Access Token is empty".to_string());
    }
    if token.chars().any(|c| c.is_control() || c == ':' || c == ' ') {
        return Err("NordVPN Access Token contains invalid characters".to_string());
    }
    let auth = format!("token:{token}");
    let body = run_curl_get(
        "https://api.nordvpn.com/v1/users/services/credentials",
        Some(&auth),
    )?;
    let parsed: NordCredentialsResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse NordVPN credentials response: {e}"))?;
    validate_wg_key_format(&parsed.nordlynx_private_key)?;
    Ok(parsed.nordlynx_private_key.trim().to_string())
}

pub fn fetch_nordvpn_catalog_blocking() -> Result<Vec<SurfsharkLocation>, String> {
    let url = "https://api.nordvpn.com/v1/servers?limit=300&filters%5Bservers_technologies%5D%5Bidentifier%5D=wireguard_udp";
    let body = run_curl_get(url, None)?;
    let locs = parse_nordvpn_servers_json(&body)?;
    if locs.is_empty() {
        return Err("NordVPN returned 0 WireGuard servers".to_string());
    }
    save_cached_provider_locations(VpnProvider::Nordvpn, &locs)?;
    Ok(locs)
}

// --- Mullvad API Parser & Sync ---

#[derive(Debug, Deserialize)]
struct MullvadRelayResponse {
    #[serde(default)]
    countries: Vec<MullvadCountry>,
}

#[derive(Debug, Deserialize)]
struct MullvadCountry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    cities: Vec<MullvadCity>,
}

#[derive(Debug, Deserialize)]
struct MullvadCity {
    #[serde(default)]
    name: String,
    #[serde(default)]
    relays: Vec<MullvadRelay>,
}

#[derive(Debug, Deserialize)]
struct MullvadRelay {
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    ipv4_addr_in: String,
    #[serde(default)]
    public_key: String,
    #[serde(default = "default_true")]
    active: bool,
}

fn default_true() -> bool {
    true
}

pub fn parse_mullvad_relays_json(raw: &str) -> Result<Vec<SurfsharkLocation>, String> {
    if let Ok(wrapped) = serde_json::from_str::<MullvadRelayResponse>(raw) {
        if !wrapped.countries.is_empty() {
            let mut locations = Vec::new();
            for country in wrapped.countries {
                for city in country.cities {
                    for relay in city.relays {
                        if !relay.active || validate_wg_key_format(&relay.public_key).is_err() {
                            continue;
                        }
                        let conn = if !relay.ipv4_addr_in.trim().is_empty() {
                            relay.ipv4_addr_in.trim().to_string()
                        } else {
                            relay.hostname.trim().to_string()
                        };
                        if conn.is_empty() {
                            continue;
                        }
                        locations.push(SurfsharkLocation {
                            id: format!("mullvad-{}", relay.hostname),
                            provider: VpnProvider::Mullvad,
                            country: country.name.clone(),
                            country_code: country.code.to_uppercase(),
                            location: format!("{} ({})", city.name, relay.hostname),
                            region: "Global".to_string(),
                            load: 15,
                            connection_name: conn,
                            pub_key: relay.public_key.trim().to_string(),
                            location_type: LocationType::Generic,
                        });
                    }
                }
            }
            if !locations.is_empty() {
                return Ok(locations);
            }
        }
    }

    // Also support flat relay array format from api.mullvad.net/www/relays/wireguard/
    #[derive(Debug, Deserialize)]
    struct FlatMullvadRelay {
        #[serde(default)]
        hostname: String,
        #[serde(default)]
        country_name: String,
        #[serde(default)]
        country_code: String,
        #[serde(default)]
        city_name: String,
        #[serde(default)]
        ipv4_addr_in: String,
        #[serde(default)]
        pubkey: String,
        #[serde(default = "default_true")]
        active: bool,
    }

    let flat_list: Vec<FlatMullvadRelay> =
        serde_json::from_str(raw).map_err(|e| format!("Invalid Mullvad JSON: {e}"))?;
    let mut locations = Vec::new();
    for relay in flat_list {
        if !relay.active || validate_wg_key_format(&relay.pubkey).is_err() {
            continue;
        }
        let conn = if !relay.ipv4_addr_in.trim().is_empty() {
            relay.ipv4_addr_in.trim().to_string()
        } else {
            relay.hostname.trim().to_string()
        };
        if conn.is_empty() {
            continue;
        }
        locations.push(SurfsharkLocation {
            id: format!("mullvad-{}", relay.hostname),
            provider: VpnProvider::Mullvad,
            country: relay.country_name,
            country_code: relay.country_code.to_uppercase(),
            location: format!("{} ({})", relay.city_name, relay.hostname),
            region: "Global".to_string(),
            load: 15,
            connection_name: conn,
            pub_key: relay.pubkey.trim().to_string(),
            location_type: LocationType::Generic,
        });
    }

    locations.sort_by(|a, b| {
        a.country
            .cmp(&b.country)
            .then_with(|| a.location.cmp(&b.location))
    });
    Ok(locations)
}

pub fn fetch_mullvad_catalog_blocking() -> Result<Vec<SurfsharkLocation>, String> {
    let body = run_curl_get("https://api.mullvad.net/www/relays/wireguard/", None)?;
    let locs = parse_mullvad_relays_json(&body)?;
    if locs.is_empty() {
        return Err("Mullvad API returned 0 WireGuard relays".to_string());
    }
    save_cached_provider_locations(VpnProvider::Mullvad, &locs)?;
    Ok(locs)
}

pub fn parse_and_build_custom_location(
    provider: VpnProvider,
    raw_conf: &str,
    label_hint: &str,
) -> Result<(String, String, String, Option<SurfsharkLocation>), String> {
    let parsed = parse_wg_conf(raw_conf)?;
    let maybe_loc = match (parsed.public_key, parsed.endpoint_host) {
        (Some(pub_key), Some(endpoint)) => {
            let clean_label = if label_hint.trim().is_empty() {
                endpoint.clone()
            } else {
                label_hint.trim().to_string()
            };
            let slug: String = endpoint
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
                .collect();
            Some(SurfsharkLocation {
                id: format!("{}-{}", provider.id_str(), slug),
                provider,
                country: provider.display_name().to_string(),
                country_code: match provider {
                    VpnProvider::Surfshark => "SS",
                    VpnProvider::Nordvpn => "NV",
                    VpnProvider::Mullvad => "MV",
                    VpnProvider::Protonvpn => "PV",
                    VpnProvider::Custom => "WG",
                }
                .to_string(),
                location: clean_label,
                region: "Custom".to_string(),
                load: 10,
                connection_name: endpoint,
                pub_key,
                location_type: LocationType::Generic,
            })
        }
        _ => None,
    };

    Ok((parsed.private_key, parsed.address, parsed.dns, maybe_loc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nordvpn_sample_servers_json() {
        let sample = r#"[
            {
                "id": 991,
                "name": "United States #991",
                "hostname": "us991.nordvpn.com",
                "station": "198.51.100.12",
                "load": 14,
                "locations": [
                    {
                        "country": {
                            "name": "United States",
                            "code": "US",
                            "city": { "name": "Los Angeles" }
                        }
                    }
                ],
                "technologies": [
                    {
                        "identifier": "wireguard_udp",
                        "metadata": [
                            {
                                "name": "public_key",
                                "value": "l8EOWPyzt/njrb74CADY4VOhns/TbUN6KFTbytHcFQw="
                            }
                        ]
                    }
                ]
            }
        ]"#;
        let locs = parse_nordvpn_servers_json(sample).expect("should parse nordvpn servers");
        assert_eq!(locs.len(), 1);
        assert_eq!(locs[0].provider, VpnProvider::Nordvpn);
        assert_eq!(locs[0].country_code, "US");
        assert_eq!(locs[0].location, "Los Angeles");
        assert_eq!(locs[0].connection_name, "us991.nordvpn.com");
    }

    #[test]
    fn parses_mullvad_flat_relays_json() {
        let sample = r#"[
            {
                "hostname": "se-got-wg-001",
                "country_name": "Sweden",
                "country_code": "se",
                "city_name": "Gothenburg",
                "ipv4_addr_in": "185.213.154.66",
                "pubkey": "l8EOWPyzt/njrb74CADY4VOhns/TbUN6KFTbytHcFQw=",
                "active": true
            }
        ]"#;
        let locs = parse_mullvad_relays_json(sample).expect("should parse mullvad relays");
        assert_eq!(locs.len(), 1);
        assert_eq!(locs[0].provider, VpnProvider::Mullvad);
        assert_eq!(locs[0].country_code, "SE");
        assert_eq!(locs[0].connection_name, "185.213.154.66");
    }

    #[test]
    fn parses_custom_wireguard_conf_and_builds_location() {
        let conf = concat!(
            "[Interface]\n",
            "Address = 10.64.0.1/32\n",
            "Private",
            "Key = YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=\n",
            "DNS = 10.64.0.1\n\n",
            "[Peer]\n",
            "PublicKey = l8EOWPyzt/njrb74CADY4VOhns/TbUN6KFTbytHcFQw=\n",
            "Endpoint = 185.213.154.66:51820\n",
            "AllowedIPs = 0.0.0.0/0\n"
        );
        let (pk, addr, dns, maybe_loc) =
            parse_and_build_custom_location(VpnProvider::Custom, conf, "Sweden Custom Node")
                .expect("should parse custom conf");
        assert_eq!(pk, "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=");
        assert_eq!(addr, "10.64.0.1/32");
        assert_eq!(dns, "10.64.0.1");
        let loc = maybe_loc.expect("should produce location entry");
        assert_eq!(loc.provider, VpnProvider::Custom);
        assert_eq!(loc.country_code, "WG");
        assert_eq!(loc.location, "Sweden Custom Node");
        assert_eq!(loc.connection_name, "185.213.154.66");
        assert_eq!(loc.pub_key, "l8EOWPyzt/njrb74CADY4VOhns/TbUN6KFTbytHcFQw=");
    }
}
