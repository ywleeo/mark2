// 图片代理：绕过 CDN 的 Referer / Origin 防盗链
//
// 前端把外链图片 src `http(s)://xxx` 改写成 `img-proxy://.../<base64url(src)>`,
// WebView 请求 img-proxy scheme 时由这里用 reqwest 替 WebView 去抓图(Rust 侧
// 请求不带 Origin 也不带 Referer)，把字节流和 Content-Type 返回给 WebView。

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::Client;
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::UriSchemeResponder;

const MAX_BYTES: usize = 20 * 1024 * 1024;
const FETCH_TIMEOUT_SECS: u64 = 10;

pub fn handle(request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    tauri::async_runtime::spawn(async move {
        let response = fetch(request).await.unwrap_or_else(|err| {
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header("Access-Control-Allow-Origin", "*")
                .header("Content-Type", "text/plain; charset=utf-8")
                .body(format!("img-proxy: {}", err).into_bytes())
                .unwrap_or_else(|_| Response::new(Vec::new()))
        });
        responder.respond(response);
    });
}

async fn fetch(request: Request<Vec<u8>>) -> Result<Response<Vec<u8>>, String> {
    let original_url = extract_original_url(&request)?;

    if !is_safe_http_url(&original_url) {
        return Err(format!("refused unsafe or internal url: {}", original_url));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;

    let upstream = client
        .get(&original_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605 Safari/605",
        )
        .send()
        .await
        .map_err(|e| format!("upstream fetch failed: {}", e))?;

    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = upstream
        .bytes()
        .await
        .map_err(|e| format!("read body failed: {}", e))?;

    if bytes.len() > MAX_BYTES {
        return Err(format!("response too large: {} bytes", bytes.len()));
    }

    Response::builder()
        .status(status.as_u16())
        .header("Content-Type", content_type)
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "public, max-age=3600")
        .body(bytes.to_vec())
        .map_err(|e| format!("build response failed: {}", e))
}

/// 从 Request URI 里解出原始 URL。
/// URI 形式:
///   macOS/Linux:  img-proxy://localhost/<base64url>
///   Windows:      http://img-proxy.localhost/<base64url>
/// 都统一从 path 第一段拿编码串。
fn extract_original_url(request: &Request<Vec<u8>>) -> Result<String, String> {
    let uri = request.uri();
    let path = uri.path().trim_start_matches('/');
    let encoded = path.split('/').next().unwrap_or("");
    if encoded.is_empty() {
        return Err("empty path".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|e| format!("base64 decode failed: {}", e))?;
    String::from_utf8(bytes).map_err(|e| format!("utf8 decode failed: {}", e))
}

/// SSRF 防御：只允许 http/https 公网地址，拒绝本机/RFC1918 内网。
fn is_safe_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return false;
    }
    let host_and_rest = lower
        .trim_start_matches("http://")
        .trim_start_matches("https://");
    let host = host_and_rest
        .split(|c: char| c == '/' || c == ':' || c == '?' || c == '#')
        .next()
        .unwrap_or("");

    if host.is_empty() {
        return false;
    }

    // 拒绝本机
    if matches!(host, "localhost" | "0.0.0.0" | "::1") {
        return false;
    }

    // RFC1918 + link-local 字面量检查
    if host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
    {
        return false;
    }
    if let Some(second) = host.strip_prefix("172.").and_then(|s| s.split('.').next()) {
        if let Ok(n) = second.parse::<u8>() {
            if (16..=31).contains(&n) {
                return false;
            }
        }
    }
    true
}
