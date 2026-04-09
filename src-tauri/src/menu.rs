use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::*;
use tauri::{App, Emitter, Manager, Wry};

/// Read locale from app data file written by the JS frontend.
fn read_locale(app: &App) -> String {
    if let Ok(data_dir) = app.path().app_data_dir() {
        let locale_file = data_dir.join("locale.txt");
        if let Ok(content) = std::fs::read_to_string(&locale_file) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
    }
    "en".to_string()
}

/// Build a translation map for menu labels.
fn menu_labels(locale: &str) -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    if locale == "zh-CN" {
        m.insert("file", "文件");
        m.insert("edit", "编辑");
        m.insert("view", "视图");
        m.insert("new", "新建...");
        m.insert("open", "打开...");
        m.insert("open-file", "打开文件...");
        m.insert("open-folder", "打开文件夹...");
        m.insert("open-recent", "最近打开");
        m.insert("export", "导出");
        m.insert("export-image", "导出为图片...");
        m.insert("export-pdf", "导出为 PDF...");
        m.insert("rename", "重命名...");
        m.insert("move", "移动到...");
        m.insert("delete", "删除");
        m.insert("settings", "设置...");
        m.insert("undo", "撤销");
        m.insert("redo", "重做");
        m.insert("toggle-sidebar", "切换侧边栏");
        m.insert("toggle-status-bar", "切换状态栏");
        m.insert("markdown-toolbar", "Markdown 工具栏");
        m.insert("terminal", "终端");
        m.insert("ai-assistant", "AI 助手");
        m.insert("toggle-theme", "切换深色/浅色模式");
        m.insert("toggle-code-mode", "切换 Markdown 代码模式");
        m.insert("about", "关于 Mark2");
        m.insert("quit", "退出 Mark2");
        m.insert("clear-recent", "清除最近记录");
    } else {
        m.insert("file", "File");
        m.insert("edit", "Edit");
        m.insert("view", "View");
        m.insert("new", "New...");
        m.insert("open", "Open...");
        m.insert("open-file", "Open File...");
        m.insert("open-folder", "Open Folder...");
        m.insert("open-recent", "Open Recent");
        m.insert("export", "Export");
        m.insert("export-image", "Export as Image...");
        m.insert("export-pdf", "Export as PDF...");
        m.insert("rename", "Rename...");
        m.insert("move", "Move To...");
        m.insert("delete", "Delete");
        m.insert("settings", "Settings...");
        m.insert("undo", "Undo");
        m.insert("redo", "Redo");
        m.insert("toggle-sidebar", "Toggle Sidebar");
        m.insert("toggle-status-bar", "Toggle Status Bar");
        m.insert("markdown-toolbar", "Markdown Toolbar");
        m.insert("terminal", "Terminal");
        m.insert("ai-assistant", "AI Assistant");
        m.insert("toggle-theme", "Toggle Dark/Light Mode");
        m.insert("toggle-code-mode", "Toggle Markdown Code Mode");
        m.insert("about", "About Mark2");
        m.insert("quit", "Quit Mark2");
        m.insert("clear-recent", "Clear Recent");
    }
    m
}

pub struct ExportMenuHandles {
    image: MenuItem<Wry>,
    pdf: MenuItem<Wry>,
}

pub struct ExportMenuState {
    pub handles: Mutex<ExportMenuHandles>,
}

impl ExportMenuState {
    pub fn new(image: MenuItem<Wry>, pdf: MenuItem<Wry>) -> Self {
        Self {
            handles: Mutex::new(ExportMenuHandles { image, pdf }),
        }
    }
}

pub struct RecentMenuState {
    submenu: Mutex<Submenu<Wry>>,
    app_handle: Mutex<Option<tauri::AppHandle>>,
    current_items: Mutex<Vec<MenuItem<Wry>>>,
    separator: Mutex<Option<PredefinedMenuItem<Wry>>>,
    clear_item: Mutex<Option<MenuItem<Wry>>>,
}

