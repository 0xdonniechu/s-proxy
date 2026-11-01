use socket2::{Domain, Protocol, SockAddr, Socket, Type};
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::atomic::{AtomicU16, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::watch;
use tokio::time::timeout;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DNS_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HTTP_HEADER_BYTES: usize = 8192;

static DNS_TX_ID: AtomicU16 = AtomicU16::new(0x1337);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetAddr {
    Ip(SocketAddr),
    Domain(String, u16),
}

#[derive(Debug, Clone)]
pub enum UpstreamConfig {
    AdapterBridge {
        adapter_ip: Ipv4Addr,
        if_index: u32,
        dns_server: Ipv4Addr,
        primary_isp_ip: Option<Ipv4Addr>,
        kill_switch_enabled: bool,
        dns_leak_protection: bool,
        ipv6_leak_block: bool,
    },
    UpstreamSocks5 {
        proxy_addr: SocketAddr,
        ipv6_leak_block: bool,
    },
}

#[derive(Debug, Default)]
pub struct ProxyMetrics {
    pub active_connections: AtomicUsize,
    pub total_connections: AtomicU64,
    pub bytes_transferred: AtomicU64,
}

pub struct RunningProxyHandle {
    pub listen_addr: SocketAddr,
    shutdown_tx: watch::Sender<bool>,
    pub metrics: Arc<ProxyMetrics>,
}

impl RunningProxyHandle {
    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(true);
    }
}

impl Drop for RunningProxyHandle {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(true);
    }
}

pub fn validate_adapter_not_leaking(
    adapter_ip: Ipv4Addr,
    primary_isp_ip: Option<Ipv4Addr>,
) -> io::Result<()> {
    if adapter_ip.is_unspecified() || adapter_ip.is_loopback() || adapter_ip.is_link_local() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("Fail-closed: invalid VPN adapter IPv4 {adapter_ip}"),
        ));
    }
    if let Some(isp_ip) = primary_isp_ip {
        if adapter_ip == isp_ip {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("Fail-closed kill-switch: adapter IP {adapter_ip} matches primary ISP IP"),
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
fn set_socket_outbound_interface(socket: &Socket, if_index: u32) -> io::Result<()> {
    use std::os::windows::io::AsRawSocket;
    const IPPROTO_IP: i32 = 0;
    const IP_UNICAST_IF: i32 = 31;

    #[link(name = "ws2_32")]
    extern "system" {
        fn setsockopt(s: usize, level: i32, optname: i32, optval: *const u8, optlen: i32) -> i32;
    }

    if if_index == 0 {
        return Ok(());
    }
    let idx_be = if_index.to_be();
    let raw = socket.as_raw_socket() as usize;
    let rc = unsafe {
        setsockopt(
            raw,
            IPPROTO_IP,
            IP_UNICAST_IF,
            (&idx_be as *const u32).cast::<u8>(),
            std::mem::size_of::<u32>() as i32,
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_socket_outbound_interface(socket: &Socket, if_index: u32) -> io::Result<()> {
    if let Some(nz_idx) = std::num::NonZeroU32::new(if_index) {
        socket.bind_device_by_index_v4(Some(nz_idx))?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn set_socket_outbound_interface(_socket: &Socket, _if_index: u32) -> io::Result<()> {
    Ok(())
}

fn create_bound_tcp_socket(adapter_ip: Ipv4Addr, if_index: u32) -> io::Result<Socket> {
    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
    socket.set_nonblocking(true)?;
    socket.set_tcp_nodelay(true)?;
    let bind_addr = SocketAddrV4::new(adapter_ip, 0);
    socket.bind(&SockAddr::from(bind_addr))?;
    set_socket_outbound_interface(&socket, if_index)?;
    Ok(socket)
}

fn create_bound_udp_socket(adapter_ip: Ipv4Addr, if_index: u32) -> io::Result<Socket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_nonblocking(true)?;
    let bind_addr = SocketAddrV4::new(adapter_ip, 0);
    socket.bind(&SockAddr::from(bind_addr))?;
    set_socket_outbound_interface(&socket, if_index)?;
    Ok(socket)
}

pub fn build_dns_a_query(domain: &str, tx_id: u16) -> io::Result<Vec<u8>> {
    let trimmed = domain.trim_end_matches('.');
    if trimmed.is_empty() || trimmed.len() > 253 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid domain name length",
        ));
    }
    let mut buf = Vec::with_capacity(64);
    buf.extend_from_slice(&tx_id.to_be_bytes());
    buf.extend_from_slice(&0x0100u16.to_be_bytes()); // standard query, recursion desired
    buf.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT = 1
    buf.extend_from_slice(&0u16.to_be_bytes()); // ANCOUNT = 0
    buf.extend_from_slice(&0u16.to_be_bytes()); // NSCOUNT = 0
    buf.extend_from_slice(&0u16.to_be_bytes()); // ARCOUNT = 0

    for label in trimmed.split('.') {
        let bytes = label.as_bytes();
        if bytes.is_empty() || bytes.len() > 63 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid DNS label length",
            ));
        }
        buf.push(bytes.len() as u8);
        buf.extend_from_slice(bytes);
    }
    buf.push(0); // root label
    buf.extend_from_slice(&1u16.to_be_bytes()); // QTYPE = A (1)
    buf.extend_from_slice(&1u16.to_be_bytes()); // QCLASS = IN (1)
    Ok(buf)
}

