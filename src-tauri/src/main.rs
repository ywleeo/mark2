// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod macos_security;

mod pty;

use base64::Engine;
use calamine::{open_workbook_auto, Data, Reader};
use font_kit::source::SystemSource;
use percent_encoding::percent_decode_str;
use std::fs;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::async_runtime;
use tauri::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use tauri::http::{Response, StatusCode};
use tauri::menu::*;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel, NSPasteboard};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSString, NSURL};
#[cfg(target_os = "macos")]

use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use crate::macos_security::{
    create_bookmark_for_path, create_security_scoped_bookmark, move_path_to_trash,
    start_access_from_bookmark, url_path,
};

#[derive(Serialize)]
struct FileMetadata {
    modified_time: u64, // Unix timestamp in seconds
}

#[derive(Serialize)]
struct SpreadsheetSheet {
    name: String,
    rows: Vec<Vec<String>>,
}

#[derive(Serialize)]
struct SpreadsheetData {
    sheets: Vec<SpreadsheetSheet>,
}

#[derive(Clone, Serialize)]
struct PlainPastePayload {
    text: String,
}

struct ExportMenuHandles {
    image: MenuItem<Wry>,
    pdf: MenuItem<Wry>,
}

struct ExportMenuState {
    handles: Mutex<ExportMenuHandles>,
}

impl ExportMenuState {
    fn new(
        image: MenuItem<Wry>,
        pdf: MenuItem<Wry>,
    ) -> Self {
        Self {
            handles: Mutex::new(ExportMenuHandles {
                image,
                pdf,
            }),
        }
    }
}


struct RecentMenuState {
    submenu: Mutex<Submenu<Wry>>,
    app_handle: Mutex<Option<tauri::AppHandle>>,
    current_items: Mutex<Vec<MenuItem<Wry>>>,
    separator: Mutex<Option<PredefinedMenuItem<Wry>>>,
    clear_item: Mutex<Option<MenuItem<Wry>>>,
}

#[derive(Clone, Serialize)]
struct OpenedFilesPayload {
    paths: Vec<String>,
}

#[derive(Default)]
struct OpenedFilesState {
    paths: Mutex<Vec<String>>,
}

impl RecentMenuState {
    fn new(submenu: Submenu<Wry>) -> Self {
        Self {
            submenu: Mutex::new(submenu),
            app_handle: Mutex::new(None),
            current_items: Mutex::new(Vec::new()),
            separator: Mutex::new(None),
            clear_item: Mutex::new(None),
        }
    }

    fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut app_handle) = self.app_handle.lock() {
            *app_handle = Some(handle);
        }
    }
}

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