impl RecentMenuState {
    pub fn new(submenu: Submenu<Wry>) -> Self {
        Self {
            submenu: Mutex::new(submenu),
            app_handle: Mutex::new(None),
            current_items: Mutex::new(Vec::new()),
            separator: Mutex::new(None),
            clear_item: Mutex::new(None),
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut app_handle) = self.app_handle.lock() {
            *app_handle = Some(handle);
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct RecentItem {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[tauri::command]
pub fn set_export_menu_enabled(
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

#[tauri::command]
pub fn update_recent_menu(
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

    let mut current_items = state
        .current_items
        .lock()
        .map_err(|_| "failed to lock current items")?;

    for item in current_items.iter() {
        submenu.remove(item).map_err(|e| e.to_string())?;
    }
    current_items.clear();

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

    for (index, item) in items.iter().enumerate() {
        let menu_item = MenuItemBuilder::with_id(format!("recent-{}", index), &item.label)
            .build(&app_handle)
            .map_err(|e| e.to_string())?;
        submenu.append(&menu_item).map_err(|e| e.to_string())?;
        current_items.push(menu_item);
    }

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

pub fn build_app_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let locale = read_locale(app);
    let l = menu_labels(&locale);

    #[cfg(target_os = "macos")]
    let open_item = MenuItemBuilder::with_id("open", l["open"])
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    #[cfg(not(target_os = "macos"))]
    let open_file_item = MenuItemBuilder::with_id("open-file", l["open-file"])
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    #[cfg(not(target_os = "macos"))]
    let open_folder_item =
        MenuItemBuilder::with_id("open-folder", l["open-folder"]).build(app)?;

    let settings_item = MenuItemBuilder::with_id("settings", l["settings"])
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let export_image_item = MenuItemBuilder::with_id("export-image", l["export-image"])
        .accelerator("CmdOrCtrl+Shift+C")
        .build(app)?;

    let export_pdf_item = MenuItemBuilder::with_id("export-pdf", l["export-pdf"])
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;

    let toggle_sidebar_item = MenuItemBuilder::with_id("toggle-sidebar", l["toggle-sidebar"])
        .accelerator("CmdOrCtrl+\\")
        .build(app)?;

    let toggle_status_bar_item =
        MenuItemBuilder::with_id("toggle-status-bar", l["toggle-status-bar"]).build(app)?;

    let toggle_markdown_toolbar_item =
        MenuItemBuilder::with_id("toggle-markdown-toolbar", l["markdown-toolbar"])
            .accelerator("CmdOrCtrl+Shift+T")
            .build(app)?;

    let toggle_terminal_item = MenuItemBuilder::with_id("toggle-terminal", l["terminal"])
        .accelerator("CmdOrCtrl+J")
        .build(app)?;

    let toggle_ai_sidebar_item = MenuItemBuilder::with_id("toggle-ai-sidebar", l["ai-assistant"])
        .accelerator("CmdOrCtrl+Shift+A")
        .build(app)?;

    let toggle_theme_item = MenuItemBuilder::with_id("toggle-theme", l["toggle-theme"])
        .build(app)?;

    let about_item = MenuItemBuilder::with_id("about", l["about"]).build(app)?;
    let quit_item = MenuItemBuilder::with_id("app-quit", l["quit"])
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Mark2")
        .item(&about_item)
        .separator()
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let export_submenu = SubmenuBuilder::new(app, l["export"])
        .item(&export_image_item)
        .item(&export_pdf_item)
        .build()?;

    let new_file_item = MenuItemBuilder::with_id("file-new", l["new"])
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let rename_file_item = MenuItemBuilder::with_id("file-rename", l["rename"]).build(app)?;
    let move_file_item = MenuItemBuilder::with_id("file-move", l["move"]).build(app)?;
    let delete_file_item = MenuItemBuilder::with_id("file-delete", l["delete"])
        .accelerator("CmdOrCtrl+Delete")
        .build(app)?;

    let open_recent_submenu = SubmenuBuilder::new(app, l["open-recent"]).build()?;

    #[cfg(target_os = "macos")]
    let file_menu_builder = SubmenuBuilder::new(app, l["file"])
        .item(&new_file_item)
        .item(&open_item)
        .item(&open_recent_submenu);

    #[cfg(not(target_os = "macos"))]
    let file_menu_builder = SubmenuBuilder::new(app, l["file"])
        .item(&new_file_item)
        .item(&open_file_item)
        .item(&open_folder_item)
        .item(&open_recent_submenu);

    let file_menu = file_menu_builder
        .separator()
        .item(&export_submenu)
        .separator()
        .item(&rename_file_item)
        .item(&move_file_item)
        .item(&delete_file_item)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, l["view"])
        .item(&toggle_sidebar_item)
        .item(&toggle_status_bar_item)
        .item(&toggle_markdown_toolbar_item)
        .item(&toggle_theme_item)
        .separator()
        .item(&toggle_terminal_item)
        .item(&toggle_ai_sidebar_item)
        .build()?;

    app.manage(ExportMenuState::new(
        export_image_item.clone(),
        export_pdf_item.clone(),
    ));

    let recent_menu_state = RecentMenuState::new(open_recent_submenu.clone());
    recent_menu_state.set_app_handle(app.handle().clone());
    app.manage(recent_menu_state);

    let undo_item = MenuItemBuilder::with_id("undo", l["undo"])
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo_item = MenuItemBuilder::with_id("redo", l["redo"])
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let cut_item = PredefinedMenuItem::cut(app, None)?;
    let copy_item = PredefinedMenuItem::copy(app, None)?;
    let paste_item = PredefinedMenuItem::paste(app, None)?;
    let select_all_item = PredefinedMenuItem::select_all(app, None)?;
    let markdown_code_mode_item =
        MenuItemBuilder::with_id("toggle-markdown-code-view", l["toggle-code-mode"])
            .accelerator("CmdOrCtrl+E")
            .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, l["edit"])
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

    let menu_bar = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&view_menu)
        .item(&edit_menu)
        .build()?;

    // Windows 上不设置菜单（使用前端自定义标题栏菜单），accelerators 仍会生效
    #[cfg(target_os = "windows")]
    {
        // 不调用 set_menu，菜单栏就不会显示
    }

    #[cfg(not(target_os = "windows"))]
    app.set_menu(menu_bar)?;

    app.on_menu_event(|app, event| {
        let event_id = event.id().as_ref();
        println!("菜单事件: {:?}", event_id);
        let menu_event_name = format!("menu-{}", event_id);
        println!("发送 {} 事件到前端", menu_event_name);
        let _ = app.emit(&menu_event_name, ());
    });

    Ok(())
}
