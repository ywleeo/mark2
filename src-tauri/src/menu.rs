use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::*;
use tauri::{App, AppHandle, Emitter, Manager, Wry};

/// Read locale from app data file written by the JS frontend.
fn read_locale_from_handle(handle: &AppHandle) -> String {
    if let Ok(data_dir) = handle.path().app_data_dir() {
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
        m.insert("save-as", "另存为…");
        m.insert("rename", "重命名...");
        m.insert("move", "移动到...");
        m.insert("delete", "删除");
        m.insert("settings", "设置...");
        m.insert("vault-open", "保险箱");
        m.insert("undo", "撤销");
        m.insert("redo", "重做");
        m.insert("toggle-sidebar", "切换侧边栏");
        m.insert("toggle-status-bar", "切换状态栏");
        m.insert("markdown-toolbar", "Markdown 工具栏");
        m.insert("terminal", "终端");
        m.insert("ai-assistant", "AI 助手");
        m.insert("toggle-theme", "切换深色/浅色模式");
        m.insert("toggle-code-mode", "切换 Markdown 代码模式");
        m.insert("check-update", "检查更新...");
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
        m.insert("save-as", "Save As...");
        m.insert("rename", "Rename...");
        m.insert("move", "Move To...");
        m.insert("delete", "Delete");
        m.insert("settings", "Settings...");
        m.insert("vault-open", "Vault");
        m.insert("undo", "Undo");
        m.insert("redo", "Redo");
        m.insert("toggle-sidebar", "Toggle Sidebar");
        m.insert("toggle-status-bar", "Toggle Status Bar");
        m.insert("markdown-toolbar", "Markdown Toolbar");
        m.insert("terminal", "Terminal");
        m.insert("ai-assistant", "AI Assistant");
        m.insert("toggle-theme", "Toggle Dark/Light Mode");
        m.insert("toggle-code-mode", "Toggle Markdown Code Mode");
        m.insert("check-update", "Check for Updates...");
        m.insert("about", "About Mark2");
        m.insert("quit", "Quit Mark2");
        m.insert("clear-recent", "Clear Recent");
    }
    m
}

/// JS command ID → Rust 菜单使用的 menu ID 映射。
/// 一个 JS command 可能对应不同平台的菜单 ID。
fn command_to_menu_ids() -> HashMap<&'static str, Vec<&'static str>> {
    let mut m: HashMap<&str, Vec<&str>> = HashMap::new();
    m.insert("app.open", vec!["open", "open-file"]);
    m.insert("app.openFile", vec!["open-file"]);
    m.insert("app.settings", vec!["settings"]);
    m.insert("export.currentView.image", vec!["export-image"]);
    m.insert("export.currentView.pdf", vec!["export-pdf"]);
    m.insert("view.toggleSidebar", vec!["toggle-sidebar"]);
    m.insert("toolbar.toggleMarkdown", vec!["toggle-markdown-toolbar"]);
    m.insert("feature.terminal.toggle", vec!["toggle-terminal"]);
    m.insert("feature.ai.toggle", vec!["toggle-ai-sidebar"]);
    m.insert("document.newFile", vec!["file-new"]);
    m.insert("document.delete", vec!["file-delete"]);
    m.insert("editor.undo", vec!["undo"]);
    m.insert("editor.redo", vec!["redo"]);
    m.insert("view.toggleSourceMode", vec!["toggle-markdown-code-view"]);
    m.insert("app.quit", vec!["app-quit"]);
    m.insert("feature.vault.toggle", vec!["vault-open"]);
    m
}

