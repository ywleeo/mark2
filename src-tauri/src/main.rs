// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use tauri::{menu::*, Emitter};
use base64::Engine;
use font_kit::source::SystemSource;
use headless_chrome::{Browser, LaunchOptions};

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};

#[tauri::command]
fn is_directory(path: String) -> Result<bool, String> {
    Path::new(&path)
        .metadata()
        .map(|m| m.is_dir())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
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
    let mut families = source
        .all_families()
        .map_err(|err| err.to_string())?;

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
    tab.navigate_to(&format!("data:text/html,{}", urlencoding::encode(&full_html)))
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            is_directory,
            read_file,
            write_file,
            read_dir,
            pick_path,
            list_fonts,
            capture_screenshot,
            export_to_pdf
        ])
        .setup(|app| {
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

            // File 菜单
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_item)
                .separator()
                .item(&export_submenu)
                .build()?;

            // Edit 菜单，启用复制/粘贴等系统原生快捷键
            let undo_item = PredefinedMenuItem::undo(app, None)?;
            let redo_item = PredefinedMenuItem::redo(app, None)?;
            let cut_item = PredefinedMenuItem::cut(app, None)?;
            let copy_item = PredefinedMenuItem::copy(app, None)?;
            let paste_item = PredefinedMenuItem::paste(app, None)?;
            let select_all_item = PredefinedMenuItem::select_all(app, None)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&undo_item)
                .item(&redo_item)
                .separator()
                .item(&cut_item)
                .item(&copy_item)
                .item(&paste_item)
                .item(&select_all_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
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
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
