// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use tauri::{menu::*, Emitter};

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
            entry.ok().and_then(|e| {
                e.path().to_str().map(|s| s.to_string())
            })
        })
        .collect();
    Ok(entries)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            is_directory,
            read_file,
            write_file,
            read_dir
        ])
        .setup(|app| {
            // 创建菜单
            let open_item = MenuItemBuilder::with_id("open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            // 应用菜单（macOS 默认菜单）
            let app_menu = SubmenuBuilder::new(app, "Mark2")
                .quit()
                .build()?;

            // File 菜单
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .build()?;

            app.set_menu(menu)?;

            // 监听菜单事件
            app.on_menu_event(|app, event| {
                println!("菜单事件: {:?}", event.id());
                if event.id().as_ref() == "open" {
                    println!("发送 menu-open 事件到前端");
                    let _ = app.emit("menu-open", ());
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
