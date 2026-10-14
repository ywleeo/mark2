use futures_util::StreamExt;
use parking_lot::Mutex;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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
    pub idle_timeout_ms: Option<u64>,
}

/** 等待下一次网络活动；每次调用重新开始计时，不限制整个生成的时长。 */
async fn wait_for_activity<F: Future>(
    future: F,
    idle_timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<F::Output, String> {
    if cancelled.load(Ordering::SeqCst) {
        return Err("请求已取消".to_string());
    }
    tokio::pin!(future);
    let deadline = tokio::time::sleep(idle_timeout);
    tokio::pin!(deadline);
    let mut cancel_tick = tokio::time::interval(Duration::from_millis(250));
    cancel_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            result = &mut future => return Ok(result),
            _ = &mut deadline => return Err("AI_IDLE_TIMEOUT: no response data received".to_string()),
            _ = cancel_tick.tick() => {
                if cancelled.load(Ordering::SeqCst) {
                    return Err("请求已取消".to_string());
                }
            }
        }
    }
}

/** 保留跨网络块的未完成 UTF-8 字节，避免中文工具参数被替换为乱码。 */
#[derive(Default)]
struct StreamTextDecoder {
    pending: Vec<u8>,
}

impl StreamTextDecoder {
    /** 解码完整字符，末尾不足一个字符的字节留待下一块。 */
    fn push(&mut self, bytes: &[u8]) -> Result<String, String> {
        self.pending.extend_from_slice(bytes);
        let valid_length = match std::str::from_utf8(&self.pending) {
            Ok(_) => self.pending.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => return Err("AI_RESPONSE_INCOMPLETE: invalid UTF-8 stream".to_string()),
        };
        let text = std::str::from_utf8(&self.pending[..valid_length])
            .map_err(|_| "AI_RESPONSE_INCOMPLETE: invalid UTF-8 stream".to_string())?
            .to_owned();
        self.pending.drain(..valid_length);
        Ok(text)
    }

    /** 流结束时仍有残缺字节则报告中断，不静默损坏模型内容。 */
    fn finish(&self) -> Result<(), String> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err("AI_RESPONSE_INCOMPLETE: truncated UTF-8 stream".to_string())
        }
    }
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
 * 创建非流式请求使用的 reqwest client。
 * 这里显式带上浏览器风格 UA，兼容对非浏览器请求敏感的 OpenAI-compatible 服务。
 * 非流式请求保留 3 分钟总超时。
 */
fn build_json_http_client(timeout_ms: Option<u64>) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(180_000)))
        .build()
        .map_err(|err| err.to_string())
}

/**
 * 创建流式请求使用的 reqwest client。
 * 只限制连接阶段，不对整个 body 读取设置总超时，
 * 避免 provider 长时间思考时被底层 body timeout 提前打断。
 */
fn build_stream_http_client(timeout_ms: Option<u64>) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(timeout_ms.unwrap_or(180_000)))
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
pub async fn ai_proxy_json_request(
    request: AiProxyJsonRequest,
) -> Result<AiProxyJsonResponse, String> {
    let client = build_json_http_client(request.timeout_ms)?;
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
    let idle_timeout = Duration::from_millis(
        request
            .idle_timeout_ms
            .or(request.timeout_ms)
            .unwrap_or(180_000)
            .max(1),
    );
    tauri::async_runtime::spawn(async move {
        let result = async {
            let client = build_stream_http_client(request.timeout_ms)?;
            let builder = apply_common_headers(client.post(&url), &api_key)
                .header(CONTENT_TYPE, "application/json")
                .header(ACCEPT, "text/event-stream")
                .json(&body);
            let response = wait_for_activity(builder.send(), idle_timeout, &cancel_flag)
                .await?
                .map_err(|err| err.to_string())?;
            let status = response.status();
            let mut stream = response.bytes_stream();
            let mut decoder = StreamTextDecoder::default();
            let mut error_body = String::new();
            loop {
                match wait_for_activity(stream.next(), idle_timeout, &cancel_flag).await? {
                    Some(Ok(bytes)) => {
                        let chunk = decoder.push(&bytes)?;
                        if !status.is_success() {
                            error_body.push_str(&chunk);
                            continue;
                        }
                        if chunk.is_empty() {
                            continue;
                        }
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
                    Some(Err(err)) => return Err(err.to_string()),
                    None => break,
                }
            }
            decoder.finish()?;
            if !status.is_success() {
                return Err(format!("API 请求失败: {} {error_body}", status.as_u16()));
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

/** 用虚拟时间验证无响应超时，不依赖真实网络或机器负载。 */
#[cfg(test)]
mod tests {
    use super::{wait_for_activity, StreamTextDecoder};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    /** 每包都有进展时，总时长超过 idle 窗口仍能继续。 */
    #[tokio::test(start_paused = true)]
    async fn active_stream_can_outlast_idle_timeout() {
        let cancelled = AtomicBool::new(false);
        let started = tokio::time::Instant::now();
        for _ in 0..6 {
            assert!(wait_for_activity(
                async {
                    tokio::time::sleep(Duration::from_millis(60)).await;
                    true
                },
                Duration::from_millis(100),
                &cancelled,
            )
            .await
            .unwrap());
        }
        assert!(started.elapsed() >= Duration::from_millis(360));
    }

    /** 首包和后续读取都只在连续无数据达到阈值时结束。 */
    #[tokio::test(start_paused = true)]
    async fn stalled_request_times_out_after_last_activity() {
        let cancelled = AtomicBool::new(false);
        wait_for_activity(
            tokio::time::sleep(Duration::from_millis(60)),
            Duration::from_millis(100),
            &cancelled,
        )
        .await
        .unwrap();
        let last_activity = tokio::time::Instant::now();
        let error = wait_for_activity(
            std::future::pending::<()>(),
            Duration::from_millis(100),
            &cancelled,
        )
        .await
        .unwrap_err();
        assert!(error.contains("AI_IDLE_TIMEOUT"));
        assert_eq!(last_activity.elapsed(), Duration::from_millis(100));
    }

    /** 等待首包时也能取消，不必等待长时间 idle deadline。 */
    #[tokio::test(start_paused = true)]
    async fn cancel_interrupts_a_silent_connection() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            flag.store(true, Ordering::SeqCst);
        });
        let started = tokio::time::Instant::now();
        let error = wait_for_activity(
            std::future::pending::<()>(),
            Duration::from_secs(90),
            &cancelled,
        )
        .await
        .unwrap_err();
        assert_eq!(error, "请求已取消");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    /** 心跳、中文和 emoji 在任意字节边界都逐字还原。 */
    #[test]
    fn utf8_fragments_are_lossless() {
        let source = ": heartbeat\n\ndata: {\"text\":\"中文🌲\"}\n\n";
        let mut decoder = StreamTextDecoder::default();
        let mut decoded = String::new();
        for byte in source.as_bytes() {
            decoded.push_str(&decoder.push(&[*byte]).unwrap());
        }
        decoder.finish().unwrap();
        assert_eq!(decoded, source);
    }

    /** 残缺字节不能以替代字符混入工具参数。 */
    #[test]
    fn truncated_utf8_is_reported() {
        let mut decoder = StreamTextDecoder::default();
        assert_eq!(decoder.push(&[0xe4, 0xb8]).unwrap(), "");
        assert!(decoder
            .finish()
            .unwrap_err()
            .contains("AI_RESPONSE_INCOMPLETE"));
    }
}
