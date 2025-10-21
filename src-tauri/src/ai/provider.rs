use crate::ai::AiConfig;
use futures_util::StreamExt;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct AiExecuteRequest {
    pub prompt: String,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AiExecutionResult {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AiStreamUpdate {
    pub content_delta: Option<String>,
    pub reasoning_delta: Option<String>,
    pub role: Option<String>,
    pub finish_reason: Option<String>,
}

pub async fn execute(
    request: AiExecuteRequest,
    config: &AiConfig,
) -> Result<AiExecutionResult, String> {
    let api_key = config
        .api_key
        .clone()
        .ok_or_else(|| "AI API Key 未配置".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.request_timeout_ms))
        .build()
        .map_err(|err| format!("创建 HTTP 客户端失败: {}", err))?;

    let base_url = config
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".to_string());

    let messages = build_chat_messages(
        request.prompt.as_str(),
        request.context.as_deref(),
        request.system_prompt.as_deref(),
        request.mode.as_deref(),
    );

    let payload = json!({
        "model": config.model,
        "messages": messages,
        "temperature": config.temperature,
        "stream": false,
    });

    let response = client
        .post(&base_url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("请求 AI 服务失败: {}", err))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("AI 服务认证失败，请检查 API Key 是否正确".to_string());
    }

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let human_message = extract_error_message(&body);
        let hint = build_hint(status.as_u16(), &base_url);

        let mut segments = vec![
            format!("AI 服务返回错误 (status {})", status.as_u16()),
        ];

        if !human_message.is_empty() {
            segments.push(format!("原因: {}", human_message));
        }

        if let Some(hint) = hint {
            segments.push(format!("提示: {}", hint));
        }

        if body.trim().is_empty() {
            segments.push("响应正文为空".into());
        } else if human_message.is_empty() {
            segments.push(format!("原始响应: {}", truncate_body(&body)));
        }

        segments.push(format!("请求信息: model = {}, base_url = {}", config.model, base_url));

        return Err(segments.join("；"));
    }

    let parsed: OpenAiResponse = response
        .json()
        .await
        .map_err(|err| format!("解析 AI 响应失败: {}", err))?;

    let content = parsed
        .choices
        .into_iter()
        .find_map(|choice| choice.message.content)
        .unwrap_or_default()
        .trim()
        .to_string();

    Ok(AiExecutionResult {
        content,
        reasoning: None,
    })
}

pub async fn execute_stream<F>(
    request: AiExecuteRequest,
    config: &AiConfig,
    mut on_update: F,
) -> Result<AiExecutionResult, String>
where
    F: FnMut(AiStreamUpdate) -> Result<(), String>,
{
    let api_key = config
        .api_key
        .clone()
        .ok_or_else(|| "AI API Key 未配置".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.request_timeout_ms))
        .build()
        .map_err(|err| format!("创建 HTTP 客户端失败: {}", err))?;

    let base_url = config
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".to_string());

    let messages = build_chat_messages(
        request.prompt.as_str(),
        request.context.as_deref(),
        request.system_prompt.as_deref(),
        request.mode.as_deref(),
    );

    let payload = json!({
        "model": config.model,
        "messages": messages,
        "temperature": config.temperature,
        "stream": true,
    });

    let response = client
        .post(&base_url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("请求 AI 服务失败: {}", err))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("AI 服务认证失败，请检查 API Key 是否正确".to_string());
    }

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let human_message = extract_error_message(&body);
        let hint = build_hint(status.as_u16(), &base_url);

        let mut segments = vec![
            format!("AI 服务返回错误 (status {})", status.as_u16()),
        ];

        if !human_message.is_empty() {
            segments.push(format!("原因: {}", human_message));
        }

        if let Some(hint) = hint {
            segments.push(format!("提示: {}", hint));
        }

        if body.trim().is_empty() {
            segments.push("响应正文为空".into());
        } else if human_message.is_empty() {
            segments.push(format!("原始响应: {}", truncate_body(&body)));
        }

        segments.push(format!("请求信息: model = {}, base_url = {}", config.model, base_url));
        return Err(segments.join("；"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut finished = false;

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|err| format!("AI 服务流式响应失败: {}", err))?;
        let chunk = std::str::from_utf8(&bytes)
            .map_err(|err| format!("AI 服务返回了无效的 UTF-8 数据: {}", err))?;

        buffer.push_str(&chunk.replace("\r\n", "\n"));

        while let Some(index) = buffer.find("\n\n") {
            let mut raw_event = buffer[..index].to_string();
            buffer.drain(..index + 2);

            raw_event = raw_event.trim().to_string();
            if raw_event.is_empty() {
                continue;
            }

            let mut data_lines = String::new();
            for line in raw_event.lines() {
                if let Some(payload) = line.strip_prefix("data:") {
                    if !data_lines.is_empty() {
                        data_lines.push('\n');
                    }
                    data_lines.push_str(payload.trim_start());
                }
            }

            let data = data_lines.trim();
            if data.is_empty() {
                continue;
            }

            if data == "[DONE]" {
                finished = true;
                break;
            }

            let parsed: ChatStreamResponse = serde_json::from_str(data)
                .map_err(|err| format!("解析 AI 流式响应失败: {}", err))?;

            for choice in parsed.choices {
                let ChatStreamChoice {
                    mut delta,
                    finish_reason,
                } = choice;
                if let Some(ref segment) = delta.content {
                    content.push_str(segment);
                }
                if let Some(ref reasoning_segment) = delta.reasoning_content {
                    reasoning.push_str(reasoning_segment);
                }

                on_update(AiStreamUpdate {
                    content_delta: delta.content.take(),
                    reasoning_delta: delta.reasoning_content.take(),
                    role: delta.role.take(),
                    finish_reason,
                })?;
            }
        }

        if finished {
            break;
        }
    }

    let reasoning_trimmed = reasoning.trim();

    Ok(AiExecutionResult {
        content: content.trim().to_string(),
        reasoning: if reasoning_trimmed.is_empty() {
            None
        } else {
            Some(reasoning_trimmed.to_string())
        },
    })
}

