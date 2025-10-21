// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;

use ai::provider::AiStreamUpdate;
use base64::Engine;
use tauri::Manager;
use font_kit::source::SystemSource;
use headless_chrome::{Browser, LaunchOptions};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::SystemTime;
use tauri::{menu::*, Emitter};

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};

#[derive(Serialize)]
struct FileMetadata {
    modified_time: u64, // Unix timestamp in seconds
}

#[derive(Debug, Clone, Serialize)]
struct AiStreamStartEvent {
    id: String,
}

#[derive(Debug, Clone, Serialize)]
struct AiStreamChunkEvent {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct AiStreamEndEvent {
    id: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct AiStreamErrorEvent {
    id: String,
    message: String,
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
fn read_image_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    Ok(encoded)
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
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
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
fn ipc_health_check() -> Result<(), String> {
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
    page_width: Option<f64>,
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

    let width_inches = page_width
        .map(|w| w / 96.0) // 将像素转换为英寸 (96 DPI)
        .unwrap_or(8.5); // 默认 8.5 英寸 (Letter 宽度)

    let pdf_options = PrintToPdfOptions {
        landscape: Some(false),
        display_header_footer: Some(false),
        print_background: Some(true),
        scale: Some(1.0),
        paper_width: Some(width_inches),
        paper_height: None, // 自动高度
        margin_top: Some(0.4),
        margin_bottom: Some(0.4),
        margin_left: Some(0.4),
        margin_right: Some(0.4),
        page_ranges: None,
        ignore_invalid_page_ranges: None,
        header_template: None,
        footer_template: None,
        prefer_css_page_size: Some(false),
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
fn get_ai_config(state: tauri::State<'_, ai::AiState>) -> Result<ai::AiConfigSnapshot, String> {
    Ok(state.snapshot())
}

#[tauri::command]
fn save_ai_config(
    state: tauri::State<'_, ai::AiState>,
    payload: ai::AiConfigUpdate,
) -> Result<(), String> {
    state.update_config(payload)
}

#[tauri::command]
fn clear_ai_api_key(state: tauri::State<'_, ai::AiState>) -> Result<(), String> {
    state.clear_api_key()
}

#[tauri::command]
async fn ai_execute(
    state: tauri::State<'_, ai::AiState>,
    payload: ai::AiExecuteRequest,
) -> Result<String, String> {
    let config = state.get_config();
    let result = ai::provider::execute(payload, &config).await?;
    Ok(result.content)
}

#[tauri::command]
async fn ai_execute_stream(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ai::AiState>,
    payload: ai::AiExecuteRequest,
    task_id: String,
) -> Result<ai::provider::AiExecutionResult, String> {
    let config = state.get_config();

    let _ = app_handle.emit(
        "ai-stream-start",
        AiStreamStartEvent {
            id: task_id.clone(),
        },
    );

    let chunk_handle = app_handle.clone();
    let chunk_task_id = task_id.clone();

    let result = ai::provider::execute_stream(payload, &config, move |update: AiStreamUpdate| {
        let AiStreamUpdate {
            content_delta,
            reasoning_delta,
            role,
            finish_reason,
        } = update;

        let payload = AiStreamChunkEvent {
            id: chunk_task_id.clone(),
            content_delta,
            reasoning_delta,
            role,
            finish_reason,
        };
        if let Err(error) = chunk_handle.emit("ai-stream-chunk", payload) {
            eprintln!("广播 AI 流式事件失败: {}", error);
        }
        Ok(())
    })
    .await;

    match &result {
        Ok(result) => {
            let _ = app_handle.emit(
                "ai-stream-end",
                AiStreamEndEvent {
                    id: task_id.clone(),
                    content: result.content.clone(),
                    reasoning: result.reasoning.clone(),
                },
            );
        }
        Err(message) => {
            let _ = app_handle.emit(
                "ai-stream-error",
                AiStreamErrorEvent {
                    id: task_id.clone(),
                    message: message.clone(),
                },
            );
        }
    }

    result
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            is_directory,
            read_file,
            read_image_base64,
            write_file,
            read_dir,
            delete_entry,
            rename_entry,
            pick_path,
            list_fonts,
            capture_screenshot,
            export_to_pdf,
            get_file_metadata,
            ipc_health_check,
            reveal_in_file_manager,
            get_ai_config,
            save_ai_config,
            clear_ai_api_key,
            ai_execute,
            ai_execute_stream
        ])
        .setup(|app| {
            let ai_state = ai::AiState::initialize(&app.handle())
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
            app.manage(ai_state);

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
                .accelerator("CmdOrCtrl+B")
                .build(app)?;

            let toggle_status_bar_item =
                MenuItemBuilder::with_id("toggle-status-bar", "Toggle Status Bar").build(app)?;

            let toggle_ai_assistant_item = MenuItemBuilder::with_id(
                "toggle-ai-assistant",
                "Toggle AI Assistant",
            )
            .accelerator("CmdOrCtrl+Shift+A")
            .build(app)?;

            let ai_settings_item = MenuItemBuilder::with_id("open-ai-settings", "AI Settings...")
                .accelerator("CmdOrCtrl+Shift+,")
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
            let move_file_item =
                MenuItemBuilder::with_id("file-move", "Move To...").build(app)?;
            let delete_file_item = MenuItemBuilder::with_id("file-delete", "Delete")
                .accelerator("CmdOrCtrl+Backspace")
                .build(app)?;

            // File 菜单
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_file_item)
                .item(&open_item)
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
                .build()?;

            let ai_menu = SubmenuBuilder::new(app, "AI")
                .item(&toggle_ai_assistant_item)
                .item(&ai_settings_item)
                .build()?;

            // Edit 菜单，启用复制/粘贴等系统原生快捷键
            let undo_item = PredefinedMenuItem::undo(app, None)?;
            let redo_item = PredefinedMenuItem::redo(app, None)?;
            let cut_item = PredefinedMenuItem::cut(app, None)?;
            let copy_item = PredefinedMenuItem::copy(app, None)?;
            let paste_item = PredefinedMenuItem::paste(app, None)?;
            let select_all_item = PredefinedMenuItem::select_all(app, None)?;
            let markdown_code_mode_item = MenuItemBuilder::with_id(
                "toggle-markdown-code-view",
                "Toggle Markdown Code Mode",
            )
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
                .item(&ai_menu)
                .item(&edit_menu)
                .build()?;

            app.set_menu(menu)?;

            // 监听菜单事件
            app.on_menu_event(|app, event| {
                println!("菜单事件: {:?}", event.id());
                if event.id().as_ref() == "open" {
                    println!("发送 menu-open 事件到前端");
                    let _ = app.emit("menu-open", ());
                } else if event.id().as_ref() == "settings" {
                    println!("发送 menu-settings 事件到前端");
                    let _ = app.emit("menu-settings", ());
                } else if event.id().as_ref() == "export-image" {
                    println!("发送 menu-export-image 事件到前端");
                    let _ = app.emit("menu-export-image", ());
                } else if event.id().as_ref() == "export-pdf" {
                    println!("发送 menu-export-pdf 事件到前端");
                    let _ = app.emit("menu-export-pdf", ());
                } else if event.id().as_ref() == "toggle-sidebar" {
                    println!("发送 menu-toggle-sidebar 事件到前端");
                    let _ = app.emit("menu-toggle-sidebar", ());
                } else if event.id().as_ref() == "toggle-status-bar" {
                    println!("发送 menu-toggle-status-bar 事件到前端");
                    let _ = app.emit("menu-toggle-status-bar", ());
                } else if event.id().as_ref() == "toggle-ai-assistant" {
                    println!("发送 menu-toggle-ai-assistant 事件到前端");
                    let _ = app.emit("menu-toggle-ai-assistant", ());
                } else if event.id().as_ref() == "open-ai-settings" {
                    println!("发送 menu-open-ai-settings 事件到前端");
                    let _ = app.emit("menu-open-ai-settings", ());
                } else if event.id().as_ref() == "toggle-markdown-code-view" {
                    println!("发送 menu-toggle-markdown-code-view 事件到前端");
                    let _ = app.emit("menu-toggle-markdown-code-view", ());
                } else if event.id().as_ref() == "file-new" {
                    println!("发送 menu-file-new 事件到前端");
                    let _ = app.emit("menu-file-new", ());
                } else if event.id().as_ref() == "file-delete" {
                    println!("发送 menu-file-delete 事件到前端");
                    let _ = app.emit("menu-file-delete", ());
                } else if event.id().as_ref() == "file-move" {
                    println!("发送 menu-file-move 事件到前端");
                    let _ = app.emit("menu-file-move", ());
                } else if event.id().as_ref() == "file-rename" {
                    println!("发送 menu-file-rename 事件到前端");
                    let _ = app.emit("menu-file-rename", ());
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
