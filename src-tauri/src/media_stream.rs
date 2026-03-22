use percent_encoding::percent_decode_str;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use tauri::http::{Response, StatusCode};

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
    } else {
        "application/octet-stream"
    }
}

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