/// 从 JS 快捷键格式 (Mod+Shift+A) 转换为 Tauri accelerator 格式 (CmdOrCtrl+Shift+A)。
fn js_shortcut_to_accelerator(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|token| {
            let t = token.trim();
            if t.eq_ignore_ascii_case("mod") {
                "CmdOrCtrl"
            } else {
                t
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// 加载用户自定义快捷键，返回 menu_id → accelerator 的映射。
fn load_custom_accelerators(handle: &AppHandle) -> HashMap<String, String> {
    let mut result = HashMap::new();

    let data_dir = match handle.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return result,
    };

    let keybindings_file = data_dir.join("keybindings.json");
    let content = match std::fs::read_to_string(&keybindings_file) {
        Ok(c) => c,
        Err(_) => return result,
    };

    let custom: HashMap<String, String> = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(_) => return result,
    };

    let cmd_to_menu = command_to_menu_ids();

    for (command_id, shortcut) in &custom {
        let accelerator = js_shortcut_to_accelerator(shortcut);
        if let Some(menu_ids) = cmd_to_menu.get(command_id.as_str()) {
            for menu_id in menu_ids {
                result.insert(menu_id.to_string(), accelerator.clone());
            }
        }
    }

    result
}

/// 获取某个菜单项的 accelerator：优先用自定义，否则用默认值。
fn get_accelerator(
    menu_id: &str,
    default: &str,
    custom: &HashMap<String, String>,
) -> String {
    custom
        .get(menu_id)
        .cloned()
        .unwrap_or_else(|| default.to_string())
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

    /// 替换内部的 submenu 引用（菜单重建时使用）。
    fn replace_submenu(&self, new_submenu: Submenu<Wry>) {
        if let Ok(mut submenu) = self.submenu.lock() {
            *submenu = new_submenu;
        }
        if let Ok(mut items) = self.current_items.lock() {
            items.clear();
        }
        if let Ok(mut sep) = self.separator.lock() {
            *sep = None;
        }
        if let Ok(mut clear) = self.clear_item.lock() {
            *clear = None;
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

/// 构建菜单栏（初始化和重建共用）。
/// 返回 (menu_bar, export_image, export_pdf, recent_submenu)。
fn build_menu(
    handle: &AppHandle,
    custom_accel: &HashMap<String, String>,
) -> Result<(Menu<Wry>, MenuItem<Wry>, MenuItem<Wry>, Submenu<Wry>), Box<dyn std::error::Error>> {
    let locale = read_locale_from_handle(handle);
    let l = menu_labels(&locale);

    #[cfg(target_os = "macos")]
    let open_item = MenuItemBuilder::with_id("open", l["open"])
        .accelerator(get_accelerator("open", "CmdOrCtrl+O", custom_accel))
        .build(handle)?;

    #[cfg(not(target_os = "macos"))]
    let open_file_item = MenuItemBuilder::with_id("open-file", l["open-file"])
        .accelerator(get_accelerator("open-file", "CmdOrCtrl+O", custom_accel))
        .build(handle)?;

    #[cfg(not(target_os = "macos"))]
    let open_folder_item =
        MenuItemBuilder::with_id("open-folder", l["open-folder"]).build(handle)?;

    let settings_item = MenuItemBuilder::with_id("settings", l["settings"])
        .accelerator(get_accelerator("settings", "CmdOrCtrl+,", custom_accel))
        .build(handle)?;

    let vault_item = MenuItemBuilder::with_id("vault-open", l["vault-open"])
        .accelerator(get_accelerator("vault-open", "CmdOrCtrl+Shift+K", custom_accel))
        .build(handle)?;

    let export_image_item = MenuItemBuilder::with_id("export-image", l["export-image"])
        .accelerator(get_accelerator("export-image", "CmdOrCtrl+Shift+C", custom_accel))
        .build(handle)?;

    let export_pdf_item = MenuItemBuilder::with_id("export-pdf", l["export-pdf"])
        .accelerator(get_accelerator("export-pdf", "CmdOrCtrl+Shift+P", custom_accel))
        .build(handle)?;

    let toggle_sidebar_item = MenuItemBuilder::with_id("toggle-sidebar", l["toggle-sidebar"])
        .accelerator(get_accelerator("toggle-sidebar", "CmdOrCtrl+\\", custom_accel))
        .build(handle)?;

    let toggle_status_bar_item =
        MenuItemBuilder::with_id("toggle-status-bar", l["toggle-status-bar"]).build(handle)?;

    let toggle_markdown_toolbar_item =
        MenuItemBuilder::with_id("toggle-markdown-toolbar", l["markdown-toolbar"])
            .accelerator(get_accelerator("toggle-markdown-toolbar", "CmdOrCtrl+Shift+T", custom_accel))
            .build(handle)?;

    let toggle_terminal_item = MenuItemBuilder::with_id("toggle-terminal", l["terminal"])
        .accelerator(get_accelerator("toggle-terminal", "CmdOrCtrl+J", custom_accel))
        .build(handle)?;

    let toggle_ai_sidebar_item = MenuItemBuilder::with_id("toggle-ai-sidebar", l["ai-assistant"])
        .accelerator(get_accelerator("toggle-ai-sidebar", "CmdOrCtrl+Shift+A", custom_accel))
        .build(handle)?;

    let toggle_theme_item = MenuItemBuilder::with_id("toggle-theme", l["toggle-theme"])
        .build(handle)?;

    let check_update_item = MenuItemBuilder::with_id("check-update", l["check-update"]).build(handle)?;
    let about_item = MenuItemBuilder::with_id("about", l["about"]).build(handle)?;
    let quit_item = MenuItemBuilder::with_id("app-quit", l["quit"])
        .accelerator(get_accelerator("app-quit", "CmdOrCtrl+Q", custom_accel))
        .build(handle)?;

    let app_menu = SubmenuBuilder::new(handle, "Mark2")
        .item(&about_item)
        .item(&check_update_item)
        .separator()
        .item(&settings_item)
        .item(&vault_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let export_submenu = SubmenuBuilder::new(handle, l["export"])
        .item(&export_image_item)
        .item(&export_pdf_item)
        .build()?;

    let new_file_item = MenuItemBuilder::with_id("file-new", l["new"])
        .accelerator(get_accelerator("file-new", "CmdOrCtrl+N", custom_accel))
        .build(handle)?;

    let save_as_item = MenuItemBuilder::with_id("file-save-as", l["save-as"])
        .accelerator(get_accelerator("file-save-as", "CmdOrCtrl+Shift+S", custom_accel))
        .build(handle)?;

    let rename_file_item = MenuItemBuilder::with_id("file-rename", l["rename"]).build(handle)?;
    let move_file_item = MenuItemBuilder::with_id("file-move", l["move"]).build(handle)?;
    let delete_file_item = MenuItemBuilder::with_id("file-delete", l["delete"])
        .accelerator(get_accelerator("file-delete", "CmdOrCtrl+Delete", custom_accel))
        .build(handle)?;

    let open_recent_submenu = SubmenuBuilder::new(handle, l["open-recent"]).build()?;

    #[cfg(target_os = "macos")]
    let file_menu_builder = SubmenuBuilder::new(handle, l["file"])
        .item(&new_file_item)
        .item(&open_item)
        .item(&open_recent_submenu);

    #[cfg(not(target_os = "macos"))]
    let file_menu_builder = SubmenuBuilder::new(handle, l["file"])
        .item(&new_file_item)
        .item(&open_file_item)
        .item(&open_folder_item)
        .item(&open_recent_submenu);

    let file_menu = file_menu_builder
        .separator()
        .item(&save_as_item)
        .separator()
        .item(&export_submenu)
        .separator()
        .item(&rename_file_item)
        .item(&move_file_item)
        .item(&delete_file_item)
        .build()?;

    let view_menu = SubmenuBuilder::new(handle, l["view"])
        .item(&toggle_sidebar_item)
        .item(&toggle_status_bar_item)
        .item(&toggle_markdown_toolbar_item)
        .item(&toggle_theme_item)
        .separator()
        .item(&toggle_terminal_item)
        .item(&toggle_ai_sidebar_item)
        .build()?;

    let undo_item = MenuItemBuilder::with_id("undo", l["undo"])
        .accelerator(get_accelerator("undo", "CmdOrCtrl+Z", custom_accel))
        .build(handle)?;
    let redo_item = MenuItemBuilder::with_id("redo", l["redo"])
        .accelerator(get_accelerator("redo", "CmdOrCtrl+Shift+Z", custom_accel))
        .build(handle)?;
    let cut_item = PredefinedMenuItem::cut(handle, None)?;
    let copy_item = PredefinedMenuItem::copy(handle, None)?;
    let paste_item = PredefinedMenuItem::paste(handle, None)?;
    let select_all_item = PredefinedMenuItem::select_all(handle, None)?;
    let markdown_code_mode_item =
        MenuItemBuilder::with_id("toggle-markdown-code-view", l["toggle-code-mode"])
            .accelerator(get_accelerator("toggle-markdown-code-view", "CmdOrCtrl+E", custom_accel))
            .build(handle)?;

    let edit_menu = SubmenuBuilder::new(handle, l["edit"])
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

    let menu_bar = MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&view_menu)
        .item(&edit_menu)
        .build()?;

    Ok((menu_bar, export_image_item, export_pdf_item, open_recent_submenu))
}

pub fn build_app_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let custom_accel = load_custom_accelerators(&handle);
    let (menu_bar, export_image_item, export_pdf_item, open_recent_submenu) =
        build_menu(&handle, &custom_accel)?;

    app.manage(ExportMenuState::new(
        export_image_item,
        export_pdf_item,
    ));

    let recent_menu_state = RecentMenuState::new(open_recent_submenu);
    recent_menu_state.set_app_handle(handle);
    app.manage(recent_menu_state);

    #[cfg(target_os = "windows")]
    {
        // Windows 上不设置菜单（使用前端自定义标题栏菜单），accelerators 仍会生效
    }

    #[cfg(not(target_os = "windows"))]
    app.set_menu(menu_bar)?;

    app.on_menu_event(|app, event| {
        let event_id = event.id().as_ref();
        let menu_event_name = format!("menu-{}", event_id);
        let _ = app.emit(&menu_event_name, ());
    });

    Ok(())
}

#[tauri::command]
pub fn rebuild_menu(app: AppHandle) -> Result<(), String> {
    let custom_accel = load_custom_accelerators(&app);
    let (menu_bar, export_image_item, export_pdf_item, open_recent_submenu) =
        build_menu(&app, &custom_accel).map_err(|e| e.to_string())?;

    // 更新 ExportMenuState 的引用
    if let Some(state) = app.try_state::<ExportMenuState>() {
        if let Ok(mut handles) = state.handles.lock() {
            *handles = ExportMenuHandles {
                image: export_image_item,
                pdf: export_pdf_item,
            };
        }
    }

    // 更新 RecentMenuState 的引用
    if let Some(state) = app.try_state::<RecentMenuState>() {
        state.replace_submenu(open_recent_submenu);
    }

    #[cfg(not(target_os = "windows"))]
    app.set_menu(menu_bar).map_err(|e| e.to_string())?;

    // 通知前端刷新最近文件菜单
    let _ = app.emit("menu-rebuilt", ());

    Ok(())
}
