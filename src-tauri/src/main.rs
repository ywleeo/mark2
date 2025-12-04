// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod plugin_loader;
mod mcp_server;

use base64::Engine;
use calamine::{open_workbook_auto, Data, Reader};
use font_kit::source::SystemSource;
use std::fs;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::menu::*;
use tauri::http::header::{
    ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
};
use tauri::http::{Response, StatusCode};
use tauri::{Emitter, Manager, Wry};
use percent_encoding::percent_decode_str;

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};

use headless_chrome::{Browser, LaunchOptions};
use serde::{Deserialize, Serialize};

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

struct ExportMenuHandles {
    image: MenuItem<Wry>,
    pdf: MenuItem<Wry>,
}

struct ExportMenuState {
    handles: Mutex<ExportMenuHandles>,
}

impl ExportMenuState {
    fn new(image: MenuItem<Wry>, pdf: MenuItem<Wry>) -> Self {
        Self {
            handles: Mutex::new(ExportMenuHandles { image, pdf }),
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

fn build_stream_response(request: &tauri::http::Request<Vec<u8>>) -> Result<tauri::http::Response<Vec<u8>>, Box<dyn std::error::Error>> {
        let raw_path = request.uri().path();
        let decoded_path = percent_decode_str(raw_path)
            .decode_utf8_lossy()
            .to_string();
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
    // 将文件或文件夹移动到系统垃圾桶，而不是直接物理删除
    trash::delete(&path).map_err(|e| e.to_string())
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
fn pick_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let selection = autoreleasepool(|_| {
                let mtm = MainThreadMarker::new().expect("pick_path must run on main thread");
                let panel = NSOpenPanel::openPanel(mtm);
                panel.setAllowsMultipleSelection(false);
                panel.setCanChooseDirectories(true);
                panel.setCanChooseFiles(true);

                if panel.runModal() == NSModalResponseOK {
                    let urls = panel.URLs();
                    if let Some(url) = urls.firstObject() {
                        if let Some(path) = url.path() {
                            return Some(path.to_string());
                        }
                    }
                }

                None
            });

            let _ = tx.send(selection);
        })
        .map_err(|e| e.to_string())?;

        rx.recv().map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("unsupported".to_string())
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

#[tauri::command]
async fn export_to_pdf(
    destination: String,
    html_content: String,
    css_content: String,
    _page_width: Option<f64>,
) -> Result<(), String> {
    if let Some(parent) = Path::new(&destination).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    // 创建完整的 HTML 文档
    let full_html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>{}</style>
</head>
<body>
    {}
</body>
</html>"#,
        css_content, html_content
    );

    // 启动 headless chrome
    let browser = Browser::new(LaunchOptions {
        headless: true,
        ..Default::default()
    })
    .map_err(|e| format!("启动浏览器失败: {}", e))?;

    let tab = browser
        .new_tab()
        .map_err(|e| format!("创建标签页失败: {}", e))?;

    // 加载 HTML 内容
    tab.navigate_to(&format!(
        "data:text/html,{}",
        urlencoding::encode(&full_html)
    ))
    .map_err(|e| format!("加载 HTML 失败: {}", e))?;

    // 等待页面加载完成
    tab.wait_until_navigated()
        .map_err(|e| format!("等待页面加载失败: {}", e))?;

    // 配置 PDF 选项
    use headless_chrome::types::PrintToPdfOptions;

    let header_template =
        "<div style=\"width:100%;font-size:0;margin:0;padding:0;\">&nbsp;</div>".to_string();
    let footer_template = r#"
        <div style="width:100%;padding:6px 0 0 0;display:flex;justify-content:center;align-items:center;gap:12px;font-size:11px;color:#999;">
            <span style="flex:1;height:1px;background:#e5e5e5;"></span>
            <span style="display:inline-block;background:#ff3b30;color:#ffffff;font-weight:700;font-size:12px;letter-spacing:0.4px;padding:2px 14px;border-radius:4px;">Mark2</span>
            <span style="flex:1;height:1px;background:#e5e5e5;"></span>
        </div>
    "#.to_string();

    let pdf_options = PrintToPdfOptions {
        landscape: Some(false),
        display_header_footer: Some(true),
        print_background: Some(true),
        scale: Some(1.0),
        paper_width: None,
        paper_height: None,
        margin_top: None,
        margin_bottom: None,
        margin_left: None,
        margin_right: None,
        page_ranges: None,
        ignore_invalid_page_ranges: None,
        header_template: Some(header_template),
        footer_template: Some(footer_template),
        prefer_css_page_size: Some(true),
        transfer_mode: None,
        generate_document_outline: None,
        generate_tagged_pdf: None,
    };

    // 生成 PDF
    let pdf_data = tab
        .print_to_pdf(Some(pdf_options))
        .map_err(|e| format!("生成 PDF 失败: {}", e))?;

    // 保存 PDF 文件
    fs::write(&destination, pdf_data).map_err(|err| err.to_string())?;

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

fn main() {
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            is_directory,
            read_file,
            read_image_base64,
            read_binary_base64,
            read_spreadsheet,
            write_file,
            read_dir,
            delete_entry,
            rename_entry,
            create_directory,
            pick_path,
            list_fonts,
            capture_screenshot,
            export_to_pdf,
            get_file_metadata,
            ipc_health_check,
            update_workspace_context,
            update_document_snapshot,
            reveal_in_file_manager,
            set_export_menu_enabled,
            update_recent_menu,
            plugin_loader::list_plugins
        ])
        .setup(|app| {
            let handle = app.handle();
            #[cfg(debug_assertions)]
            println!("[MCP] initializing server...");
            mcp_server::spawn_mcp_server(handle.clone());

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
                .accelerator("CmdOrCtrl+K")
                .build(app)?;

            let toggle_status_bar_item =
                MenuItemBuilder::with_id("toggle-status-bar", "Toggle Status Bar").build(app)?;

            let toggle_markdown_toolbar_item =
                MenuItemBuilder::with_id("toggle-markdown-toolbar", "Markdown Toolbar")
                    .accelerator("CmdOrCtrl+Shift+T")
                    .build(app)?;

            // 应用菜单（macOS 默认菜单）
            let app_menu = SubmenuBuilder::new(app, "Mark2")
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
                .build()?;

            app.manage(ExportMenuState::new(
                export_image_item.clone(),
                export_pdf_item.clone(),
            ));

            let recent_menu_state = RecentMenuState::new(open_recent_submenu.clone());
            recent_menu_state.set_app_handle(app.handle().clone());
            app.manage(recent_menu_state);

            // 动态加载插件菜单
            let plugins = plugin_loader::scan_plugins().unwrap_or_default();
            let mut plugins_menu_builder = SubmenuBuilder::new(app, "Plugins");

            for plugin in &plugins {
                let plugin_id = &plugin.id;
                let mut submenu_builder = SubmenuBuilder::new(app, &plugin.name);

                // 从 manifest 读取菜单配置
                if let Some(menu_config) = &plugin.menu {
                    // Toggle 菜单项
                    if let Some(toggle_config) = &menu_config.toggle {
                        let default_label = format!("Toggle {}", plugin.name);
                        let label = toggle_config
                            .label
                            .as_ref()
                            .map(|s| s.as_str())
                            .unwrap_or(&default_label);
                        let accelerator = toggle_config.accelerator.as_deref().unwrap_or("");

                        let toggle_item =
                            MenuItemBuilder::with_id(format!("plugin-{}-toggle", plugin_id), label)
                                .accelerator(accelerator)
                                .build(app)?;

                        submenu_builder = submenu_builder.item(&toggle_item);
                    }

                    // Settings 菜单项
                    if let Some(settings_config) = &menu_config.settings {
                        let default_label = format!("{} Settings...", plugin.name);
                        let label = settings_config
                            .label
                            .as_ref()
                            .map(|s| s.as_str())
                            .unwrap_or(&default_label);
                        let accelerator = settings_config.accelerator.as_deref().unwrap_or("");

                        let settings_item = MenuItemBuilder::with_id(
                            format!("plugin-{}-settings", plugin_id),
                            label,
                        )
                        .accelerator(accelerator)
                        .build(app)?;

                        submenu_builder = submenu_builder.item(&settings_item);
                    }
                }

                let plugin_submenu = submenu_builder.build()?;
                plugins_menu_builder = plugins_menu_builder.item(&plugin_submenu);
            }

            let plugins_menu = plugins_menu_builder.build()?;

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
                .item(&plugins_menu)
                .build()?;

            app.set_menu(menu)?;

            // 监听菜单事件
            app.on_menu_event(|app, event| {
                let event_id = event.id().as_ref();
                println!("菜单事件: {:?}", event_id);

                // 处理插件菜单事件 (plugin-{id}-toggle 或 plugin-{id}-settings)
                if event_id.starts_with("plugin-") {
                    // 直接转发到前端，保持原格式
                    let menu_event_name = format!("menu-{}", event_id);
                    println!("发送 {} 事件到前端", menu_event_name);
                    let _ = app.emit(&menu_event_name, ());
                    return;
                }

                // 处理其他标准菜单项
                let menu_event_name = format!("menu-{}", event_id);
                println!("发送 {} 事件到前端", menu_event_name);
                let _ = app.emit(&menu_event_name, ());
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