fn skip_dns_name(packet: &[u8], mut offset: usize) -> Option<usize> {
    let mut jumps = 0usize;
    loop {
        let len = *packet.get(offset)?;
        if len == 0 {
            return Some(offset + 1);
        }
        if (len & 0xC0) == 0xC0 {
            return Some(offset + 2);
        }
        if (len & 0xC0) != 0 {
            return None;
        }
        offset = offset.checked_add(1 + usize::from(len))?;
        jumps += 1;
        if jumps > 128 {
            return None;
        }
    }
}

pub fn parse_dns_a_response(packet: &[u8], expected_tx_id: u16) -> io::Result<Ipv4Addr> {
    if packet.len() < 12 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "DNS response too short",
        ));
    }
    let tx_id = u16::from_be_bytes([packet[0], packet[1]]);
    if tx_id != expected_tx_id {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "DNS transaction ID mismatch",
        ));
    }
    let flags = u16::from_be_bytes([packet[2], packet[3]]);
    let rcode = flags & 0x000F;
    if rcode != 0 {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("DNS query failed with RCODE {rcode}"),
        ));
    }
    let qdcount = u16::from_be_bytes([packet[4], packet[5]]);
    let ancount = u16::from_be_bytes([packet[6], packet[7]]);
    let mut offset = 12usize;

    for _ in 0..qdcount {
        offset = skip_dns_name(packet, offset).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "Malformed DNS question name")
        })?;
        offset = offset
            .checked_add(4)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Truncated DNS question"))?;
    }

    for _ in 0..ancount {
        offset = skip_dns_name(packet, offset).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "Malformed DNS answer name")
        })?;
        if offset + 10 > packet.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Truncated DNS resource record",
            ));
        }
        let rtype = u16::from_be_bytes([packet[offset], packet[offset + 1]]);
        let rclass = u16::from_be_bytes([packet[offset + 2], packet[offset + 3]]);
        let rdlength = usize::from(u16::from_be_bytes([packet[offset + 8], packet[offset + 9]]));
        offset += 10;
        if offset + rdlength > packet.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Truncated DNS RDATA",
            ));
        }
        if rtype == 1 && rclass == 1 && rdlength == 4 {
            return Ok(Ipv4Addr::new(
                packet[offset],
                packet[offset + 1],
                packet[offset + 2],
                packet[offset + 3],
            ));
        }
        offset += rdlength;
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "No IPv4 A record found in tunnel DNS response",
    ))
}

async fn resolve_domain_on_adapter(
    domain: &str,
    adapter_ip: Ipv4Addr,
    if_index: u32,
    dns_server: Ipv4Addr,
) -> io::Result<Ipv4Addr> {
    if let Ok(ip) = domain.parse::<Ipv4Addr>() {
        return Ok(ip);
    }
    let servers = [dns_server, Ipv4Addr::new(1, 1, 1, 1)];
    let mut last_err = io::Error::new(io::ErrorKind::NotFound, "Tunnel DNS resolution failed");

    for server_ip in servers {
        let tx_id = DNS_TX_ID.fetch_add(1, Ordering::Relaxed);
        let query = build_dns_a_query(domain, tx_id)?;
        let std_udp: std::net::UdpSocket = create_bound_udp_socket(adapter_ip, if_index)?.into();
        let udp = UdpSocket::from_std(std_udp)?;
        let target_dns = SocketAddr::V4(SocketAddrV4::new(server_ip, 53));

        let attempt = timeout(DNS_TIMEOUT, async {
            udp.send_to(&query, target_dns).await?;
            let mut resp = [0u8; 1500];
            let (n, _) = udp.recv_from(&mut resp).await?;
            parse_dns_a_response(&resp[..n], tx_id)
        })
        .await;

        match attempt {
            Ok(Ok(ipv4)) => return Ok(ipv4),
            Ok(Err(e)) => last_err = e,
            Err(_) => {
                last_err = io::Error::new(io::ErrorKind::TimedOut, "Tunnel DNS query timed out")
            }
        }
    }

    Err(last_err)
}

