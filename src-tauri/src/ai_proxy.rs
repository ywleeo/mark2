use futures_util::StreamExt;
use parking_lot::Mutex;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/**
 * AI 流式请求状态。
 * 通过 requestId 维护取消标记，避免前端只能硬等网络请求返回。
 */
#[derive(Default)]
pub struct AiProxyState {
    pub cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/**
 * 非流式代理请求参数。
 */
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProxyJsonRequest {
    pub method: String,
    pub url: String,
    pub api_key: String,
    pub body: Option<Value>,
    pub timeout_ms: Option<u64>,
}

/**
 * 流式代理请求参数。
 */
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProxyStreamRequest {
    pub request_id: String,
    pub url: String,
    pub api_key: String,
    pub body: Value,
    pub timeout_ms: Option<u64>,
}

/**
 * 非流式代理响应体。
 */
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProxyJsonResponse {
    pub status: u16,
    pub body: String,
}

/**
 * 流式事件载荷。
 */
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProxyStreamChunkPayload {
    request_id: String,
    chunk: String,
}

/**
 * 流式结束事件载荷。
 */
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProxyStreamEndPayload {
    request_id: String,
}

/**
 * 流式失败事件载荷。
 */
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProxyStreamErrorPayload {
    request_id: String,
    error: String,
}

/**
 * 创建带默认头部的 reqwest client。
 * 这里显式带上浏览器风格 UA，兼容对非浏览器请求敏感的 OpenAI-compatible 服务。
 */
fn build_http_client(timeout_ms: Option<u64>) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(15_000)))
        .build()
        .map_err(|err| err.to_string())
}

/**
 * 为请求注入通用头部。
 */
fn apply_common_headers(
    request: reqwest::RequestBuilder,
    api_key: &str,
) -> reqwest::RequestBuilder {
    request
        .header(AUTHORIZATION, format!("Bearer {api_key}"))
        .header(USER_AGENT, "Mozilla/5.0 Mark2/1.0")
        .header(ACCEPT, "application/json")
}

/**
 * 执行非流式 OpenAI-compatible 请求。
 * 由前端通过 invoke 调用，绕过 WebView fetch 的 CORS / WAF 限制。
 */
#[tauri::command]
pub async fn ai_proxy_json_request(request: AiProxyJsonRequest) -> Result<AiProxyJsonResponse, String> {
    let client = build_http_client(request.timeout_ms)?;
    let method = request
        .method
        .parse::<reqwest::Method>()
        .map_err(|err| err.to_string())?;

    let builder = apply_common_headers(client.request(method, &request.url), &request.api_key);
    let builder = if let Some(body) = request.body {
        builder.header(CONTENT_TYPE, "application/json").json(&body)
    } else {
        builder
    };

    let response = builder.send().await.map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|err| err.to_string())?;

    Ok(AiProxyJsonResponse { status, body })
}

/**
 * 启动流式 OpenAI-compatible 请求。
 * 请求体在 Rust 侧发送，流数据通过事件回推给前端消费。
 */
#[tauri::command]
pub async fn ai_proxy_start_stream(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, AiProxyState>,
    request: AiProxyStreamRequest,
) -> Result<(), String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .lock()
        .insert(request.request_id.clone(), cancel_flag.clone());

    let request_id = request.request_id.clone();
    let url = request.url.clone();
    let api_key = request.api_key.clone();
    let body = request.body.clone();
    let timeout_ms = request.timeout_ms;

    tauri::async_runtime::spawn(async move {
        let result = async {
            let client = build_http_client(timeout_ms)?;
            let response = apply_common_headers(client.post(&url), &api_key)
                .header(CONTENT_TYPE, "application/json")
                .header(ACCEPT, "text/event-stream")
                .json(&body)
                .send()
                .await
                .map_err(|err| err.to_string())?;

            if !response.status().is_success() {
                let status = response.status().as_u16();
                let body = response.text().await.map_err(|err| err.to_string())?;
                return Err(format!("API 请求失败: {status} {body}"));
            }

            let mut stream = response.bytes_stream();
            loop {
                if cancel_flag.load(Ordering::SeqCst) {
                    return Err("请求已取消".to_string());
                }

                match tokio::time::timeout(Duration::from_millis(250), stream.next()).await {
                    Ok(Some(Ok(bytes))) => {
                        let chunk = String::from_utf8_lossy(&bytes).to_string();
                        window
                            .emit(
                                "ai-proxy-stream-chunk",
                                AiProxyStreamChunkPayload {
                                    request_id: request_id.clone(),
                                    chunk,
                                },
                            )
                            .map_err(|err| err.to_string())?;
                    }
                    Ok(Some(Err(err))) => return Err(err.to_string()),
                    Ok(None) => break,
                    Err(_) => continue,
                }
            }

            Ok::<(), String>(())
        }
        .await;

        if let Some(proxy_state) = app.try_state::<AiProxyState>() {
            proxy_state.cancellations.lock().remove(&request_id);
        }

        match result {
            Ok(()) => {
                let _ = app.emit(
                    "ai-proxy-stream-end",
                    AiProxyStreamEndPayload {
                        request_id: request_id.clone(),
                    },
                );
            }
            Err(error) => {
                let _ = app.emit(
                    "ai-proxy-stream-error",
                    AiProxyStreamErrorPayload {
                        request_id: request_id.clone(),
                        error,
                    },
                );
            }
        }
    });

    Ok(())
}

/**
 * 取消指定的流式请求。
 */
#[tauri::command]
pub fn ai_proxy_cancel_stream(
    state: tauri::State<'_, AiProxyState>,
    request_id: String,
) -> Result<bool, String> {
    if let Some(flag) = state.cancellations.lock().get(&request_id) {
        flag.store(true, Ordering::SeqCst);
        return Ok(true);
    }
    Ok(false)
}