fn build_chat_messages(
    prompt: &str,
    context: Option<&str>,
    system_prompt: Option<&str>,
    mode: Option<&str>,
) -> Vec<serde_json::Value> {
    let mut messages = vec![];

    let system_prompt = system_prompt
        .map(|prompt| prompt.to_string())
        .unwrap_or_else(|| default_system_prompt(mode.unwrap_or("default")));

    messages.push(json!({
        "role": "system",
        "content": system_prompt
    }));

    if let Some(context) = context {
        let trimmed = context.trim();
        if !trimmed.is_empty() {
            messages.push(json!({
                "role": "user",
                "content": format!("下面是补充上下文，请在处理后续指令时予以考虑：\n\n{}", trimmed)
            }));
        }
    }

    messages.push(json!({
        "role": "user",
        "content": prompt
    }));

    messages
}

fn default_system_prompt(mode: &str) -> String {
    match mode {
        "rewrite" => "你是一名专业的中文写作助手，擅长保持原文含义的同时润色语句、优化结构。严格保留 Markdown 格式和代码块。".to_string(),
        "summarize" => "你是一名熟练的摘要助手，请在尽量保留核心信息的前提下生成中文摘要。保持 Markdown 结构。".to_string(),
        "extend" => "你是一名创意写作助手，请在保持语气风格一致的前提下续写内容。保持 Markdown 结构。".to_string(),
        _ => "你是一名合作式的写作伙伴，请使用中文回答，保留输入中的 Markdown 结构，并在需要时提供简短解释。".to_string(),
    }
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatStreamResponse {
    choices: Vec<ChatStreamChoice>,
}

#[derive(Debug, Deserialize, Default)]
struct ChatStreamChoice {
    #[serde(default)]
    delta: ChatStreamDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct ChatStreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    role: Option<String>,
}

fn extract_error_message(body: &str) -> String {
    if body.trim().is_empty() {
        return String::new();
    }
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(message) = json
            .get("error")
            .and_then(|err| err.get("message"))
            .and_then(|m| m.as_str())
        {
            return message.trim().to_string();
        }
    }
    if body.len() <= 400 {
        body.trim().to_string()
    } else {
        truncate_body(body)
    }
}

fn truncate_body(body: &str) -> String {
    const MAX_LEN: usize = 400;
    if body.len() <= MAX_LEN {
        body.trim().to_string()
    } else {
        let mut truncated = body[..MAX_LEN].to_string();
        truncated.push_str("...");
        truncated
    }
}

fn build_hint(status: u16, base_url: &str) -> Option<String> {
    match status {
        401 => Some("请检查 API Key 是否有效或是否已配置".into()),
        404 => {
            let mut hint = "返回 404，可能是 Base URL 路径不正确或服务不兼容".to_string();
            if !base_url.contains("/chat/completions") {
                hint.push_str("；默认路径应包含 /v1/chat/completions");
            }
            Some(hint)
        }
        429 => Some("被限流，请降低请求频率或调整速率限制".into()),
        500..=599 => Some("服务端异常，可稍后重试".into()),
        _ => None,
    }
}
