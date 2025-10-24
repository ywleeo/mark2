use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorContext {
    pub workspace_root: Option<String>,
    pub active_file: Option<String>,
    pub open_files: Vec<String>,
    pub selection: Option<SelectionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionInfo {
    pub file: String,
    pub text: String,
}

/// 解析并验证文件路径（确保在工作目录内）
fn resolve_safe_path(workspace_root: Option<&Path>, relative: &str) -> Result<PathBuf, String> {
    // 如果没有工作目录，直接使用绝对路径
    let Some(root) = workspace_root else {
        let path = PathBuf::from(relative);
        if path.is_absolute() {
            return Ok(path);
        } else {
            return Err("没有工作目录，无法解析相对路径".to_string());
        }
    };

    // 解析相对路径
    let full_path = if Path::new(relative).is_absolute() {
        PathBuf::from(relative)
    } else {
        root.join(relative)
    };

    // 规范化路径
    let canonical = full_path
        .canonicalize()
        .or_else(|_| {
            // 文件可能不存在，尝试规范化父目录
            if let Some(parent) = full_path.parent() {
                if parent.exists() {
                    let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
                    if let Some(file_name) = full_path.file_name() {
                        return Ok(canonical_parent.join(file_name));
                    }
                }
            }
            Err(format!("无法解析路径: {}", relative))
        })?;

    // 验证是否在工作目录内
    if canonical.starts_with(root) {
        Ok(canonical)
    } else {
        Err(format!("路径超出工作目录范围: {}", relative))
    }
}

#[tauri::command]
pub fn ai_read_file(
    path: String,
    workspace_root: Option<String>,
) -> Result<String, String> {
    let root_path = workspace_root.as_ref().map(|s| Path::new(s));
    let safe_path = resolve_safe_path(root_path, &path)?;

    fs::read_to_string(&safe_path).map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
pub fn ai_write_file(
    path: String,
    content: String,
    workspace_root: Option<String>,
) -> Result<(), String> {
    let root_path = workspace_root.as_ref().map(|s| Path::new(s));
    let safe_path = resolve_safe_path(root_path, &path)?;

    // 确保父目录存在
    if let Some(parent) = safe_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    fs::write(&safe_path, content).map_err(|e| format!("写入文件失败: {}", e))
}

#[tauri::command]
pub fn ai_replace_content(
    path: String,
    old_text: String,
    new_text: String,
    workspace_root: Option<String>,
) -> Result<(), String> {
    let root_path = workspace_root.as_ref().map(|s| Path::new(s));
    let safe_path = resolve_safe_path(root_path, &path)?;

    let content = fs::read_to_string(&safe_path)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    // 检查是否存在要替换的内容
    if !content.contains(&old_text) {
        return Err(format!("文件中未找到要替换的内容"));
    }

    let new_content = content.replace(&old_text, &new_text);

    fs::write(&safe_path, new_content)
        .map_err(|e| format!("写入文件失败: {}", e))
}

#[tauri::command]
pub fn ai_insert_content(
    path: String,
    position: String,
    content: String,
    workspace_root: Option<String>,
) -> Result<(), String> {
    let root_path = workspace_root.as_ref().map(|s| Path::new(s));
    let safe_path = resolve_safe_path(root_path, &path)?;

    let existing = fs::read_to_string(&safe_path)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let new_content = match position.as_str() {
        "start" => format!("{}{}", content, existing),
        "end" => format!("{}{}", existing, content),
        _ => {
            // 尝试解析为行号
            let line_num: usize = position.parse()
                .map_err(|_| format!("无效的位置参数: {}", position))?;

            let lines: Vec<&str> = existing.lines().collect();
            if line_num > lines.len() {
                return Err(format!("行号超出范围: {}", line_num));
            }

            let mut result = String::new();
            for (i, line) in lines.iter().enumerate() {
                if i == line_num {
                    result.push_str(&content);
                    result.push('\n');
                }
                result.push_str(line);
                result.push('\n');
            }
            if line_num == lines.len() {
                result.push_str(&content);
            }
            result
        }
    };

    fs::write(&safe_path, new_content)
        .map_err(|e| format!("写入文件失败: {}", e))
}

#[tauri::command]
pub fn ai_get_editor_context(
    workspace_root: Option<String>,
    active_file: Option<String>,
    open_files: Option<Vec<String>>,
    selection: Option<SelectionInfo>,
) -> Result<EditorContext, String> {
    Ok(EditorContext {
        workspace_root,
        active_file,
        open_files: open_files.unwrap_or_default(),
        selection,
    })
}