async fn dial_upstream(target: &TargetAddr, upstream: &UpstreamConfig) -> io::Result<TcpStream> {
    match upstream {
        UpstreamConfig::AdapterBridge {
            adapter_ip,
            if_index,
            dns_server,
            primary_isp_ip,
            kill_switch_enabled,
            dns_leak_protection,
            ipv6_leak_block,
        } => {
            if *kill_switch_enabled {
                validate_adapter_not_leaking(*adapter_ip, *primary_isp_ip)?;
            }
            let effective_if_index = if *kill_switch_enabled { *if_index } else { 0 };
            let remote_v4 = match target {
                TargetAddr::Ip(SocketAddr::V4(v4)) => *v4,
                TargetAddr::Ip(SocketAddr::V6(_)) => {
                    if *ipv6_leak_block {
                        return Err(io::Error::new(
                            io::ErrorKind::Unsupported,
                            "IPv6 target disabled on IPv4 VPN adapter bridge to prevent dual-stack leak",
                        ));
                    }
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        "IPv4 adapter bridge cannot dial raw IPv6 socket",
                    ));
                }
                TargetAddr::Domain(host, port) => {
                    let ip = if *dns_leak_protection {
                        resolve_domain_on_adapter(
                            host,
                            *adapter_ip,
                            effective_if_index,
                            *dns_server,
                        )
                        .await?
                    } else {
                        match resolve_domain_on_adapter(
                            host,
                            *adapter_ip,
                            effective_if_index,
                            *dns_server,
                        )
                        .await
                        {
                            Ok(v4) => v4,
                            Err(_) => {
                                let mut addrs =
                                    tokio::net::lookup_host((host.as_str(), *port)).await?;
                                addrs
                                    .find_map(|sa| match sa {
                                        SocketAddr::V4(v4) => Some(*v4.ip()),
                                        SocketAddr::V6(_) => None,
                                    })
                                    .ok_or_else(|| {
                                        io::Error::new(
                                            io::ErrorKind::NotFound,
                                            "No IPv4 address resolved",
                                        )
                                    })?
                            }
                        }
                    };
                    SocketAddrV4::new(ip, *port)
                }
            };

            let sock = create_bound_tcp_socket(*adapter_ip, effective_if_index)?;
            let std_stream: std::net::TcpStream = match sock.connect(&SockAddr::from(remote_v4)) {
                Ok(()) => sock.into(),
                Err(e)
                    if e.raw_os_error() == Some(10035)
                        || e.raw_os_error() == Some(115)
                        || e.raw_os_error() == Some(36)
                        || e.kind() == io::ErrorKind::WouldBlock =>
                {
                    sock.into()
                }
                Err(e) => return Err(e),
            };
            let stream = TcpStream::from_std(std_stream)?;
            timeout(CONNECT_TIMEOUT, stream.writable())
                .await
                .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "TCP connect timed out"))??;
            if let Some(err) = stream.take_error()? {
                return Err(err);
            }
            Ok(stream)
        }
        UpstreamConfig::UpstreamSocks5 {
            proxy_addr,
            ipv6_leak_block,
        } => {
            if *ipv6_leak_block && matches!(target, TargetAddr::Ip(SocketAddr::V6(_))) {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "IPv6 target blocked by IPv6 Leak Blocker",
                ));
            }
            let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(proxy_addr))
                .await
                .map_err(|_| {
                    io::Error::new(io::ErrorKind::TimedOut, "Upstream wireproxy connect timed out")
                })??;
            let _ = stream.set_nodelay(true);

            // SOCKS5 greeting (no-auth)
            stream.write_all(&[0x05, 0x01, 0x00]).await?;
            let mut greeting_reply = [0u8; 2];
            stream.read_exact(&mut greeting_reply).await?;
            if greeting_reply != [0x05, 0x00] {
                return Err(io::Error::new(
                    io::ErrorKind::ConnectionRefused,
                    "Upstream wireproxy rejected SOCKS5 greeting",
                ));
            }

            let mut req = Vec::with_capacity(64);
            req.extend_from_slice(&[0x05, 0x01, 0x00]);
            match target {
                TargetAddr::Ip(SocketAddr::V4(v4)) => {
                    req.push(0x01);
                    req.extend_from_slice(&v4.ip().octets());
                    req.extend_from_slice(&v4.port().to_be_bytes());
                }
                TargetAddr::Ip(SocketAddr::V6(v6)) => {
                    req.push(0x04);
                    req.extend_from_slice(&v6.ip().octets());
                    req.extend_from_slice(&v6.port().to_be_bytes());
                }
                TargetAddr::Domain(host, port) => {
                    let bytes = host.as_bytes();
                    if bytes.is_empty() || bytes.len() > 255 {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidInput,
                            "Domain name too long for SOCKS5",
                        ));
                    }
                    req.push(0x03);
                    req.push(bytes.len() as u8);
                    req.extend_from_slice(bytes);
                    req.extend_from_slice(&port.to_be_bytes());
                }
            }
            stream.write_all(&req).await?;

            let mut reply_head = [0u8; 4];
            stream.read_exact(&mut reply_head).await?;
            if reply_head[1] != 0x00 {
                return Err(io::Error::new(
                    io::ErrorKind::ConnectionRefused,
                    format!("Upstream wireproxy connect failed (code 0x{:02x})", reply_head[1]),
                ));
            }
            let skip_len = match reply_head[3] {
                0x01 => 4 + 2,
                0x04 => 16 + 2,
                0x03 => {
                    let mut len_byte = [0u8; 1];
                    stream.read_exact(&mut len_byte).await?;
                    usize::from(len_byte[0]) + 2
                }
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Unknown SOCKS5 ATYP from upstream",
                    ))
                }
            };
            let mut discard = vec![0u8; skip_len];
            stream.read_exact(&mut discard).await?;
            Ok(stream)
        }
    }
}

