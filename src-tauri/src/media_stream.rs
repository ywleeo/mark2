use percent_encoding::percent_decode_str;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use tauri::http::{Response, StatusCode};

const HTML_PREVIEW_SCROLLBAR_STYLE: &str = r#"<style data-mark2-preview-style>
html { scrollbar-width: thin !important; scrollbar-color: rgba(127, 127, 127, 0.55) transparent !important; }
html::-webkit-scrollbar,
body::-webkit-scrollbar { width: 6px !important; height: 6px !important; -webkit-appearance: none; }
html::-webkit-scrollbar-track,
body::-webkit-scrollbar-track { background: transparent !important; }
html::-webkit-scrollbar-thumb,
body::-webkit-scrollbar-thumb { background: rgba(127, 127, 127, 0.55) !important; border-radius: 3px !important; }
</style>"#;

/// 从受控的预览参数解析 Editorial 台面色，避免把任意查询内容注入 HTML。
fn html_preview_background(query: Option<&str>) -> Option<&'static str> {
    let query = query.unwrap_or_default();
    let has_editorial_skin = query
        .split('&')
        .any(|part| part == "mark2-preview-skin=editorial");
    if !has_editorial_skin {
        return None;
    }

    let uses_dark_appearance = query
        .split('&')
        .any(|part| part == "mark2-preview-appearance=dark");
    Some(if uses_dark_appearance {
        "#252a26"
    } else {
        "#f3eee4"
    })
}

