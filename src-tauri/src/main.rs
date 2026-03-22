// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod macos_security;

mod fs_commands;
mod media_stream;
mod menu;
mod pty;
mod security_scope;
mod spreadsheet;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::async_runtime;
use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager};
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
        ])
        .manage(OpenedFilesState::default())
        .setup(|app| {
            let handle = app.handle();
            register_plain_paste_shortcut(&handle);
            menu::build_app_menu(app)?;
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
