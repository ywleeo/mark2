// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod macos_security;

mod ai_proxy;
mod fs_commands;
mod media_stream;
mod menu;
mod pty;
mod security_scope;
mod spreadsheet;
mod window_state;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::async_runtime;
use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri::webview::WebviewWindowBuilder;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone, Serialize)]
struct PlainPastePayload {
    text: String,
}

#[derive(Clone, Serialize)]
struct OpenedFilesPayload {
    paths: Vec<String>,
}

#[derive(Default)]
struct OpenedFilesState {
    paths: Mutex<Vec<String>>,
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
fn get_opened_files(state: tauri::State<'_, OpenedFilesState>) -> Result<Vec<String>, String> {
    let mut guard = state
        .paths
        .lock()
        .map_err(|err| format!("opened files lock poisoned: {err}"))?;
    let paths = std::mem::take(&mut *guard);
    Ok(paths)
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
fn read_clipboard_text(app: tauri::AppHandle) -> Result<String, String> {
    app.clipboard().read_text().map_err(|e| e.to_string())
}

fn main() {
    std::env::set_var("TOKIO_WORKER_THREADS", "4");

    tauri::Builder::default()
        .register_uri_scheme_protocol("stream", |_, request| {
            media_stream::build_stream_response(&request).unwrap_or_else(|e| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header("Content-Type", "text/plain")
                    .body(format!("stream error: {}", e).into_bytes())
                    .unwrap()
            })
        })
        .manage(WorkspaceState::default())
        .manage(DocumentState::default())
        .manage(ai_proxy::AiProxyState::default())
        .manage(pty::PtyState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            fs_commands::open_path_in_browser,
            fs_commands::is_directory,
            fs_commands::read_file,
            fs_commands::read_image_base64,
            fs_commands::read_binary_base64,
            fs_commands::read_clipboard_file_paths,
            fs_commands::write_file,
            fs_commands::append_log_entries,
            fs_commands::get_app_log_file_path,
            fs_commands::read_dir,
            fs_commands::delete_entry,
            fs_commands::rename_entry,
            fs_commands::create_directory,
            fs_commands::ipc_health_check,
            fs_commands::list_fonts,
            fs_commands::capture_screenshot,
            fs_commands::get_file_metadata,
            fs_commands::reveal_in_file_manager,
            fs_commands::open_in_terminal,
            spreadsheet::read_spreadsheet,
            security_scope::pick_path,
            security_scope::capture_security_scope,
            security_scope::restore_security_scoped_access,
            menu::set_export_menu_enabled,
            menu::update_recent_menu,
            update_workspace_context,
            update_document_snapshot,
            get_opened_files,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            ai_proxy::ai_proxy_json_request,
            ai_proxy::ai_proxy_start_stream,
            ai_proxy::ai_proxy_cancel_stream,
            read_clipboard_text,
        ])
        .manage(OpenedFilesState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            register_plain_paste_shortcut(&handle);
            menu::build_app_menu(app)?;

            // ── 动态创建主窗口（恢复上次尺寸/位置） ──
            let ws = window_state::load(&handle);
            let mut builder = WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("")
                .inner_size(ws.width, ws.height)
                .resizable(true)
                .fullscreen(ws.fullscreen)
                .visible(false) // 先隐藏，JS ready 后 show
                .accept_first_mouse(true);

            #[cfg(target_os = "macos")]
            {
                builder = builder
                    .hidden_title(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay);
            }

            #[cfg(target_os = "windows")]
            {
                builder = builder
                    .decorations(false);
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                builder = builder.decorations(true);
            }

            // 只在有保存过位置时恢复（x/y >= 0 表示有效值）
            if ws.x >= 0.0 && ws.y >= 0.0 {
                builder = builder.position(ws.x, ws.y);
            }

            let win = builder.build()?;

            if ws.maximized && !ws.fullscreen {
                let _ = win.maximize();
            }

            // ── 窗口状态保存：resize / move debounce ──
            let save_handle = handle.clone();
            let debounce_timer: std::sync::Arc<Mutex<Option<async_runtime::JoinHandle<()>>>> =
                std::sync::Arc::new(Mutex::new(None));

            let schedule_save = {
                let debounce_timer = debounce_timer.clone();
                let save_handle = save_handle.clone();
                move || {
                    let save_handle = save_handle.clone();
                    if let Ok(mut guard) = debounce_timer.lock() {
                        if let Some(prev) = guard.take() {
                            prev.abort();
                        }
                        *guard = Some(async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            if let Some(win) = save_handle.get_webview_window("main") {
                                let maximized = win.is_maximized().unwrap_or(false);
                                let fullscreen = win.is_fullscreen().unwrap_or(false);
                                if maximized || fullscreen {
                                    // 只更新标志，不覆盖 normal 尺寸
                                    let mut prev = window_state::load(&save_handle);
                                    prev.maximized = maximized;
                                    prev.fullscreen = fullscreen;
                                    window_state::save(&save_handle, &prev);
                                    return;
                                }
                                let factor = win.scale_factor().unwrap_or(1.0);
                                if let (Ok(size), Ok(pos)) = (win.inner_size(), win.outer_position()) {
                                    let state = window_state::WindowState {
                                        width: size.width as f64 / factor,
                                        height: size.height as f64 / factor,
                                        x: pos.x as f64 / factor,
                                        y: pos.y as f64 / factor,
                                        maximized: false,
                                        fullscreen: false,
                                    };
                                    window_state::save(&save_handle, &state);
                                }
                            }
                        }));
                    }
                }
            };

            let on_resize = schedule_save.clone();
            win.listen("tauri://resize", move |_| { on_resize(); });
            let on_move = schedule_save.clone();
            win.listen("tauri://move", move |_| { on_move(); });

            // ── Windows: 读取命令行参数中的文件路径 ──
            #[cfg(target_os = "windows")]
            {
                let args: Vec<String> = std::env::args().skip(1).collect();
                let file_paths: Vec<String> = args
                    .into_iter()
                    .filter(|arg| !arg.starts_with('-'))
                    .filter(|arg| std::path::Path::new(arg).exists())
                    .collect();
                if !file_paths.is_empty() {
                    if let Some(state) = app.try_state::<OpenedFilesState>() {
                        if let Ok(mut guard) = state.paths.lock() {
                            guard.extend(file_paths);
                        }
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| {
                        if url.scheme() == "file" {
                            url.to_file_path()
                                .ok()
                                .and_then(|p| p.to_str().map(|s| s.to_string()))
                        } else {
                            None
                        }
                    })
                    .collect();

                if paths.is_empty() {
                    return;
                }

                if let Some(window) = _app.get_webview_window("main") {
                    let payload = OpenedFilesPayload {
                        paths: paths.clone(),
                    };
                    if window.emit("files-opened", payload).is_ok() {
                        return;
                    }
                }

                if let Some(state) = _app.try_state::<OpenedFilesState>() {
                    if let Ok(mut guard) = state.paths.lock() {
                        guard.extend(paths);
                    }
                }
            }
        });
}
