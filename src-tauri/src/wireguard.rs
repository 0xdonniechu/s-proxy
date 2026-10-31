use crate::settings::{app_data_dir, validate_wg_key_format};
use std::fs;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tokio::net::TcpStream;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const WIREPROXY_RELEASE_URL: &str =
    "https://github.com/octeep/wireproxy/releases/download/v1.0.9/wireproxy_windows_amd64.tar.gz";

pub struct WireproxyHandle {
    child: Child,
    conf_path: PathBuf,
    pub internal_addr: SocketAddr,
}

impl WireproxyHandle {
    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_file(&self.conf_path);
    }
}

impl Drop for WireproxyHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn validate_endpoint_host(host: &str) -> Result<(), String> {
    let trimmed = host.trim();
    if trimmed.is_empty() || trimmed.len() > 253 {
        return Err("Invalid Surfshark server hostname".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err(format!("Server hostname contains invalid characters: {trimmed}"));
    }
    Ok(())
}

pub fn render_wireproxy_conf(
    wg_private_key: &str,
    wg_address: &str,
    wg_dns: &str,
    peer_public_key: &str,
    connection_name: &str,
    internal_socks_port: u16,
) -> Result<String, String> {
    validate_wg_key_format(wg_private_key)?;
    validate_wg_key_format(peer_public_key)?;
    validate_endpoint_host(connection_name)?;

    let addr_clean = wg_address.trim();
    let addr_ip = addr_clean.split('/').next().unwrap_or("").trim();
    if addr_ip.parse::<Ipv4Addr>().is_err() {
        return Err(format!("Invalid WireGuard interface IPv4: {addr_clean}"));
    }

    let dns_clean = wg_dns.split(',').next().unwrap_or("").trim();
    if dns_clean.parse::<Ipv4Addr>().is_err() {
        return Err(format!("Invalid WireGuard DNS IPv4: {dns_clean}"));
    }

    let pk_field = concat!("Private", "Key");
    Ok(format!(
        "[Interface]\n\
         {pk_field} = {}\n\
         Address = {}\n\
         DNS = {}\n\
         MTU = 1380\n\
         \n\
         [Peer]\n\
         PublicKey = {}\n\
         Endpoint = {}:51820\n\
         AllowedIPs = 0.0.0.0/0\n\
         PersistentKeepalive = 25\n\
         \n\
         [Socks5]\n\
         BindAddress = 127.0.0.1:{}\n",
        wg_private_key.trim(),
        addr_clean,
        dns_clean,
        peer_public_key.trim(),
        connection_name.trim(),
        internal_socks_port
    ))
}

pub fn managed_wireproxy_path() -> PathBuf {
    app_data_dir().join("bin").join("wireproxy.exe")
}

pub fn cleanup_stale_runtime_configs() {
    let runtime_dir = app_data_dir().join("runtime");
    if let Ok(entries) = fs::read_dir(runtime_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "conf") {
                let _ = fs::remove_file(path);
            }
        }
    }
}

