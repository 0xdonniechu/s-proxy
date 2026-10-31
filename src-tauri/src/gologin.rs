use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Instant;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoLoginProfileSummary {
    pub id: String,
    pub name: String,
    pub os: String,
    pub proxy_mode: String,
    pub proxy_host: String,
    pub proxy_port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LeakStatus {
    #[default]
    Unchecked,
    Safe,
    LeakBlocked,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EgressCheckResult {
    pub exit_ip: String,
    pub country: String,
    pub city: String,
    pub org: String,
    pub latency_ms: u64,
    pub leak_status: LeakStatus,
    pub checked_at_epoch_s: u64,
    pub error_message: String,
}

pub fn build_gologin_proxy_patch_payload(mode: &str, host: &str, port: u16) -> Result<String, String> {
    let normalized_mode = match mode.trim().to_ascii_lowercase().as_str() {
        "socks5" => "socks5",
        "http" => "http",
        "none" => "none",
        other => return Err(format!("Unsupported GoLogin proxy mode: {other}")),
    };
    if !(1024..=65535).contains(&port) && normalized_mode != "none" {
        return Err(format!("Invalid proxy port for GoLogin: {port}"));
    }
    let payload = serde_json::json!({
        "mode": normalized_mode,
        "host": if normalized_mode == "none" { "" } else { host.trim() },
        "port": if normalized_mode == "none" { 80 } else { port },
        "username": "",
        "password": ""
    });
    serde_json::to_string(&payload).map_err(|e| format!("Failed to serialize GoLogin payload: {e}"))
}

pub fn evaluate_leak_status(exit_ip: &str, host_isp_ip: Option<&str>) -> LeakStatus {
    let trimmed_exit = exit_ip.trim();
    if trimmed_exit.is_empty() {
        return LeakStatus::Error;
    }
    if let Some(isp) = host_isp_ip {
        let trimmed_isp = isp.trim();
        if !trimmed_isp.is_empty() && trimmed_exit == trimmed_isp {
            return LeakStatus::LeakBlocked;
        }
    }
    LeakStatus::Safe
}

fn run_curl_with_config(curl_config_stdin: &str, extra_args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(r"C:\Windows\System32\curl.exe");
    cmd.args(["-sS", "--max-time", "12", "-K", "-"])
        .args(extra_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn curl.exe: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(curl_config_stdin.as_bytes())
            .map_err(|e| format!("Failed to pass config to curl.exe: {e}"))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("Failed waiting for curl.exe: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn parse_gologin_profiles_response(raw_json: &str) -> Result<Vec<GoLoginProfileSummary>, String> {
    let root: serde_json::Value =
        serde_json::from_str(raw_json).map_err(|e| format!("Invalid GoLogin JSON response: {e}"))?;

    let arr = if let Some(profiles) = root.get("profiles").and_then(|v| v.as_array()) {
        profiles
    } else if let Some(list) = root.as_array() {
        list
    } else {
        return Err("Unexpected GoLogin profiles response shape".to_string());
    };

    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unnamed Profile")
            .to_string();
        let os = item
            .get("os")
            .and_then(|v| v.as_str())
            .unwrap_or("win")
            .to_string();
        let proxy = item.get("proxy");
        let proxy_mode = proxy
            .and_then(|p| p.get("mode"))
            .and_then(|v| v.as_str())
            .unwrap_or("none")
            .to_string();
        let proxy_host = proxy
            .and_then(|p| p.get("host"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let proxy_port = proxy
            .and_then(|p| p.get("port"))
            .and_then(|v| v.as_u64())
            .and_then(|p| u16::try_from(p).ok())
            .unwrap_or(0);

        out.push(GoLoginProfileSummary {
            id,
            name,
            os,
            proxy_mode,
            proxy_host,
            proxy_port,
        });
    }
    Ok(out)
}

pub fn fetch_gologin_profiles_blocking(token: &str) -> Result<Vec<GoLoginProfileSummary>, String> {
    let clean_token = token.trim();
    if clean_token.is_empty() {
        return Err("GoLogin API Token is empty. Configure it in Settings first.".to_string());
    }
    if clean_token.chars().any(|c| c == '\r' || c == '\n' || c == '"') {
        return Err("GoLogin API Token contains invalid characters".to_string());
    }
    let cfg = format!(
        "url = \"https://api.gologin.com/browser/v2\"\n\
         header = \"Authorization: Bearer {clean_token}\"\n\
         header = \"User-Agent: s-proxy/0.1\"\n"
    );
    let body = run_curl_with_config(&cfg, &["--fail-with-body"])?;
    parse_gologin_profiles_response(&body)
}

pub fn update_gologin_profile_proxy_blocking(
    token: &str,
    profile_id: &str,
    mode: &str,
    host: &str,
    port: u16,
) -> Result<(), String> {
    let clean_token = token.trim();
    if clean_token.is_empty() {
        return Err("GoLogin API Token is empty".to_string());
    }
    if clean_token.chars().any(|c| c == '\r' || c == '\n' || c == '"') {
        return Err("GoLogin API Token contains invalid characters".to_string());
    }
    let clean_id = profile_id.trim();
    if clean_id.is_empty() || !clean_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid GoLogin profile ID".to_string());
    }
    let payload = build_gologin_proxy_patch_payload(mode, host, port)?;
    let escaped_payload = payload.replace('\\', "\\\\").replace('"', "\\\"");
    let cfg = format!(
        "url = \"https://api.gologin.com/browser/{clean_id}/proxy\"\n\
         request = \"PATCH\"\n\
         header = \"Authorization: Bearer {clean_token}\"\n\
         header = \"Content-Type: application/json\"\n\
         header = \"User-Agent: s-proxy/0.1\"\n\
         data = \"{escaped_payload}\"\n"
    );
    let _ = run_curl_with_config(&cfg, &["--fail-with-body"])?;
    Ok(())
}

pub fn detect_host_isp_ip_blocking() -> Option<String> {
    let cfg = "url = \"https://ipinfo.io/json\"\n";
    if let Ok(raw) = run_curl_with_config(cfg, &["--max-time", "5"]) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(ip) = val.get("ip").and_then(|v| v.as_str()) {
                let trimmed = ip.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

pub fn check_slot_egress_blocking(local_port: u16, host_isp_ip: Option<&str>) -> EgressCheckResult {
    let started = Instant::now();
    let now_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let cfg = format!(
        "url = \"https://ipinfo.io/json\"\n\
         proxy = \"socks5h://127.0.0.1:{local_port}\"\n"
    );

    match run_curl_with_config(&cfg, &["--max-time", "10"]) {
        Ok(raw) => {
            let latency_ms = started.elapsed().as_millis() as u64;
            let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) else {
                return EgressCheckResult {
                    leak_status: LeakStatus::Error,
                    checked_at_epoch_s: now_epoch,
                    error_message: "Invalid JSON response from ipinfo.io".to_string(),
                    ..Default::default()
                };
            };
            let exit_ip = val
                .get("ip")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let country = val
                .get("country")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let city = val
                .get("city")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let org = val
                .get("org")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let leak_status = evaluate_leak_status(&exit_ip, host_isp_ip);
            let error_message = if leak_status == LeakStatus::LeakBlocked {
                "CRITICAL: Proxy exit IP matches Host ISP IP! Slot blocked.".to_string()
            } else {
                String::new()
            };

            EgressCheckResult {
                exit_ip,
                country,
                city,
                org,
                latency_ms,
                leak_status,
                checked_at_epoch_s: now_epoch,
                error_message,
            }
        }
        Err(err) => EgressCheckResult {
            leak_status: LeakStatus::Error,
            checked_at_epoch_s: now_epoch,
            error_message: err,
            ..Default::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_safe_gologin_proxy_patch_json() {
        let json_str = build_gologin_proxy_patch_payload("socks5", "127.0.0.1", 10801)
            .expect("should build valid payload");
        let val: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(val["mode"], "socks5");
        assert_eq!(val["host"], "127.0.0.1");
        assert_eq!(val["port"], 10801);
        assert_eq!(val["username"], "");
        assert_eq!(val["password"], "");
    }

    #[test]
    fn detects_ip_leak_when_exit_matches_isp() {
        assert_eq!(
            evaluate_leak_status("14.187.231.221", Some("14.187.231.221")),
            LeakStatus::LeakBlocked
        );
        assert_eq!(
            evaluate_leak_status("84.17.46.12", Some("14.187.231.221")),
            LeakStatus::Safe
        );
        assert_eq!(
            evaluate_leak_status("", Some("14.187.231.221")),
            LeakStatus::Error
        );
    }

    #[test]
    fn parses_gologin_v2_profiles_list() {
        let sample = r#"{
            "profiles": [
                {
                    "id": "66f01234abcd",
                    "name": "US Store 01",
                    "os": "win",
                    "proxy": {
                        "mode": "socks5",
                        "host": "127.0.0.1",
                        "port": 10801
                    }
                }
            ]
        }"#;
        let list = parse_gologin_profiles_response(sample).expect("should parse profiles");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "66f01234abcd");
        assert_eq!(list[0].name, "US Store 01");
        assert_eq!(list[0].proxy_mode, "socks5");
        assert_eq!(list[0].proxy_port, 10801);
    }
}