pub fn parse_host_port(authority: &str, default_port: u16) -> io::Result<TargetAddr> {
    let trimmed = authority.trim();
    if trimmed.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Empty authority in HTTP request",
        ));
    }
    let (host, port) = if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some((ipv6_str, port_part)) = rest.split_once(']') {
            let port = if let Some(p_str) = port_part.strip_prefix(':') {
                p_str.parse::<u16>().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, "Invalid port in authority")
                })?
            } else {
                default_port
            };
            (ipv6_str.to_string(), port)
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Malformed IPv6 authority",
            ));
        }
    } else if let Some((h, p_str)) = trimmed.rsplit_once(':') {
        let port = p_str.parse::<u16>().map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "Invalid port in authority")
        })?;
        (h.to_string(), port)
    } else {
        (trimmed.to_string(), default_port)
    };

    if let Ok(ip) = host.parse::<IpAddr>() {
        Ok(TargetAddr::Ip(SocketAddr::new(ip, port)))
    } else {
        Ok(TargetAddr::Domain(host, port))
    }
}

async fn handle_http_client(
    mut client: TcpStream,
    first_byte: u8,
    upstream: UpstreamConfig,
) -> io::Result<(u64, u64)> {
    let mut buf = Vec::with_capacity(1024);
    buf.push(first_byte);
    let mut temp = [0u8; 1024];

    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() >= MAX_HTTP_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "HTTP proxy request header exceeds 8KB limit",
            ));
        }
        let n = client.read(&mut temp).await?;
        if n == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "EOF before HTTP headers completed",
            ));
        }
        buf.extend_from_slice(&temp[..n]);
    };

    let header_str = String::from_utf8_lossy(&buf[..header_end]);
    let mut lines = header_str.lines();
    let request_line = lines.next().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "Empty HTTP request line")
    })?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("HTTP/1.1");

    if method.eq_ignore_ascii_case("CONNECT") {
        let target = parse_host_port(raw_target, 443)?;
        match dial_upstream(&target, &upstream).await {
            Ok(mut remote) => {
                client
                    .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                    .await?;
                if buf.len() > header_end {
                    remote.write_all(&buf[header_end..]).await?;
                }
                tokio::io::copy_bidirectional(&mut client, &mut remote).await
            }
            Err(e) => {
                let _ = client
                    .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                    .await;
                Err(e)
            }
        }
    } else {
        // Plain HTTP proxy request (e.g. GET http://example.com/path HTTP/1.1)
        let (authority, path) = if let Some(rest) = raw_target.strip_prefix("http://") {
            match rest.split_once('/') {
                Some((auth, p)) => (auth.to_string(), format!("/{p}")),
                None => (rest.to_string(), "/".to_string()),
            }
        } else {
            let host_hdr = lines
                .clone()
                .find_map(|l| {
                    let (k, v) = l.split_once(':')?;
                    if k.trim().eq_ignore_ascii_case("host") {
                        Some(v.trim().to_string())
                    } else {
                        None
                    }
                })
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Missing Host header in HTTP request")
                })?;
            (host_hdr, raw_target.to_string())
        };

        let target = parse_host_port(&authority, 80)?;
        let mut remote = dial_upstream(&target, &upstream).await?;

        let mut rewritten = format!("{method} {path} {version}\r\n");
        for line in lines {
            if line.is_empty() {
                continue;
            }
            if line
                .split_once(':')
                .is_some_and(|(k, _)| k.trim().eq_ignore_ascii_case("proxy-connection"))
            {
                continue;
            }
            rewritten.push_str(line);
            rewritten.push_str("\r\n");
        }
        rewritten.push_str("Connection: close\r\n\r\n");

        remote.write_all(rewritten.as_bytes()).await?;
        if buf.len() > header_end {
            remote.write_all(&buf[header_end..]).await?;
        }
        tokio::io::copy_bidirectional(&mut client, &mut remote).await
    }
}

