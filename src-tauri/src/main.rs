// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use tauri::{menu::*, Emitter};
use base64::Engine;
use font_kit::source::SystemSource;

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            is_directory,
            read_file,
            write_file,
            read_dir,
            pick_path,
            list_fonts,
            capture_screenshot
        ])
        .setup(|app| {
            // 创建菜单
            let open_item = MenuItemBuilder::with_id("open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let screenshot_item = MenuItemBuilder::with_id("tool-screenshot", "Capture Screenshot...")
                .accelerator("CmdOrCtrl+Shift+C")
                .build(app)?;

            // 应用菜单（macOS 默认菜单）
            let app_menu = SubmenuBuilder::new(app, "Mark2")
                .item(&settings_item)
                .separator()
                .quit()
                .build()?;

            // File 菜单
            let file_menu = SubmenuBuilder::new(app, "File").item(&open_item).build()?;

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

            let tool_menu = SubmenuBuilder::new(app, "Tool")
                .item(&screenshot_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&tool_menu)
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
                } else if event.id().as_ref() == "tool-screenshot" {
                    println!("发送 menu-screenshot 事件到前端");
                    let _ = app.emit("menu-screenshot", ());
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
