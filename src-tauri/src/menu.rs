use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::menu::*;
use tauri::{App, Emitter, Manager, Wry};

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
    #[cfg(target_os = "macos")]
    let open_item = MenuItemBuilder::with_id("open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    #[cfg(not(target_os = "macos"))]
    let open_file_item = MenuItemBuilder::with_id("open-file", "Open File...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    #[cfg(not(target_os = "macos"))]
    let open_folder_item =
        MenuItemBuilder::with_id("open-folder", "Open Folder...").build(app)?;

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

    let toggle_terminal_item = MenuItemBuilder::with_id("toggle-terminal", "Terminal")
        .accelerator("CmdOrCtrl+J")
        .build(app)?;

    let toggle_ai_sidebar_item = MenuItemBuilder::with_id("toggle-ai-sidebar", "AI Assistant")
        .accelerator("CmdOrCtrl+Shift+A")
        .build(app)?;

    let toggle_theme_item = MenuItemBuilder::with_id("toggle-theme", "Toggle Dark/Light Mode")
        .build(app)?;

    let about_item = MenuItemBuilder::with_id("about", "About Mark2").build(app)?;
    let quit_item = MenuItemBuilder::with_id("app-quit", "Quit Mark2")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Mark2")
        .item(&about_item)
        .separator()
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let export_submenu = SubmenuBuilder::new(app, "Export")
        .item(&export_image_item)
        .item(&export_pdf_item)
        .build()?;

    let new_file_item = MenuItemBuilder::with_id("file-new", "New...")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let rename_file_item = MenuItemBuilder::with_id("file-rename", "Rename...").build(app)?;
    let move_file_item = MenuItemBuilder::with_id("file-move", "Move To...").build(app)?;
    let delete_file_item = MenuItemBuilder::with_id("file-delete", "Delete")
        .accelerator("CmdOrCtrl+Delete")
        .build(app)?;

    let open_recent_submenu = SubmenuBuilder::new(app, "Open Recent").build()?;

    #[cfg(target_os = "macos")]
    let file_menu_builder = SubmenuBuilder::new(app, "File")
        .item(&new_file_item)
        .item(&open_item)
        .item(&open_recent_submenu);

    #[cfg(not(target_os = "macos"))]
    let file_menu_builder = SubmenuBuilder::new(app, "File")
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

    let view_menu = SubmenuBuilder::new(app, "View")
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

    let undo_item = MenuItemBuilder::with_id("undo", "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo_item = MenuItemBuilder::with_id("redo", "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
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
