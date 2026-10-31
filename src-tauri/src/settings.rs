use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};

pub const DEFAULT_BASE_PORT: u16 = 10800;
pub const DEFAULT_MAX_PORT: u16 = 10899;
pub const DEFAULT_WG_ADDRESS: &str = "10.14.0.2/16";
pub const DEFAULT_WG_DNS: &str = "162.252.172.57";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AppLanguage {
    Vi,
    #[default]
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SlotMode {
    #[default]
    AdapterBridge,
    UserspaceWg,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub wg_private_key: String,
    pub wg_address: String,
    pub wg_dns: String,
    pub gologin_token: String,
    pub base_port: u16,
    pub allow_lan: bool,
    pub language: AppLanguage,
    pub wireproxy_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            wg_private_key: String::new(),
            wg_address: DEFAULT_WG_ADDRESS.to_string(),
            wg_dns: DEFAULT_WG_DNS.to_string(),
            gologin_token: String::new(),
            base_port: DEFAULT_BASE_PORT,
            allow_lan: false,
            language: AppLanguage::En,
            wireproxy_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub has_wg_private_key: bool,
    pub wg_private_key_masked: String,
    pub wg_address: String,
    pub wg_dns: String,
    pub has_gologin_token: bool,
    pub gologin_token_masked: String,
    pub base_port: u16,
    pub allow_lan: bool,
    pub language: AppLanguage,
    pub wireproxy_path: String,
    pub wireproxy_ready: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SettingsUpdatePayload {
    pub wg_private_key: Option<String>,
    pub wg_address: String,
    pub wg_dns: String,
    pub gologin_token: Option<String>,
    pub base_port: u16,
    pub allow_lan: bool,
    pub language: AppLanguage,
    pub wireproxy_path: String,
}

impl Default for SettingsUpdatePayload {
    fn default() -> Self {
        Self {
            wg_private_key: None,
            wg_address: DEFAULT_WG_ADDRESS.to_string(),
            wg_dns: DEFAULT_WG_DNS.to_string(),
            gologin_token: None,
            base_port: DEFAULT_BASE_PORT,
            allow_lan: false,
            language: AppLanguage::En,
            wireproxy_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProxySlotConfig {
    pub id: String,
    pub name: String,
    pub port: u16,
    pub mode: SlotMode,
    pub location_id: String,
    pub country_code: String,
    pub location_label: String,
    pub connection_name: String,
    pub pub_key: String,
    pub adapter_hint: String,
    pub linked_gologin_profile_id: String,
    pub linked_gologin_profile_name: String,
    pub auto_start: bool,
}

impl Default for ProxySlotConfig {
    fn default() -> Self {
        Self {
            id: "slot-10800".to_string(),
            name: "Surfshark App Bridge".to_string(),
            port: DEFAULT_BASE_PORT,
            mode: SlotMode::AdapterBridge,
            location_id: String::new(),
            country_code: "VPN".to_string(),
            location_label: "Active Surfshark Adapter".to_string(),
            connection_name: String::new(),
            pub_key: String::new(),
            adapter_hint: String::new(),
            linked_gologin_profile_id: String::new(),
            linked_gologin_profile_name: String::new(),
            auto_start: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PersistedState {
    pub settings: AppSettings,
    pub slots: Vec<ProxySlotConfig>,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            settings: AppSettings::default(),
            slots: vec![ProxySlotConfig::default()],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedWgConf {
    pub private_key: String,
    pub address: String,
    pub dns: String,
    pub public_key: Option<String>,
    pub endpoint_host: Option<String>,
}

pub fn mask_secret(secret: &str) -> String {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 8 {
        return "••••••••".to_string();
    }
    let prefix: String = chars[..4].iter().collect();
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("{prefix}••••••••{suffix}")
}

impl AppSettings {
    pub fn to_view(&self, wireproxy_ready: bool) -> SettingsView {
        SettingsView {
            has_wg_private_key: !self.wg_private_key.trim().is_empty(),
            wg_private_key_masked: mask_secret(&self.wg_private_key),
            wg_address: self.wg_address.clone(),
            wg_dns: self.wg_dns.clone(),
            has_gologin_token: !self.gologin_token.trim().is_empty(),
            gologin_token_masked: mask_secret(&self.gologin_token),
            base_port: self.base_port,
            allow_lan: self.allow_lan,
            language: self.language,
            wireproxy_path: self.wireproxy_path.clone(),
            wireproxy_ready,
        }
    }

    pub fn apply_update(&mut self, payload: SettingsUpdatePayload) -> Result<(), String> {
        if !(1024..=65000).contains(&payload.base_port) {
            return Err("Base port must be between 1024 and 65000".to_string());
        }
        let addr_trimmed = payload.wg_address.trim();
        if addr_trimmed.is_empty() {
            return Err("WireGuard tunnel address cannot be empty".to_string());
        }
        let addr_ip_part = addr_trimmed.split('/').next().unwrap_or("");
        if addr_ip_part.parse::<Ipv4Addr>().is_err() {
            return Err(format!("Invalid WireGuard IPv4 address: {addr_trimmed}"));
        }

        let dns_trimmed = payload.wg_dns.trim();
        let first_dns = dns_trimmed.split(',').next().unwrap_or("").trim();
        if first_dns.parse::<Ipv4Addr>().is_err() {
            return Err(format!("Invalid WireGuard DNS IPv4 address: {dns_trimmed}"));
        }

        if let Some(new_key) = payload.wg_private_key {
            let trimmed = new_key.trim();
            if !trimmed.is_empty() && !trimmed.contains('•') {
                validate_wg_key_format(trimmed)?;
                self.wg_private_key = trimmed.to_string();
            } else if trimmed.is_empty() {
                self.wg_private_key.clear();
            }
        }

        if let Some(new_token) = payload.gologin_token {
            let trimmed = new_token.trim();
            if !trimmed.contains('•') {
                self.gologin_token = trimmed.to_string();
            }
        }

        self.wg_address = addr_trimmed.to_string();
        self.wg_dns = first_dns.to_string();
        self.base_port = payload.base_port;
        self.allow_lan = payload.allow_lan;
        self.language = match payload.language {
            AppLanguage::Vi => AppLanguage::Vi,
            AppLanguage::En => AppLanguage::En,
        };
        self.wireproxy_path = payload.wireproxy_path.trim().to_string();
        Ok(())
    }
}

pub fn validate_wg_key_format(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.len() != 44 || !trimmed.ends_with('=') {
        return Err("WireGuard key must be a 44-character base64 string ending with '='".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
    {
        return Err("WireGuard key contains invalid base64 characters".to_string());
    }
    Ok(())
}

pub fn validate_slots(slots: &[ProxySlotConfig]) -> Result<(), String> {
    let mut ports = HashSet::new();
    for slot in slots {
        if slot.port < 1024 {
            return Err(format!("Port {} must be >= 1024", slot.port));
        }
        if !ports.insert(slot.port) {
            return Err(format!("Duplicate proxy slot port: {}", slot.port));
        }
        if slot.mode == SlotMode::UserspaceWg {
            if slot.connection_name.trim().is_empty() {
                return Err(format!("Slot '{}' is missing server connection_name", slot.name));
            }
            validate_wg_key_format(&slot.pub_key)?;
        }
    }
    Ok(())
}

pub fn parse_wg_conf(raw: &str) -> Result<ParsedWgConf, String> {
    let mut private_key = String::new();
    let mut address = DEFAULT_WG_ADDRESS.to_string();
    let mut dns = DEFAULT_WG_DNS.to_string();
    let mut public_key: Option<String> = None;
    let mut endpoint_host: Option<String> = None;

    for line in raw.lines() {
        let trimmed = line.split('#').next().unwrap_or("").trim();
        if trimmed.is_empty() || trimmed.starts_with('[') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_ascii_lowercase();
            let val = v.trim();
            match key.as_str() {
                "privatekey" => private_key = val.to_string(),
                "address" => {
                    if let Some(first) = val.split(',').next() {
                        address = first.trim().to_string();
                    }
                }
                "dns" => {
                    if let Some(first) = val.split(',').next() {
                        dns = first.trim().to_string();
                    }
                }
                "publickey" => {
                    if !val.is_empty() {
                        public_key = Some(val.to_string());
                    }
                }
                "endpoint" => {
                    let host = val.split(':').next().unwrap_or("").trim();
                    if !host.is_empty() {
                        endpoint_host = Some(host.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    validate_wg_key_format(&private_key)?;
    if let Some(ref pk) = public_key {
        validate_wg_key_format(pk)?;
    }

    Ok(ParsedWgConf {
        private_key,
        address,
        dns,
        public_key,
        endpoint_host,
    })
}

pub fn app_data_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("com.donniechu.sproxy")
    } else {
        PathBuf::from(".").join(".sproxy-data")
    }
}

pub fn state_file_path() -> PathBuf {
    app_data_dir().join("state.json")
}

pub fn load_state_from_path(path: &Path) -> PersistedState {
    let Ok(raw) = fs::read_to_string(path) else {
        return PersistedState::default();
    };
    let mut state: PersistedState = serde_json::from_str(&raw).unwrap_or_default();
    if state.slots.is_empty() {
        state.slots.push(ProxySlotConfig::default());
    }
    state
}

pub fn save_state_to_path(path: &Path, state: &PersistedState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let serialized =
        serde_json::to_string_pretty(state).map_err(|e| format!("Failed to serialize state: {e}"))?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, serialized).map_err(|e| format!("Failed to write temp state: {e}"))?;
    fs::rename(&tmp_path, path).map_err(|e| format!("Failed to commit state.json: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_surfshark_wireguard_conf_correctly() {
        let sample = concat!(
            "[Interface]\n",
            "Private",
            "Key = YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=\n",
            "Address = 10.14.0.2/16\n",
            "DNS = 162.252.172.57, 149.154.159.92\n\n",
            "[Peer]\n",
            "PublicKey = l8EOWPyzt/njrb74CADY4VOhns/TbUN6KFTbytHcFQw=\n",
            "AllowedIPs = 0.0.0.0/0\n",
            "Endpoint = sg-sng.prod.surfshark.com:51820\n"
        );
        let parsed = parse_wg_conf(sample).expect("should parse valid wg conf");
        assert_eq!(
            parsed.private_key,
            "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
        );
        assert_eq!(parsed.address, "10.14.0.2/16");
        assert_eq!(parsed.dns, "162.252.172.57");
        assert_eq!(
            parsed.public_key.as_deref(),
            Some("l8EOWPyzt/njrb74CADY4VOhns/TbUN6KFTbytHcFQw=")
        );
        assert_eq!(
            parsed.endpoint_host.as_deref(),
            Some("sg-sng.prod.surfshark.com")
        );
    }

    #[test]
    fn rejects_invalid_wireguard_key() {
        assert!(validate_wg_key_format("too-short").is_err());
        assert!(validate_wg_key_format("YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=").is_ok());
    }

    #[test]
    fn masks_secrets_without_leaking_middle_chars() {
        let key = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";
        let masked = mask_secret(key);
        assert_eq!(masked, "YWFh••••••••YWE=");
        assert!(!masked.contains("YWFhYWFh"));
    }

    #[test]
    fn round_trips_and_loads_legacy_partial_state_json() {
        let legacy_json = r#"{"settings":{"basePort":10805}}"#;
        let loaded: PersistedState =
            serde_json::from_str(legacy_json).expect("legacy json should load with defaults");
        assert_eq!(loaded.settings.base_port, 10805);
        assert_eq!(loaded.settings.wg_address, DEFAULT_WG_ADDRESS);
        assert_eq!(loaded.settings.language, AppLanguage::En);
        assert!(!loaded.settings.allow_lan);

        let temp_dir = std::env::temp_dir().join(format!("sproxy_test_{}", std::process::id()));
        let state_path = temp_dir.join("state.json");
        save_state_to_path(&state_path, &loaded).expect("should save atomically");
        let reloaded = load_state_from_path(&state_path);
        assert_eq!(reloaded.settings.base_port, 10805);
        assert_eq!(reloaded.slots.len(), 1);
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