/// 根据本地文件扩展名返回 stream 协议的响应类型。
fn guess_mime(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".m4a") {
        "audio/mp4"
    } else if lower.ends_with(".flac") {
        "audio/flac"
    } else if lower.ends_with(".aac") {
        "audio/aac"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else if lower.ends_with(".mkv") {
        "video/x-matroska"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else if lower.ends_with(".avi") {
        "video/x-msvideo"
    } else if lower.ends_with(".m4v") {
        "video/x-m4v"
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "text/javascript; charset=utf-8"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".otf") {
        "font/otf"
    } else if lower.ends_with(".xml") {
        "application/xml; charset=utf-8"
    } else if lower.ends_with(".wasm") {
        "application/wasm"
    } else if lower.ends_with(".txt") {
        "text/plain; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

/// 判断本地文件是否应当作为 HTML 预览文档处理。
fn is_html_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm")
}

/// 向 HTML 预览文档注入应用级样式，不修改磁盘上的源文件。
fn inject_html_preview_style(buffer: Vec<u8>, preview_background: Option<&str>) -> Vec<u8> {
    let html = match String::from_utf8(buffer) {
        Ok(html) => html,
        Err(error) => return error.into_bytes(),
    };
    if html.contains("data-mark2-preview-style") {
        return html.into_bytes();
    }

    let lower = html.to_ascii_lowercase();
    let insert_at = lower
        .rfind("</head>")
        .or_else(|| lower.rfind("</html>"))
        .unwrap_or(html.len());
    let skin_style = preview_background.map(|background| {
        format!(
            r#"<style data-mark2-preview-skin-style>html, body {{ background-color: {background} !important; }}</style>"#
        )
    });
    let extra_capacity = skin_style.as_ref().map_or(0, String::len);
    let mut preview_html =
        String::with_capacity(html.len() + HTML_PREVIEW_SCROLLBAR_STYLE.len() + extra_capacity);
    preview_html.push_str(&html[..insert_at]);
    preview_html.push_str(HTML_PREVIEW_SCROLLBAR_STYLE);
    if let Some(skin_style) = skin_style {
        preview_html.push_str(&skin_style);
    }
    preview_html.push_str(&html[insert_at..]);
    preview_html.into_bytes()
}

/// 构造本地媒体或 HTML 文件的 stream 协议响应。
pub fn build_stream_response(
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<tauri::http::Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let raw_path = request.uri().path();
    let decoded_path = percent_decode_str(raw_path).decode_utf8_lossy().to_string();
    let file_path = if cfg!(windows) && decoded_path.starts_with('/') && decoded_path.len() > 2 {
        decoded_path.trim_start_matches('/').to_string()
    } else {
        decoded_path.clone()
    };

    let mut file = File::open(&file_path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let file_size = metadata.len();

    // HTML 预览需要修改完整文档，不能走字节范围响应，否则注入点可能落在分片之外。
    if is_html_path(&file_path) {
        let mut buffer = Vec::with_capacity(file_size as usize);
        file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
        let preview_background = html_preview_background(request.uri().query());
        let buffer = inject_html_preview_style(buffer, preview_background);
        return Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, guess_mime(&file_path))
            .header(CONTENT_LENGTH, buffer.len().to_string())
            .body(buffer)
            .map_err(|e| e.into());
    }

    let mut status = StatusCode::OK;
    let mut start: u64 = 0;
    let mut end: u64 = file_size.saturating_sub(1);

    if let Some(range_header) = request.headers().get(RANGE) {
        if let Ok(range_str) = range_header.to_str() {
            if let Some(range_value) = range_str.strip_prefix("bytes=") {
                let mut parts = range_value.split('-');
                if let Some(start_part) = parts.next() {
                    if !start_part.is_empty() {
                        start = start_part.parse::<u64>().unwrap_or(0);
                    }
                }
                if let Some(end_part) = parts.next() {
                    if !end_part.is_empty() {
                        end = end_part.parse::<u64>().unwrap_or(end);
                    }
                }
                if start >= file_size {
                    start = file_size.saturating_sub(1);
                }
                if end >= file_size {
                    end = file_size.saturating_sub(1);
                }
                if end < start {
                    end = start;
                }
                status = StatusCode::PARTIAL_CONTENT;
            }
        }
    }

    let chunk_size = (end - start + 1) as usize;
    let mut buffer = Vec::with_capacity(chunk_size);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut limited = file.take(chunk_size as u64);
    limited
        .read_to_end(&mut buffer)
        .map_err(|e| e.to_string())?;

    let mut response = Response::builder()
        .status(status)
        .header(CONTENT_TYPE, guess_mime(&file_path))
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_LENGTH, buffer.len().to_string());

    if status == StatusCode::PARTIAL_CONTENT {
        let content_range = format!("bytes {}-{}/{}", start, end, file_size);
        response = response.header(CONTENT_RANGE, content_range);
    }

    response.body(buffer).map_err(|e| e.into())
}

#[cfg(test)]
mod tests {
    use super::{html_preview_background, inject_html_preview_style, HTML_PREVIEW_SCROLLBAR_STYLE};

    /// 样式应插入 head 末尾，确保作用于 iframe 内部的真实滚动容器。
    #[test]
    fn injects_preview_style_before_head_end() {
        let source = b"<!doctype html><html><head><title>x</title></head><body>x</body></html>";
        let result = String::from_utf8(inject_html_preview_style(source.to_vec(), None)).unwrap();

        assert!(result.contains(HTML_PREVIEW_SCROLLBAR_STYLE));
        assert!(
            result.find(HTML_PREVIEW_SCROLLBAR_STYLE).unwrap() < result.find("</head>").unwrap()
        );
    }

    /// 缺少完整 HTML 结构时仍应追加样式，兼容可直接预览的 HTML 片段。
    #[test]
    fn appends_preview_style_to_html_fragment() {
        let source = b"<main>fragment</main>";
        let result = String::from_utf8(inject_html_preview_style(source.to_vec(), None)).unwrap();

        assert!(result.ends_with(HTML_PREVIEW_SCROLLBAR_STYLE));
    }

    /// 已注入文档不应重复追加样式。
    #[test]
    fn does_not_duplicate_preview_style() {
        let source = format!("<html><head>{HTML_PREVIEW_SCROLLBAR_STYLE}</head></html>");
        let result =
            String::from_utf8(inject_html_preview_style(source.clone().into_bytes(), None))
                .unwrap();

        assert_eq!(result, source);
    }

    /// Editorial 预览只覆盖 iframe 台面色，Classic 不注入皮肤背景。
    #[test]
    fn injects_editorial_preview_background_from_controlled_query() {
        assert_eq!(
            html_preview_background(Some(
                "mark2-preview-skin=editorial&mark2-preview-appearance=light"
            )),
            Some("#f3eee4")
        );
        assert_eq!(
            html_preview_background(Some(
                "mark2-preview-skin=editorial&mark2-preview-appearance=dark"
            )),
            Some("#252a26")
        );
        assert_eq!(
            html_preview_background(Some("mark2-preview-skin=classic")),
            None
        );

        let source = b"<html><head></head><body style=\"background:#ddd\">x</body></html>";
        let result =
            String::from_utf8(inject_html_preview_style(source.to_vec(), Some("#f3eee4"))).unwrap();
        assert!(result.contains("html, body { background-color: #f3eee4 !important; }"));
    }
}
