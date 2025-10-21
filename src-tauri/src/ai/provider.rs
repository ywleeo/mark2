use crate::ai::AiConfig;
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

    let AiExecuteRequest {
        prompt,
        context,
        system_prompt,
        mode,
    } = request;

    let mut messages = vec![];

    let system_prompt = system_prompt.unwrap_or_else(|| {
        default_system_prompt(mode.as_deref().unwrap_or("default"))
    });

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

    Ok(AiExecutionResult { content })
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
