use base64::engine::general_purpose::STANDARD as BASE64_ENGINE;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default = "default_timeout_ms")]
    pub request_timeout_ms: u64,
    #[serde(default = "default_requests_per_minute")]
    pub max_requests_per_minute: u32,
    #[serde(default = "default_concurrent_requests")]
    pub max_concurrent_requests: u32,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub fast_model: Option<String>,
    #[serde(default)]
    pub think_model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiConfigSnapshot {
    pub model: String,
    pub base_url: Option<String>,
    pub request_timeout_ms: u64,
    pub max_requests_per_minute: u32,
    pub max_concurrent_requests: u32,
    pub temperature: f32,
    pub stream: bool,
    pub has_api_key: bool,
    pub fast_model: Option<String>,
    pub think_model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiConfigUpdate {
    pub model: String,
    pub base_url: Option<String>,
    #[serde(default = "default_timeout_ms")]
    pub request_timeout_ms: u64,
    #[serde(default = "default_requests_per_minute")]
    pub max_requests_per_minute: u32,
    #[serde(default = "default_concurrent_requests")]
    pub max_concurrent_requests: u32,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub keep_existing_api_key: bool,
    #[serde(default)]
    pub fast_model: Option<String>,
    #[serde(default)]
    pub think_model: Option<String>,
}

fn default_model() -> String {
    "gpt-4o-mini".to_string()
}

fn default_timeout_ms() -> u64 {
    60_000
}

fn default_requests_per_minute() -> u32 {
    20
}

fn default_concurrent_requests() -> u32 {
    2
}

fn default_temperature() -> f32 {
    0.7
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            model: default_model(),
            api_key: None,
            base_url: None,
            request_timeout_ms: default_timeout_ms(),
            max_requests_per_minute: default_requests_per_minute(),
            max_concurrent_requests: default_concurrent_requests(),
            temperature: default_temperature(),
            stream: true,
            fast_model: None,
            think_model: None,
        }
    }
}

impl From<&AiConfig> for AiConfigSnapshot {
    fn from(value: &AiConfig) -> Self {
        Self {
            model: value.model.clone(),
            base_url: value.base_url.clone(),
            request_timeout_ms: value.request_timeout_ms,
            max_requests_per_minute: value.max_requests_per_minute,
            max_concurrent_requests: value.max_concurrent_requests,
            temperature: value.temperature,
            stream: value.stream,
            has_api_key: value.api_key.as_ref().map(|s| !s.is_empty()).unwrap_or(false),
            fast_model: value.fast_model.clone(),
            think_model: value.think_model.clone(),
        }
    }
}

impl AiConfig {
    pub fn apply_update(&mut self, update: AiConfigUpdate) {
        self.model = update.model;
        self.base_url = update.base_url.filter(|s| !s.trim().is_empty());
        self.request_timeout_ms = update.request_timeout_ms;
        self.max_requests_per_minute = update.max_requests_per_minute;
        self.max_concurrent_requests = update.max_concurrent_requests.max(1);
        self.temperature = update.temperature.clamp(0.0, 2.0);
        self.stream = update.stream;
        self.fast_model = update.fast_model.filter(|s| !s.trim().is_empty());
        self.think_model = update.think_model.filter(|s| !s.trim().is_empty());

        if update.keep_existing_api_key && update.api_key.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true) {
            // do nothing, keep existing key
        } else {
            self.api_key = update
                .api_key
                .and_then(|value| {
                    let trimmed = value.trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    }
                });
        }
    }

    /// 根据任务类型选择合适的模型
    pub fn get_model_for_task(&self, task_type: &str) -> String {
        match task_type {
            "fast" => self.fast_model.clone().unwrap_or_else(|| self.model.clone()),
            "think" => self.think_model.clone().unwrap_or_else(|| self.model.clone()),
            _ => self.model.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredAiConfig {
    #[serde(default = "default_model")]
    model: String,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default = "default_timeout_ms")]
    request_timeout_ms: u64,
    #[serde(default = "default_requests_per_minute")]
    max_requests_per_minute: u32,
    #[serde(default = "default_concurrent_requests")]
    max_concurrent_requests: u32,
    #[serde(default = "default_temperature")]
    temperature: f32,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    fast_model: Option<String>,
    #[serde(default)]
    think_model: Option<String>,
}

impl From<AiConfig> for StoredAiConfig {
    fn from(value: AiConfig) -> Self {
        let AiConfig {
            model,
            api_key,
            base_url,
            request_timeout_ms,
            max_requests_per_minute,
            max_concurrent_requests,
            temperature,
            stream,
            fast_model,
            think_model,
        } = value;

        let encoded_key = api_key
            .map(|plain| BASE64_ENGINE.encode(plain.as_bytes()));

        Self {
            model,
            api_key: encoded_key,
            base_url,
            request_timeout_ms,
            max_requests_per_minute,
            max_concurrent_requests,
            temperature,
            stream,
            fast_model,
            think_model,
        }
    }
}

impl From<StoredAiConfig> for AiConfig {
    fn from(value: StoredAiConfig) -> Self {
        let decoded_key = value.api_key.and_then(|encoded| {
            BASE64_ENGINE
                .decode(encoded.as_bytes())
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
        });

        Self {
            model: value.model,
            api_key: decoded_key,
            base_url: value.base_url,
            request_timeout_ms: value.request_timeout_ms,
            max_requests_per_minute: value.max_requests_per_minute,
            max_concurrent_requests: value.max_concurrent_requests,
            temperature: value.temperature,
            stream: value.stream,
            fast_model: value.fast_model,
            think_model: value.think_model,
        }
    }
}

pub fn load_config(path: &Path) -> Result<AiConfig, String> {
    if !path.exists() {
        return Ok(AiConfig::default());
    }

    let contents = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let stored: StoredAiConfig =
        serde_json::from_str(&contents).map_err(|err| format!("解析 AI 配置失败: {}", err))?;
    Ok(stored.into())
}

pub fn save_config(path: &Path, config: &AiConfig) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        if !dir.exists() {
            fs::create_dir_all(dir).map_err(|err| err.to_string())?;
        }
    }

    let stored: StoredAiConfig = config.clone().into();
    let contents = serde_json::to_string_pretty(&stored)
        .map_err(|err| format!("序列化 AI 配置失败: {}", err))?;

    fs::write(path, contents).map_err(|err| err.to_string())
}
