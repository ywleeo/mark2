use base64::Engine;
use font_kit::source::SystemSource;
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::time::SystemTime;
use tauri::Manager;

#[cfg(target_os = "macos")]
use objc2_app_kit::NSPasteboard;
#[cfg(target_os = "macos")]
use objc2_foundation::NSURL;

#[cfg(target_os = "macos")]
use crate::macos_security::move_path_to_trash;

#[derive(Serialize)]
pub struct FileMetadata {
    pub modified_time: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryPayload {
    pub ts: String,
    pub domain: String,
    pub level: String,
    pub message: String,
    pub context: serde_json::Value,
}

/**
 * 返回统一日志文件路径。
 * 当前先收敛到单文件，后续如需按日期切分可在此处扩展。
 */
fn resolve_app_log_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    if !log_dir.exists() {
        fs::create_dir_all(&log_dir).map_err(|err| err.to_string())?;
    }
    Ok(log_dir.join("mark2-debug.log"))
}

#[tauri::command]
pub fn open_path_in_browser(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn is_directory(path: String) -> Result<bool, String> {
    Path::new(&path)
        .metadata()
        .map(|m| m.is_dir())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    let modified_time = modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    Ok(FileMetadata { modified_time })
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

fn encode_file_base64(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    Ok(encoded)
}

#[tauri::command]
pub fn read_image_base64(path: String) -> Result<String, String> {
    encode_file_base64(&path)
}

#[tauri::command]
pub fn read_binary_base64(path: String) -> Result<String, String> {
    encode_file_base64(&path)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    use objc2::rc::autoreleasepool;
    use objc2::ClassType;
    use objc2_foundation::NSArray;
    use crate::macos_security::nsstring_to_string;

    unsafe {
        autoreleasepool(|_| {
            let pasteboard = NSPasteboard::generalPasteboard();

            let types = pasteboard.types();
            if types.is_none() {
                return Ok(Vec::new());
            }

            let classes = NSArray::from_slice(&[NSURL::class()]);
            let urls = pasteboard.readObjectsForClasses_options(&classes, None);

            if let Some(urls) = urls {
                let mut file_paths = Vec::new();
                let count = urls.len();
                for i in 0..count {
                    let url = urls.objectAtIndex(i);
                    let url_ref = &*(&*url as *const _ as *const NSURL);
                    if url_ref.isFileURL() {
                        if let Some(path) = url_ref.path() {
                            file_paths.push(nsstring_to_string(&path));
                        }
                    }
                }
                Ok(file_paths)
            } else {
                Ok(Vec::new())
            }
        })
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    Err("此功能仅在 macOS 上可用".to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn append_log_entries(
    app: tauri::AppHandle,
    entries: Vec<LogEntryPayload>,
) -> Result<String, String> {
    if entries.is_empty() {
        return get_app_log_file_path(app);
    }

    let log_file = resolve_app_log_file_path(&app)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|err| err.to_string())?;

    for entry in entries {
        let line = serde_json::to_string(&entry).map_err(|err| err.to_string())?;
        file.write_all(line.as_bytes()).map_err(|err| err.to_string())?;
        file.write_all(b"\n").map_err(|err| err.to_string())?;
    }

    Ok(log_file.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_app_log_file_path(app: tauri::AppHandle) -> Result<String, String> {
    let log_file = resolve_app_log_file_path(&app)?;
    Ok(log_file.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<String>, String> {
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
pub fn delete_entry(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        move_path_to_trash(&path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn rename_entry(source: String, destination: String) -> Result<(), String> {
    let target_path = Path::new(&destination);
    if let Some(parent) = target_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::rename(&source, &destination).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ipc_health_check() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn list_fonts() -> Result<Vec<String>, String> {
    let source = SystemSource::new();
    let mut families = source.all_families().map_err(|err| err.to_string())?;
    families.sort();
    families.dedup();
    Ok(families)
}

#[tauri::command]
pub async fn capture_screenshot(destination: String, image_data: String) -> Result<(), String> {
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

#[cfg(target_os = "windows")]
fn reveal_in_file_manager_impl(path: &str) -> Result<(), String> {
    use std::process::Command;

    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let windows_path = path.replace('/', "\\");

    let mut command = Command::new("explorer.exe");
    if metadata.is_dir() {
        command.arg(&windows_path);
    } else {
        command.arg(format!(r#"/select,"{}""#, windows_path));
    }

    let _status = command
        .status()
        .map_err(|e| e.to_string())?;

    // explorer 返回 1 也算成功（正常行为）
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn reveal_in_file_manager_impl(_path: &str) -> Result<(), String> {
    Err("unsupported".to_string())
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径为空".to_string());
    }

    if !Path::new(&path).exists() {
        return Err("路径不存在".to_string());
    }

    reveal_in_file_manager_impl(&path)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_in_terminal(command: String, cwd: Option<String>) -> Result<(), String> {
    use std::io::Write;
    use std::process::Command;

    let script_content = if let Some(dir) = &cwd {
        format!(
            "#!/bin/bash\ncd '{}' && {}\n",
            dir.replace("'", "'\\''"),
            command
        )
    } else {
        format!("#!/bin/bash\n{}\n", command)
    };

    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(format!("mark2_run_{}.sh", std::process::id()));

    let mut file = std::fs::File::create(&script_path).map_err(|e| e.to_string())?;
    file.write_all(script_content.as_bytes())
        .map_err(|e| e.to_string())?;

    Command::new("chmod")
        .arg("+x")
        .arg(&script_path)
        .status()
        .map_err(|e| e.to_string())?;

    let status = Command::new("open")
        .arg("-a")
        .arg("Terminal")
        .arg(&script_path)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("open 命令返回非零状态: {:?}", status.code()))
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn open_in_terminal(_command: String, _cwd: Option<String>) -> Result<(), String> {
    Err("仅支持 macOS".to_string())
}
