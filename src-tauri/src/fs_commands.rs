use base64::Engine;
use font_kit::source::SystemSource;
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::Path;
use std::time::SystemTime;
use tauri::Manager;
use uuid::Uuid;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
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
        .as_millis() as u64;

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
    write_file_atomically(Path::new(&path), content.as_bytes()).map_err(|error| error.to_string())
}

/**
 * 将完整内容写入同目录临时文件后原子替换目标文件。
 * 同目录保证 rename 不跨文件系统，sync_all 保证替换前数据已经交给操作系统落盘。
 */
fn write_file_atomically(path: &Path, content: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document");
    let temp_path = parent.join(format!(".{file_name}.mark2-{}.tmp", Uuid::new_v4()));

    let write_result = (|| -> io::Result<()> {
        let mut temp_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;

        if let Ok(metadata) = fs::metadata(path) {
            temp_file.set_permissions(metadata.permissions())?;
        }

        temp_file.write_all(content)?;
        temp_file.sync_all()?;
        drop(temp_file);

        replace_file_atomically(&temp_path, path)?;
        sync_parent_directory(parent);
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

/** 使用平台原生语义原子替换目标文件。 */
#[cfg(not(target_os = "windows"))]
fn replace_file_atomically(source: &Path, target: &Path) -> io::Result<()> {
    fs::rename(source, target)
}

/** Windows 的 rename 不能覆盖已有文件，使用 MoveFileExW 完成原子替换。 */
#[cfg(target_os = "windows")]
fn replace_file_atomically(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/** Unix 下同步父目录，确保替换后的目录项在崩溃恢复后可见。 */
#[cfg(unix)]
fn sync_parent_directory(parent: &Path) {
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
}

/** Windows 的 MoveFileExW WRITE_THROUGH 已覆盖目录项持久化。 */
#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) {}

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
pub fn read_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let iter = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in iter.flatten() {
        let path_buf = entry.path();
        let path_str = match path_buf.to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        // file_type() 不跟随符号链接，并由 readdir 的 d_type 直接得到，避免对每个条目额外 stat
        let is_dir = match entry.file_type() {
            Ok(ft) => ft.is_dir(),
            Err(_) => continue,
        };
        result.push(DirEntryInfo {
            path: path_str,
            name,
            is_dir,
        });
    }
    Ok(result)
}

#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        move_path_to_trash(&path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        // trash 失败时加 trash_unsupported: 前缀，前端识别后弹"永久删除"二次确认。
        // WSL / 网络驱动器等不支持 Windows 回收站会走到这里。
        trash::delete(&path).map_err(|e| format!("trash_unsupported:{}", e))
    }
}

#[tauri::command]
pub fn delete_entry_permanent(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let meta = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
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
pub fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&path, data).map_err(|e| e.to_string())
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

    if metadata.is_dir() {
        Command::new("explorer.exe")
            .arg(&windows_path)
            .status()
            .map_err(|e| e.to_string())?;
    } else {
        // 使用 PowerShell 来执行，这样可以更好地处理包含空格和特殊字符的路径
        let ps_command = format!(
            "Start-Process explorer.exe -ArgumentList '/select,\"{}\"'",
            windows_path
        );
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_command])
            .status()
            .map_err(|e| e.to_string())?;
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    /** 验证原子写可覆盖旧内容，并且不会遗留临时文件。 */
    #[test]
    fn atomic_write_replaces_content_without_temp_files() {
        let test_dir = std::env::temp_dir().join(format!("mark2-atomic-write-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).expect("create test directory");
        let target = test_dir.join("document.md");
        fs::write(&target, "old content").expect("write initial content");

        write_file_atomically(&target, b"new complete content").expect("atomic write");

        assert_eq!(fs::read_to_string(&target).expect("read target"), "new complete content");
        let remaining: Vec<_> = fs::read_dir(&test_dir)
            .expect("read test directory")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(remaining.len(), 1);

        fs::remove_dir_all(&test_dir).expect("remove test directory");
    }
}
