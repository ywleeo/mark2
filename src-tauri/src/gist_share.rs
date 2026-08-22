//! GitHub Gist 分享命令。
//!
//! 该模块只负责把 Markdown 上传为 Secret Gist，不持有设置、不依赖账户或同步模块。

use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;

const GIST_API_URL: &str = "https://api.github.com/gists";
const HTML_PREVIEW_PREFIX: &str = "https://htmlpreview.github.io/?";
const GITHUB_API_VERSION: &str = "2026-03-10";
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// 前端传入的 Gist 分享请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGistShareRequest {
    pub api_key: String,
    pub filename: String,
    pub content: String,
    pub description: String,
}

/// 创建成功后返回给前端的稳定字段。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGistShareResponse {
    pub id: String,
    pub url: String,
}

/// GitHub 创建 Gist 接口的最小响应模型。
#[derive(Debug, Deserialize)]
struct GithubGistResponse {
    id: String,
    files: HashMap<String, GithubGistFile>,
}

/// GitHub Gist 文件响应中的原始内容地址。
#[derive(Debug, Deserialize)]
struct GithubGistFile {
    raw_url: String,
}

/// 将当前 Markdown 创建为一个不公开列出的 Secret Gist。
#[tauri::command]
pub async fn create_gist_share(
    request: CreateGistShareRequest,
) -> Result<CreateGistShareResponse, String> {
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("gist_config: missing GitHub Gist API key".to_string());
    }
    if request.content.trim().is_empty() {
        return Err("gist_content: markdown content is empty".to_string());
    }

    let filename = normalize_filename(&request.filename);
    let mut files = serde_json::Map::new();
    files.insert(filename.clone(), json!({ "content": request.content }));
    let body = json!({
        // Secret Gist 不会出现在公开列表，但持有链接的人仍可访问。
        "public": false,
        "description": request.description.trim(),
        "files": files,
    });

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|error| format!("gist_network: build client: {error}"))?;

    let response = client
        .post(GIST_API_URL)
        .header(AUTHORIZATION, format!("Bearer {api_key}"))
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .header(USER_AGENT, "Mark2-Desktop")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("gist_network: {error}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(format!(
            "gist_auth: GitHub rejected the API key ({status}); verify the Gists write permission"
        ));
    }
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("gist_api: GitHub returned {status}: {detail}"));
    }

    let gist: GithubGistResponse = response
        .json()
        .await
        .map_err(|error| format!("gist_api: invalid GitHub response: {error}"))?;
    let raw_url = gist
        .files
        .get(&filename)
        .or_else(|| gist.files.values().next())
        .map(|file| file.raw_url.clone())
        .ok_or_else(|| "gist_api: GitHub response is missing the shared file URL".to_string())?;

    Ok(CreateGistShareResponse {
        id: gist.id,
        url: format!("{HTML_PREVIEW_PREFIX}{raw_url}"),
    })
}

/// 清理文件名中的路径和非法字符，并保证文件使用 HTML 扩展名。
fn normalize_filename(filename: &str) -> String {
    let cleaned: String = filename
        .trim()
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let base = if cleaned.is_empty() {
        "untitled".to_string()
    } else {
        cleaned
    };
    if base.to_lowercase().ends_with(".html") {
        base
    } else {
        format!("{base}.html")
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_filename;

    /// 文件名清理必须阻止路径注入并补齐 Markdown 扩展名。
    #[test]
    fn normalizes_gist_filename() {
        assert_eq!(normalize_filename("notes"), "notes.html");
        assert_eq!(normalize_filename("folder/notes.html"), "folder_notes.html");
        assert_eq!(normalize_filename("  "), "untitled.html");
    }
}