fn build_stream_response(
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<tauri::http::Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let raw_path = request.uri().path();
    let decoded_path = percent_decode_str(raw_path).decode_utf8_lossy().to_string();
    let file_path = if cfg!(windows) && decoded_path.starts_with('/') && decoded_path.len() > 2 {
        // 处理形如 /C:/path 的情况
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

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContextPayload {
    pub current_file: Option<String>,
    pub current_directory: Option<String>,
    pub workspace_roots: Vec<String>,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshotPayload {
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub total_lines: Option<u32>,
    pub updated_at: Option<u64>,
}

#[derive(Default)]
pub struct WorkspaceState(pub Mutex<WorkspaceContextPayload>);

#[derive(Default)]
pub struct DocumentState(pub Mutex<DocumentSnapshotPayload>);

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileDialogOptions {
    directory: Option<bool>,
    multiple: Option<bool>,
    allow_directories: Option<bool>,
    allow_files: Option<bool>,
    default_path: Option<String>,
    title: Option<String>,
    message: Option<String>,
    prompt: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedPathEntry {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    bookmark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_directory: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecurityScopedBookmarkEntry {
    path: Option<String>,
    bookmark: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityScopeResult {
    requested_path: Option<String>,
    resolved_path: Option<String>,
    granted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
fn open_path_in_browser(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn is_directory(path: String) -> Result<bool, String> {
    Path::new(&path)
        .metadata()
        .map(|m| m.is_dir())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    let modified_time = modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    Ok(FileMetadata { modified_time })
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn encode_file_base64(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    Ok(encoded)
}

#[tauri::command]
fn read_image_base64(path: String) -> Result<String, String> {
    encode_file_base64(&path)
}

#[tauri::command]
fn read_binary_base64(path: String) -> Result<String, String> {
    encode_file_base64(&path)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    use objc2::rc::autoreleasepool;
    use objc2::ClassType;
    use objc2_foundation::NSArray;
    use crate::macos_security::nsstring_to_string;

    unsafe {
        autoreleasepool(|_| {
            // 获取通用剪贴板
            let pasteboard = NSPasteboard::generalPasteboard();

            // 检查剪贴板是否包含文件 URL
            let types = pasteboard.types();
            if types.is_none() {
                return Ok(Vec::new());
            }

            // 创建类数组
            let classes = NSArray::from_slice(&[NSURL::class()]);

            // 读取文件 URL
            let urls = pasteboard.readObjectsForClasses_options(&classes, None);

            if let Some(urls) = urls {
                let mut file_paths = Vec::new();

                // 遍历 NSArray
                let count = urls.len();
                for i in 0..count {
                    let url = urls.objectAtIndex(i);

                    // 将 AnyObject 转换为 NSURL 指针
                    let url_ref = &*(&*url as *const _ as *const NSURL);

                    // 检查是否是文件 URL
                    if url_ref.isFileURL() {
                        if let Some(path) = url_ref.path() {
                            file_paths.push(nsstring_to_string(&path));
                        }
                    }
                }

                Ok(file_paths)
            } else {
                Ok(Vec::new())
            }
        })
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    Err("此功能仅在 macOS 上可用".to_string())
}

fn data_type_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        _ => cell.to_string(),
    }
}

#[tauri::command]
fn read_spreadsheet(path: String) -> Result<SpreadsheetData, String> {
    let mut workbook = open_workbook_auto(&path).map_err(|e| e.to_string())?;
    let sheet_names = workbook.sheet_names().to_owned();

    if sheet_names.is_empty() {
        return Err("工作簿中没有可用的工作表".to_string());
    }

    let mut sheets = Vec::new();

    for sheet_name in sheet_names {
        match workbook.worksheet_range(&sheet_name) {
            Ok(range) => {
                let rows = range
                    .rows()
                    .map(|row| row.iter().map(data_type_to_string).collect())
                    .collect();
                sheets.push(SpreadsheetSheet {
                    name: sheet_name,
                    rows,
                });
            }
            Err(err) => {
                return Err(format!("读取工作表 {} 失败: {}", sheet_name, err));
            }
        }
    }

    if sheets.is_empty() {
        return Err("未能从工作簿中读取任何数据".to_string());
    }

    Ok(SpreadsheetData { sheets })
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            entry
                .ok()
                .and_then(|e| e.path().to_str().map(|s| s.to_string()))
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        move_path_to_trash(&path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_entry(source: String, destination: String) -> Result<(), String> {
    let target_path = Path::new(&destination);
    if let Some(parent) = target_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::rename(&source, &destination).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn ipc_health_check() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn update_workspace_context(
    state: tauri::State<'_, WorkspaceState>,
    context: WorkspaceContextPayload,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|err| format!("workspace context lock poisoned: {err}"))?;
    *guard = context;
    Ok(())
}

#[tauri::command]
fn update_document_snapshot(
    state: tauri::State<'_, DocumentState>,
    snapshot: DocumentSnapshotPayload,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|err| format!("document snapshot lock poisoned: {err}"))?;
    *guard = snapshot;
    Ok(())
}

#[tauri::command]
fn pick_path(
    app: tauri::AppHandle,
    options: Option<FileDialogOptions>,
) -> Result<Vec<PickedPathEntry>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;

        let opts = options.unwrap_or_default();
        let wants_directories = opts.directory.unwrap_or(false);
        let allow_directories = opts.allow_directories.unwrap_or(true);
        let allow_files = {
            let allow_files_opt = opts.allow_files.unwrap_or(!wants_directories);
            if !allow_directories && !allow_files_opt {
                true
            } else {
                allow_files_opt
            }
        };
        let allow_multiple = opts.multiple.unwrap_or(true);
        let treat_default_path_as_directory = wants_directories || (!allow_files && allow_directories);

        let default_path = opts.default_path.clone();
        let title = opts.title.clone();
        let message = opts.message.clone();
        let prompt = opts.prompt.clone();
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let picker_result = autoreleasepool(|_| {
                let mtm = MainThreadMarker::new().expect("pick_path must run on main thread");
                let panel = NSOpenPanel::openPanel(mtm);
                panel.setAllowsMultipleSelection(allow_multiple);
                panel.setCanChooseDirectories(allow_directories);
                panel.setCanChooseFiles(allow_files);
                panel.setCanCreateDirectories(true);

                // 设置标题
                if let Some(title_str) = title {
                    let ns_title = NSString::from_str(&title_str);
                    panel.setTitle(Some(&ns_title));
                }

                // 设置提示信息
                if let Some(message_str) = message {
                    let ns_message = NSString::from_str(&message_str);
                    panel.setMessage(Some(&ns_message));
                }

                if let Some(prompt_str) = prompt {
                    let ns_prompt = NSString::from_str(&prompt_str);
                    panel.setPrompt(Some(&ns_prompt));
                }

                // 设置默认路径
                if let Some(path_str) = default_path {
                    let path = Path::new(&path_str);
                    let directory_to_open = if treat_default_path_as_directory {
                        path
                    } else {
                        path.parent().unwrap_or(path)
                    };

                    // 尝试设置目录和文件名（即使文件在沙盒外也能定位）
                    if let Some(dir_str) = directory_to_open.to_str() {
                        let ns_parent = NSString::from_str(dir_str);
                        let parent_url = NSURL::fileURLWithPath(&ns_parent);
                        panel.setDirectoryURL(Some(&parent_url));
                    }

                    // 设置文件名（在文件选择器中预填）
                    if !treat_default_path_as_directory {
                        if let Some(filename) = path.file_name() {
                            if let Some(filename_str) = filename.to_str() {
                                let ns_filename = NSString::from_str(filename_str);
                                panel.setNameFieldStringValue(&ns_filename);
                            }
                        }
                    }
                }

                if panel.runModal() != NSModalResponseOK {
                    return Ok(Vec::new());
                }

                let urls = panel.URLs();
                let mut entries = Vec::new();
                for idx in 0..urls.count() {
                    let url = urls.objectAtIndex(idx);
                    if let Some(path) = url_path(&url) {
                        let bookmark = create_security_scoped_bookmark(&url).ok();
                        let started = unsafe { url.startAccessingSecurityScopedResource() };
                        if !started {
                            eprintln!("failed to start security scoped resource for {}", path);
                        }
                        let is_directory = url.hasDirectoryPath();
                        entries.push(PickedPathEntry {
                            path,
                            bookmark,
                            is_directory: Some(is_directory),
                        });
                    }
                }

                Ok(entries)
            });

            let _ = tx.send(picker_result);
        })
        .map_err(|e| e.to_string())?;

        rx.recv().map_err(|e| e.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("unsupported".to_string())
    }
}

#[tauri::command]
fn restore_security_scoped_access(
    entries: Vec<SecurityScopedBookmarkEntry>,
) -> Result<Vec<SecurityScopeResult>, String> {
    #[cfg(target_os = "macos")]
    {
        let mut results = Vec::new();
        for entry in entries {
            match start_access_from_bookmark(&entry.bookmark) {
                Ok(resolved_path) => results.push(SecurityScopeResult {
                    requested_path: entry.path,
                    resolved_path: Some(resolved_path),
                    granted: true,
                    error: None,
                }),
                Err(err) => results.push(SecurityScopeResult {
                    requested_path: entry.path,
                    resolved_path: None,
                    granted: false,
                    error: Some(err),
                }),
            }
        }

        Ok(results)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(entries
            .into_iter()
            .map(|entry| SecurityScopeResult {
                requested_path: entry.path.clone(),
                resolved_path: entry.path,
                granted: true,
                error: None,
            })
            .collect())
    }
}

#[tauri::command]
fn capture_security_scope(path: String) -> Result<PickedPathEntry, String> {
    #[cfg(target_os = "macos")]
    {
        let (bookmark, is_directory) = create_bookmark_for_path(&path)?;
        Ok(PickedPathEntry {
            path,
            bookmark: Some(bookmark),
            is_directory: Some(is_directory),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("unsupported".to_string())
    }
}

fn register_plain_paste_shortcut(app_handle: &AppHandle) {
    #[cfg(target_os = "macos")]
    let shortcut = "Cmd+Shift+V";
    #[cfg(not(target_os = "macos"))]
    let shortcut = "Ctrl+Shift+V";

    let result =
        app_handle
            .global_shortcut()
            .on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                let emit_handle = app.clone();
                let clipboard_handle = app.clone();
                async_runtime::spawn(async move {
                    let read_result = async_runtime::spawn_blocking(move || {
                        clipboard_handle.clipboard().read_text()
                    })
                    .await;
                    match read_result {
                        Ok(Ok(text)) => {
                            if text.is_empty() {
                                return;
                            }
                            if let Some(window) = emit_handle.get_webview_window("main") {
                                if let Err(err) =
                                    window.emit("plain-paste", PlainPastePayload { text })
                                {
                                    eprintln!("Failed to emit plain paste event: {:?}", err);
                                }
                            }
                        }
                        Ok(Err(err)) => {
                            eprintln!("Failed to read clipboard: {:?}", err);
                        }
                        Err(err) => {
                            eprintln!("Clipboard task join error: {:?}", err);
                        }
                    }
                });
            });

    if let Err(err) = result {
        eprintln!("Failed to register plain paste shortcut: {:?}", err);
    }
}

#[tauri::command]
fn list_fonts() -> Result<Vec<String>, String> {
    let source = SystemSource::new();
    let mut families = source.all_families().map_err(|err| err.to_string())?;

    families.sort();
    families.dedup();

    Ok(families)
}

#[tauri::command]
async fn capture_screenshot(destination: String, image_data: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&destination).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    let cleaned = image_data
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(&image_data);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(cleaned)
        .map_err(|err| err.to_string())?;

    fs::write(&destination, bytes).map_err(|err| err.to_string())?;

    Ok(())
}







#[cfg(target_os = "macos")]
fn reveal_in_file_manager_impl(path: &str) -> Result<(), String> {
    use std::process::Command;

    let status = Command::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("open 命令返回非零状态: {:?}", status.code()))
    }
}

#[cfg(not(target_os = "macos"))]
fn reveal_in_file_manager_impl(_path: &str) -> Result<(), String> {
    Err("unsupported".to_string())
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径为空".to_string());
    }

    if !Path::new(&path).exists() {
        return Err("路径不存在".to_string());
    }

    reveal_in_file_manager_impl(&path)
}

/// 在系统终端中执行命令
#[cfg(target_os = "macos")]
#[tauri::command]
fn open_in_terminal(command: String, cwd: Option<String>) -> Result<(), String> {
    use std::io::Write;
    use std::process::Command;

    // 创建临时脚本文件
    let script_content = if let Some(dir) = &cwd {
        format!(
            "#!/bin/bash\ncd '{}' && {}\n",
            dir.replace("'", "'\\''"),
            command
        )
    } else {
        format!("#!/bin/bash\n{}\n", command)
    };

    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(format!("mark2_run_{}.sh", std::process::id()));

    let mut file = std::fs::File::create(&script_path).map_err(|e| e.to_string())?;
    file.write_all(script_content.as_bytes())
        .map_err(|e| e.to_string())?;

    // 设置可执行权限
    Command::new("chmod")
        .arg("+x")
        .arg(&script_path)
        .status()
        .map_err(|e| e.to_string())?;

    // 直接用 open 打开脚本，Terminal.app 会自动执行
    let status = Command::new("open")
        .arg("-a")
        .arg("Terminal")
        .arg(&script_path)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("open 命令返回非零状态: {:?}", status.code()))
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn open_in_terminal(_command: String, _cwd: Option<String>) -> Result<(), String> {
    Err("仅支持 macOS".to_string())
}

#[tauri::command]
fn set_export_menu_enabled(
    state: tauri::State<ExportMenuState>,
    enabled: bool,
) -> Result<(), String> {
    let handles = state
        .handles
        .lock()
        .map_err(|_| "failed to lock export menu state")?;
    handles
        .image
        .set_enabled(enabled)
        .map_err(|e| e.to_string())?;
    handles
        .pdf
        .set_enabled(enabled)
        .map_err(|e| e.to_string())?;
    Ok(())
}



#[derive(Serialize, Deserialize)]
struct RecentItem {
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

#[tauri::command]
fn update_recent_menu(
    state: tauri::State<RecentMenuState>,
    items: Vec<RecentItem>,
) -> Result<(), String> {
    let submenu = state
        .submenu
        .lock()
        .map_err(|_| "failed to lock recent menu state")?;

    let app_handle = state
        .app_handle
        .lock()
        .map_err(|_| "failed to lock app handle")?
        .clone()
        .ok_or("app handle not set")?;

    // 移除所有现有的菜单项
    let mut current_items = state
        .current_items
        .lock()
        .map_err(|_| "failed to lock current items")?;

    for item in current_items.iter() {
        submenu.remove(item).map_err(|e| e.to_string())?;
    }
    current_items.clear();

    // 移除分隔符和清除按钮
    if let Ok(mut sep) = state.separator.lock() {
        if let Some(separator) = sep.take() {
            let _ = submenu.remove(&separator);
        }
    }
    if let Ok(mut clear) = state.clear_item.lock() {
        if let Some(clear_item) = clear.take() {
            let _ = submenu.remove(&clear_item);
        }
    }

    // 添加新的菜单项
    for (index, item) in items.iter().enumerate() {
        let menu_item = MenuItemBuilder::with_id(format!("recent-{}", index), &item.label)
            .build(&app_handle)
            .map_err(|e| e.to_string())?;
        submenu.append(&menu_item).map_err(|e| e.to_string())?;
        current_items.push(menu_item);
    }

    // 如果有项目，添加分隔符和清除按钮
    if !items.is_empty() {
        let separator = PredefinedMenuItem::separator(&app_handle).map_err(|e| e.to_string())?;
        submenu.append(&separator).map_err(|e| e.to_string())?;
        if let Ok(mut sep) = state.separator.lock() {
            *sep = Some(separator);
        }

        let clear_item = MenuItemBuilder::with_id("clear-recent", "Clear Recent")
            .build(&app_handle)
            .map_err(|e| e.to_string())?;
        submenu.append(&clear_item).map_err(|e| e.to_string())?;
        if let Ok(mut clear) = state.clear_item.lock() {
            *clear = Some(clear_item);
        }
    }

    Ok(())
}

#[tauri::command]
fn get_opened_files(state: tauri::State<'_, OpenedFilesState>) -> Result<Vec<String>, String> {
    let mut guard = state
        .paths
        .lock()
        .map_err(|err| format!("opened files lock poisoned: {err}"))?;
    // 取出并清空，避免重复处理
    let paths = std::mem::take(&mut *guard);
    Ok(paths)
}

fn main() {
    // 限制 Tokio 运行时的工作线程数为 4，降低线程占用
    std::env::set_var("TOKIO_WORKER_THREADS", "4");

    tauri::Builder::default()
        .register_uri_scheme_protocol("stream", |_, request| {
            build_stream_response(&request).unwrap_or_else(|e| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(CONTENT_TYPE, "text/plain")
                    .body(format!("stream error: {}", e).into_bytes())
                    .unwrap()
            })
        })
        .manage(WorkspaceState::default())
        .manage(DocumentState::default())
        .manage(pty::PtyState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            open_path_in_browser,
            is_directory,
            read_file,
            read_image_base64,
            read_binary_base64,
            read_clipboard_file_paths,
            read_spreadsheet,
            write_file,
            read_dir,
            delete_entry,
            rename_entry,
            create_directory,
            pick_path,
            capture_security_scope,
            restore_security_scoped_access,
            list_fonts,
            capture_screenshot,
            get_file_metadata,
            ipc_health_check,
            update_workspace_context,
            update_document_snapshot,
            reveal_in_file_manager,
            open_in_terminal,
            set_export_menu_enabled,

            update_recent_menu,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            get_opened_files
        ])
        .manage(OpenedFilesState::default())
        .setup(|app| {
            let handle = app.handle();
            register_plain_paste_shortcut(&handle);

            // 创建菜单
            let open_item = MenuItemBuilder::with_id("open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let export_image_item = MenuItemBuilder::with_id("export-image", "Export as Image...")
                .accelerator("CmdOrCtrl+Shift+C")
                .build(app)?;

            let export_pdf_item = MenuItemBuilder::with_id("export-pdf", "Export as PDF...")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?;

            let toggle_sidebar_item = MenuItemBuilder::with_id("toggle-sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+\\")
                .build(app)?;

            let toggle_status_bar_item =
                MenuItemBuilder::with_id("toggle-status-bar", "Toggle Status Bar").build(app)?;

            let toggle_markdown_toolbar_item =
                MenuItemBuilder::with_id("toggle-markdown-toolbar", "Markdown Toolbar")
                    .accelerator("CmdOrCtrl+Shift+T")
                    .build(app)?;


            let toggle_terminal_item =
                MenuItemBuilder::with_id("toggle-terminal", "Terminal")
                    .accelerator("CmdOrCtrl+J")
                    .build(app)?;

            let about_item = MenuItemBuilder::with_id("about", "About Mark2").build(app)?;

            // 应用菜单（macOS 默认菜单）
            let app_menu = SubmenuBuilder::new(app, "Mark2")
                .item(&about_item)
                .separator()
                .item(&settings_item)
                .separator()
                .quit()
                .build()?;

            // Export 子菜单
            let export_submenu = SubmenuBuilder::new(app, "Export")
                .item(&export_image_item)
                .item(&export_pdf_item)
                .build()?;

            let new_file_item = MenuItemBuilder::with_id("file-new", "New...")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;

            let rename_file_item =
                MenuItemBuilder::with_id("file-rename", "Rename...").build(app)?;
            let move_file_item = MenuItemBuilder::with_id("file-move", "Move To...").build(app)?;
            let delete_file_item = MenuItemBuilder::with_id("file-delete", "Delete")
                .accelerator("CmdOrCtrl+Delete")
                .build(app)?;

            // Open Recent 子菜单 - 初始为空，稍后动态填充
            let open_recent_submenu = SubmenuBuilder::new(app, "Open Recent").build()?;

            // File 菜单
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_file_item)
                .item(&open_item)
                .item(&open_recent_submenu)
                .separator()
                .item(&export_submenu)
                .separator()
                .item(&rename_file_item)
                .item(&move_file_item)
                .item(&delete_file_item)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_sidebar_item)
                .item(&toggle_status_bar_item)
                .item(&toggle_markdown_toolbar_item)

                .separator()
                .item(&toggle_terminal_item)
                .build()?;

            app.manage(ExportMenuState::new(
                export_image_item.clone(),
                export_pdf_item.clone(),
            ));


            let recent_menu_state = RecentMenuState::new(open_recent_submenu.clone());
            recent_menu_state.set_app_handle(app.handle().clone());
            app.manage(recent_menu_state);

            // Edit 菜单，启用复制/粘贴等系统原生快捷键
            let undo_item = PredefinedMenuItem::undo(app, None)?;
            let redo_item = PredefinedMenuItem::redo(app, None)?;
            let cut_item = PredefinedMenuItem::cut(app, None)?;
            let copy_item = PredefinedMenuItem::copy(app, None)?;
            let paste_item = PredefinedMenuItem::paste(app, None)?;
            let select_all_item = PredefinedMenuItem::select_all(app, None)?;
            let markdown_code_mode_item =
                MenuItemBuilder::with_id("toggle-markdown-code-view", "Toggle Markdown Code Mode")
                    .accelerator("CmdOrCtrl+E")
                    .build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&undo_item)
                .item(&redo_item)
                .separator()
                .item(&cut_item)
                .item(&copy_item)
                .item(&paste_item)
                .item(&select_all_item)
                .separator()
                .item(&markdown_code_mode_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&view_menu)
                .item(&edit_menu)
                .build()?;

            app.set_menu(menu)?;

            // 监听菜单事件
            app.on_menu_event(|app, event| {
                let event_id = event.id().as_ref();
                println!("菜单事件: {:?}", event_id);

                // 转发菜单事件到前端
                let menu_event_name = format!("menu-{}", event_id);
                println!("发送 {} 事件到前端", menu_event_name);
                let _ = app.emit(&menu_event_name, ());
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                // 处理从系统传入的文件打开请求
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| {
                        if url.scheme() == "file" {
                            url.to_file_path().ok().and_then(|p| p.to_str().map(|s| s.to_string()))
                        } else {
                            None
                        }
                    })
                    .collect();

                if paths.is_empty() {
                    return;
                }

                // 尝试发送事件到前端
                if let Some(window) = app.get_webview_window("main") {
                    let payload = OpenedFilesPayload { paths: paths.clone() };
                    if window.emit("files-opened", payload).is_ok() {
                        return;
                    }
                }

                // 如果前端还没准备好，存储到状态中
                if let Some(state) = app.try_state::<OpenedFilesState>() {
                    if let Ok(mut guard) = state.paths.lock() {
                        guard.extend(paths);
                    }
                }
            }
        });
}