async fn handle_client(mut client: TcpStream, upstream: UpstreamConfig) -> io::Result<(u64, u64)> {
    let _ = client.set_nodelay(true);
    let mut first = [0u8; 1];
    timeout(CONNECT_TIMEOUT, client.read_exact(&mut first))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "Client greeting timed out"))??;

    if first[0] == 0x05 {
        // Re-combine by handling SOCKS5 after version byte 0x05:
        handle_socks5_after_version(client, upstream).await
    } else {
        handle_http_client(client, first[0], upstream).await
    }
}

async fn handle_socks5_after_version(
    mut client: TcpStream,
    upstream: UpstreamConfig,
) -> io::Result<(u64, u64)> {
    let mut nmethods_b = [0u8; 1];
    client.read_exact(&mut nmethods_b).await?;
    let nmethods = usize::from(nmethods_b[0]);
    let mut methods = vec![0u8; nmethods];
    client.read_exact(&mut methods).await?;
    if !methods.contains(&0x00) {
        let _ = client.write_all(&[0x05, 0xFF]).await;
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Client does not support SOCKS5 no-auth",
        ));
    }
    client.write_all(&[0x05, 0x00]).await?;

    let mut req_head = [0u8; 4];
    client.read_exact(&mut req_head).await?;
    if req_head[0] != 0x05 || req_head[1] != 0x01 {
        let _ = client
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await;
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Only SOCKS5 CONNECT (0x01) is supported",
        ));
    }

    let target = match req_head[3] {
        0x01 => {
            let mut buf = [0u8; 6];
            client.read_exact(&mut buf).await?;
            let ip = Ipv4Addr::new(buf[0], buf[1], buf[2], buf[3]);
            let port = u16::from_be_bytes([buf[4], buf[5]]);
            TargetAddr::Ip(SocketAddr::V4(SocketAddrV4::new(ip, port)))
        }
        0x04 => {
            let mut buf = [0u8; 18];
            client.read_exact(&mut buf).await?;
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&buf[..16]);
            let ip = IpAddr::from(octets);
            let port = u16::from_be_bytes([buf[16], buf[17]]);
            TargetAddr::Ip(SocketAddr::new(ip, port))
        }
        0x03 => {
            let mut len_b = [0u8; 1];
            client.read_exact(&mut len_b).await?;
            let dlen = usize::from(len_b[0]);
            let mut dbuf = vec![0u8; dlen + 2];
            client.read_exact(&mut dbuf).await?;
            let host = String::from_utf8(dbuf[..dlen].to_vec()).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "Invalid UTF-8 domain in SOCKS5")
            })?;
            let port = u16::from_be_bytes([dbuf[dlen], dbuf[dlen + 1]]);
            TargetAddr::Domain(host, port)
        }
        _ => {
            let _ = client
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await;
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Unsupported SOCKS5 address type",
            ));
        }
    };

    match dial_upstream(&target, &upstream).await {
        Ok(mut remote) => {
            client
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            tokio::io::copy_bidirectional(&mut client, &mut remote).await
        }
        Err(e) => {
            let _ = client
                .write_all(&[0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await;
            Err(e)
        }
    }
}

pub async fn start_proxy_listener(
    bind_ip: Ipv4Addr,
    port: u16,
    upstream: UpstreamConfig,
) -> Result<RunningProxyHandle, String> {
    if let UpstreamConfig::AdapterBridge {
        adapter_ip,
        primary_isp_ip,
        kill_switch_enabled,
        ..
    } = &upstream
    {
        if *kill_switch_enabled {
            validate_adapter_not_leaking(*adapter_ip, *primary_isp_ip)
                .map_err(|e| e.to_string())?;
        }
    }

    let bind_addr = SocketAddr::V4(SocketAddrV4::new(bind_ip, port));
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| format!("Failed to bind proxy listener on {bind_addr}: {e}"))?;
    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local proxy address: {e}"))?;

    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let metrics = Arc::new(ProxyMetrics::default());
    let metrics_clone = Arc::clone(&metrics);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_err() || *shutdown_rx.borrow() {
                        break;
                    }
                }
                accept_res = listener.accept() => {
                    let Ok((stream, _peer)) = accept_res else {
                        continue;
                    };
                    let upstream_clone = upstream.clone();
                    let m = Arc::clone(&metrics_clone);
                    m.active_connections.fetch_add(1, Ordering::Relaxed);
                    m.total_connections.fetch_add(1, Ordering::Relaxed);

                    tokio::spawn(async move {
                        if let Ok((up, down)) = handle_client(stream, upstream_clone).await {
                            m.bytes_transferred.fetch_add(up + down, Ordering::Relaxed);
                        }
                        m.active_connections.fetch_sub(1, Ordering::Relaxed);
                    });
                }
            }
        }
    });

    Ok(RunningProxyHandle {
        listen_addr: local_addr,
        shutdown_tx,
        metrics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fail_closed_blocks_isp_ip_and_loopback() {
        let isp_ip = Ipv4Addr::new(192, 168, 3, 4);
        assert!(validate_adapter_not_leaking(isp_ip, Some(isp_ip)).is_err());
        assert!(validate_adapter_not_leaking(Ipv4Addr::LOCALHOST, Some(isp_ip)).is_err());
        assert!(validate_adapter_not_leaking(Ipv4Addr::UNSPECIFIED, Some(isp_ip)).is_err());
        assert!(validate_adapter_not_leaking(Ipv4Addr::new(10, 14, 0, 2), Some(isp_ip)).is_ok());
    }

    #[test]
    fn builds_and_parses_dns_a_packet() {
        let q = build_dns_a_query("ipinfo.io", 0xABCD).expect("valid dns query");
        assert_eq!(&q[0..2], &[0xAB, 0xCD]);

        // Construct minimal valid DNS response for ipinfo.io -> 34.117.59.81
        let mut resp = Vec::new();
        resp.extend_from_slice(&0xABCDu16.to_be_bytes());
        resp.extend_from_slice(&0x8180u16.to_be_bytes()); // standard response, no error
        resp.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT = 1
        resp.extend_from_slice(&1u16.to_be_bytes()); // ANCOUNT = 1
        resp.extend_from_slice(&0u16.to_be_bytes());
        resp.extend_from_slice(&0u16.to_be_bytes());
        resp.extend_from_slice(&q[12..]); // echo question section
        resp.extend_from_slice(&[0xC0, 0x0C]); // pointer to question name
        resp.extend_from_slice(&1u16.to_be_bytes()); // TYPE A
        resp.extend_from_slice(&1u16.to_be_bytes()); // CLASS IN
        resp.extend_from_slice(&60u32.to_be_bytes()); // TTL 60
        resp.extend_from_slice(&4u16.to_be_bytes()); // RDLENGTH 4
        resp.extend_from_slice(&[34, 117, 59, 81]);

        let parsed = parse_dns_a_response(&resp, 0xABCD).expect("should parse A record");
        assert_eq!(parsed, Ipv4Addr::new(34, 117, 59, 81));
    }

    #[test]
    fn parses_http_authority_correctly() {
        assert_eq!(
            parse_host_port("ipinfo.io:443", 443).unwrap(),
            TargetAddr::Domain("ipinfo.io".to_string(), 443)
        );
        assert_eq!(
            parse_host_port("1.1.1.1:80", 80).unwrap(),
            TargetAddr::Ip("1.1.1.1:80".parse().unwrap())
        );
    }

    #[test]
    fn binds_tcp_and_udp_sockets_with_interface_index() {
        // lo0 is interface index 1 on macOS and loopback on Windows
        let tcp_sock = create_bound_tcp_socket(Ipv4Addr::LOCALHOST, 1)
            .expect("should bind TCP socket to loopback with if_index 1");
        let udp_sock = create_bound_udp_socket(Ipv4Addr::LOCALHOST, 1)
            .expect("should bind UDP socket to loopback with if_index 1");
        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                tcp_sock.device_index_v4().expect("should read bound index"),
                std::num::NonZeroU32::new(1)
            );
            assert_eq!(
                udp_sock.device_index_v4().expect("should read bound index"),
                std::num::NonZeroU32::new(1)
            );
        }
        let _ = (tcp_sock, udp_sock);
    }

    #[tokio::test]
    async fn socks5_and_http_connect_tunnel_roundtrip_on_bound_socket() {
        let echo_listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(l) => l,
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => return,
            Err(e) => panic!("unexpected bind error: {e}"),
        };
        let echo_addr = echo_listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = echo_listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 64];
                    if let Ok(n) = s.read(&mut buf).await {
                        let _ = s.write_all(&buf[..n]).await;
                    }
                });
            }
        });

        let upstream = UpstreamConfig::AdapterBridge {
            adapter_ip: Ipv4Addr::LOCALHOST,
            if_index: 1,
            dns_server: Ipv4Addr::new(1, 1, 1, 1),
            primary_isp_ip: Some(Ipv4Addr::new(192, 168, 1, 10)),
            kill_switch_enabled: false,
            dns_leak_protection: true,
            ipv6_leak_block: true,
        };

        let proxy = start_proxy_listener(Ipv4Addr::LOCALHOST, 0, upstream)
            .await
            .expect("proxy listener should start");

        // 1. Test SOCKS5 CONNECT
        let mut s5 = match TcpStream::connect(proxy.listen_addr).await {
            Ok(s) => s,
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
                proxy.stop();
                return;
            }
            Err(e) => panic!("unexpected connect error: {e}"),
        };
        s5.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
        let mut greet = [0u8; 2];
        s5.read_exact(&mut greet).await.unwrap();
        assert_eq!(greet, [0x05, 0x00]);

        let mut req = vec![0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1];
        req.extend_from_slice(&echo_addr.port().to_be_bytes());
        s5.write_all(&req).await.unwrap();
        let mut rep = [0u8; 10];
        s5.read_exact(&mut rep).await.unwrap();
        assert_eq!(rep[1], 0x00);

        s5.write_all(b"ping-socks5").await.unwrap();
        let mut out = [0u8; 11];
        s5.read_exact(&mut out).await.unwrap();
        assert_eq!(&out, b"ping-socks5");

        // 2. Test HTTP CONNECT on the exact same dual-protocol port
        let mut hc = TcpStream::connect(proxy.listen_addr).await.unwrap();
        let connect_req = format!(
            "CONNECT 127.0.0.1:{} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
            echo_addr.port(),
            echo_addr.port()
        );
        hc.write_all(connect_req.as_bytes()).await.unwrap();
        let mut http_rep = [0u8; 39];
        hc.read_exact(&mut http_rep).await.unwrap();
        assert!(String::from_utf8_lossy(&http_rep).starts_with("HTTP/1.1 200"));

        hc.write_all(b"ping-http").await.unwrap();
        let mut out_http = [0u8; 9];
        hc.read_exact(&mut out_http).await.unwrap();
        assert_eq!(&out_http, b"ping-http");

        proxy.stop();
    }
}