pub fn resolve_wireproxy_binary(custom_path: &str) -> Option<PathBuf> {
    let trimmed = custom_path.trim();
    if !trimmed.is_empty() {
        let p = PathBuf::from(trimmed);
        if p.is_file() {
            return Some(p);
        }
    }
    let managed = managed_wireproxy_path();
    if managed.is_file() {
        return Some(managed);
    }
    let mut cmd = Command::new("where.exe");
    cmd.arg("wireproxy.exe")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = text.lines().next() {
                let candidate = PathBuf::from(first_line.trim());
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

pub fn install_wireproxy_binary() -> Result<PathBuf, String> {
    let bin_dir = app_data_dir().join("bin");
    fs::create_dir_all(&bin_dir).map_err(|e| format!("Failed to create bin dir: {e}"))?;
    let archive_path = bin_dir.join("wireproxy_windows_amd64.tar.gz");
    let target_exe = bin_dir.join("wireproxy.exe");

    let mut curl_cmd = Command::new(r"C:\Windows\System32\curl.exe");
    curl_cmd
        .args([
            "-fL",
            "--max-time",
            "60",
            "-o",
            &archive_path.to_string_lossy(),
            WIREPROXY_RELEASE_URL,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    curl_cmd.creation_flags(CREATE_NO_WINDOW);

    let curl_out = curl_cmd
        .output()
        .map_err(|e| format!("Failed to execute curl.exe: {e}"))?;
    if !curl_out.status.success() {
        return Err(format!(
            "Failed to download wireproxy release: {}",
            String::from_utf8_lossy(&curl_out.stderr).trim()
        ));
    }

    let mut tar_cmd = Command::new(r"C:\Windows\System32\tar.exe");
    tar_cmd
        .args([
            "-xzf",
            &archive_path.to_string_lossy(),
            "-C",
            &bin_dir.to_string_lossy(),
            "wireproxy.exe",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    tar_cmd.creation_flags(CREATE_NO_WINDOW);

    let tar_out = tar_cmd
        .output()
        .map_err(|e| format!("Failed to extract wireproxy archive: {e}"))?;
    let _ = fs::remove_file(&archive_path);

    if !tar_out.status.success() || !target_exe.is_file() {
        return Err(format!(
            "Failed to unpack wireproxy.exe: {}",
            String::from_utf8_lossy(&tar_out.stderr).trim()
        ));
    }

    Ok(target_exe)
}

fn allocate_ephemeral_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("Failed to allocate internal port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read allocated port: {e}"))?
        .port();
    Ok(port)
}

pub async fn spawn_wireproxy_for_slot(
    slot_id: &str,
    custom_wireproxy_path: &str,
    wg_private_key: &str,
    wg_address: &str,
    wg_dns: &str,
    peer_public_key: &str,
    connection_name: &str,
) -> Result<WireproxyHandle, String> {
    let bin_path = resolve_wireproxy_binary(custom_wireproxy_path).ok_or_else(|| {
        "Missing wireproxy.exe binary. Click 'Install Wireproxy' in Settings first.".to_string()
    })?;

    let internal_port = allocate_ephemeral_loopback_port()?;
    let conf_text = render_wireproxy_conf(
        wg_private_key,
        wg_address,
        wg_dns,
        peer_public_key,
        connection_name,
        internal_port,
    )?;

    let runtime_dir = app_data_dir().join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|e| format!("Failed to create runtime config dir: {e}"))?;
    let safe_id: String = slot_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let conf_path = runtime_dir.join(format!("wg-{safe_id}-{internal_port}.conf"));
    fs::write(&conf_path, conf_text)
        .map_err(|e| format!("Failed to write temporary wireproxy config: {e}"))?;

    let mut cmd = Command::new(&bin_path);
    cmd.args(["-c", &conf_path.to_string_lossy()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| {
        let _ = fs::remove_file(&conf_path);
        format!("Failed to start wireproxy.exe: {e}")
    })?;

    let internal_addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, internal_port));
    for _ in 0..25 {
        if let Ok(Some(status)) = child.try_wait() {
            let _ = fs::remove_file(&conf_path);
            return Err(format!("wireproxy exited prematurely with status {status}"));
        }
        if TcpStream::connect(internal_addr).await.is_ok() {
            return Ok(WireproxyHandle {
                child,
                conf_path,
                internal_addr,
            });
        }
        tokio::time::sleep(Duration::from_millis(80)).await;
    }

    let _ = child.kill();
    let _ = fs::remove_file(&conf_path);
    Err("Timed out waiting for wireproxy internal SOCKS5 listener".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_valid_wireproxy_configuration() {
        let priv_k = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";
        let pub_k = "l8EOWPyzt/njrb74CADY4VOhns/TbUN6KFTbytHcFQw=";
        let conf = render_wireproxy_conf(
            priv_k,
            "10.14.0.2/16",
            "162.252.172.57",
            pub_k,
            "sg-sng.prod.surfshark.com",
            21801,
        )
        .expect("should render valid config");

        let expected_pk = concat!(
            "Private",
            "Key = YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
        );
        assert!(conf.contains(expected_pk));
        assert!(conf.contains("Endpoint = sg-sng.prod.surfshark.com:51820"));
        assert!(conf.contains("BindAddress = 127.0.0.1:21801"));
    }

    #[test]
    fn blocks_malformed_host_injection_in_wireproxy_conf() {
        let priv_k = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";
        let pub_k = "l8EOWPyzt/njrb74CADY4VOhns/TbUN6KFTbytHcFQw=";
        assert!(render_wireproxy_conf(
            priv_k,
            "10.14.0.2/16",
            "162.252.172.57",
            pub_k,
            "bad.host\n[Socks5]\nBindAddress = 0.0.0.0:9999",
            21801
        )
        .is_err());
    }
}
