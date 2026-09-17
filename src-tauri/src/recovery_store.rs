use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use uuid::Uuid;

use crate::fs_commands::write_file_atomically;

const INDEX_VERSION: u32 = 1;
const HISTORY_LIMIT_PER_DOCUMENT: usize = 20;

/// 串行化恢复仓库的索引与正文写入，避免并发编辑事件相互覆盖。
#[derive(Default)]
pub struct RecoveryStoreState(pub Mutex<()>);

/// 前端写入恢复点时使用的稳定载荷。
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshotInput {
    pub file_path: String,
    pub view_mode: String,
    pub content: String,
    pub revision: u64,
    pub disk_modified_time: Option<u64>,
    pub kind: String,
    /// 仅在成功保存产生历史版本时清除未保存恢复点；磁盘基线不会清除它。
    #[serde(default)]
    pub clear_pending: bool,
}

/// 恢复点索引元数据；正文单独存储，列表操作不会反复读取大文件。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshotMeta {
    pub id: String,
    pub file_path: String,
    pub view_mode: String,
    pub revision: u64,
    pub disk_modified_time: Option<u64>,
    pub captured_at: u64,
    pub byte_len: u64,
    pub kind: String,
}

/// 带正文的完整恢复点。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    #[serde(flatten)]
    pub meta: RecoverySnapshotMeta,
    pub content: String,
}

/// 磁盘索引信封，为未来迁移保留 schema 版本。
#[derive(Default, Deserialize, Serialize)]
struct RecoveryIndex {
    version: u32,
    entries: Vec<RecoverySnapshotMeta>,
}

/// 返回毫秒级 Unix 时间戳。
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 解析应用数据目录中的恢复仓库路径。
fn recovery_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("recovery");
    fs::create_dir_all(root.join("snapshots")).map_err(|error| error.to_string())?;
    Ok(root)
}

/// 返回恢复点正文文件路径；ID 只由后端 UUID 生成。
fn snapshot_path(root: &Path, id: &str) -> PathBuf {
    root.join("snapshots").join(format!("{id}.snapshot"))
}

/// 从磁盘读取索引，损坏或不存在时安全回退为空仓库。
fn read_index(root: &Path) -> RecoveryIndex {
    let path = root.join("index.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return RecoveryIndex {
            version: INDEX_VERSION,
            entries: Vec::new(),
        };
    };
    let Ok(mut index) = serde_json::from_str::<RecoveryIndex>(&raw) else {
        return RecoveryIndex {
            version: INDEX_VERSION,
            entries: Vec::new(),
        };
    };
    if index.version != INDEX_VERSION {
        index.version = INDEX_VERSION;
    }
    index
}

/// 原子写入文件，避免应用崩溃时留下半份索引或恢复正文。
fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_file_atomically(path, bytes).map_err(|error| error.to_string())
}

/// 持久化索引。
fn write_index(root: &Path, index: &RecoveryIndex) -> Result<(), String> {
    let encoded = serde_json::to_vec_pretty(index).map_err(|error| error.to_string())?;
    write_atomically(&root.join("index.json"), &encoded)
}

/// 删除索引条目对应的正文文件。
fn remove_snapshot_file(root: &Path, id: &str) {
    let _ = fs::remove_file(snapshot_path(root, id));
}

/// 对每个文档只保留最近的固定数量历史版本。
fn prune_history(index: &mut RecoveryIndex) -> Vec<String> {
    let mut histories: HashMap<String, Vec<RecoverySnapshotMeta>> = HashMap::new();
    for entry in index.entries.iter().filter(|entry| entry.kind == "history") {
        histories
            .entry(entry.file_path.clone())
            .or_default()
            .push(entry.clone());
    }

    let mut expired = Vec::new();
    for entries in histories.values_mut() {
        entries.sort_by(|left, right| right.captured_at.cmp(&left.captured_at));
        expired.extend(
            entries
                .iter()
                .skip(HISTORY_LIMIT_PER_DOCUMENT)
                .map(|entry| entry.id.clone()),
        );
    }
    if expired.is_empty() {
        return expired;
    }
    index.entries.retain(|entry| !expired.contains(&entry.id));
    expired
}

/// 校验前端传入的恢复点类型。
fn validate_kind(kind: &str) -> Result<(), String> {
    if matches!(kind, "pending" | "history") {
        Ok(())
    } else {
        Err(format!("unsupported recovery snapshot kind: {kind}"))
    }
}

/// 新建或更新恢复点。pending 每个文档只有一份，history 按保存次数追加。
#[tauri::command]
pub fn upsert_recovery_snapshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecoveryStoreState>,
    snapshot: RecoverySnapshotInput,
) -> Result<RecoverySnapshotMeta, String> {
    if snapshot.file_path.trim().is_empty() {
        return Err("recovery snapshot requires filePath".to_string());
    }
    validate_kind(&snapshot.kind)?;
    let _guard = state
        .0
        .lock()
        .map_err(|error| format!("recovery store lock poisoned: {error}"))?;
    let root = recovery_root(&app)?;
    let mut index = read_index(&root);

    if snapshot.kind == "history" {
        let latest = index
            .entries
            .iter()
            .filter(|entry| entry.file_path == snapshot.file_path && entry.kind == "history")
            .max_by_key(|entry| entry.captured_at)
            .cloned();
        if let Some(existing) = latest {
            if fs::read_to_string(snapshot_path(&root, &existing.id))
                .ok()
                .as_deref()
                == Some(snapshot.content.as_str())
            {
                let removed = if snapshot.clear_pending {
                    clear_pending_entries(&mut index, &snapshot.file_path)
                } else {
                    Vec::new()
                };
                write_index(&root, &index)?;
                remove_snapshot_files(&root, removed);
                return Ok(existing);
            }
        }
    }

    let mut removed = if snapshot.kind == "history" && snapshot.clear_pending {
        clear_pending_entries(&mut index, &snapshot.file_path)
    } else {
        Vec::new()
    };

    let existing_pending = if snapshot.kind == "pending" {
        index
            .entries
            .iter()
            .find(|entry| entry.file_path == snapshot.file_path && entry.kind == "pending")
            .cloned()
    } else {
        None
    };
    let id = existing_pending
        .as_ref()
        .map(|entry| entry.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let meta = RecoverySnapshotMeta {
        id: id.clone(),
        file_path: snapshot.file_path,
        view_mode: snapshot.view_mode,
        revision: snapshot.revision,
        disk_modified_time: snapshot.disk_modified_time,
        captured_at: now_millis(),
        byte_len: snapshot.content.len() as u64,
        kind: snapshot.kind,
    };
    write_atomically(&snapshot_path(&root, &id), snapshot.content.as_bytes())?;
    index.entries.retain(|entry| entry.id != id);
    index.entries.push(meta.clone());
    removed.extend(prune_history(&mut index));
    write_index(&root, &index)?;
    remove_snapshot_files(&root, removed);
    Ok(meta)
}

/// 从索引移除某个文档的 pending 条目，并返回提交索引后可清理的正文 ID。
fn clear_pending_entries(index: &mut RecoveryIndex, file_path: &str) -> Vec<String> {
    let ids = index
        .entries
        .iter()
        .filter(|entry| entry.file_path == file_path && entry.kind == "pending")
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    index.entries.retain(|entry| !ids.contains(&entry.id));
    ids
}

/// 在新索引已经原子提交后，清理不再被引用的正文文件。
fn remove_snapshot_files(root: &Path, ids: Vec<String>) {
    for id in ids {
        remove_snapshot_file(root, &id);
    }
}

/// 按文档路径和类型列出恢复点元数据。
#[tauri::command]
pub fn list_recovery_snapshots(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecoveryStoreState>,
    file_path: Option<String>,
    kind: Option<String>,
) -> Result<Vec<RecoverySnapshotMeta>, String> {
    if let Some(value) = kind.as_deref() {
        validate_kind(value)?;
    }
    let _guard = state
        .0
        .lock()
        .map_err(|error| format!("recovery store lock poisoned: {error}"))?;
    let root = recovery_root(&app)?;
    let mut entries = read_index(&root)
        .entries
        .into_iter()
        .filter(|entry| {
            file_path
                .as_ref()
                .map_or(true, |path| entry.file_path == *path)
        })
        .filter(|entry| kind.as_ref().map_or(true, |value| entry.kind == *value))
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| right.captured_at.cmp(&left.captured_at));
    Ok(entries)
}

/// 读取一份完整恢复点。
#[tauri::command]
pub fn read_recovery_snapshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecoveryStoreState>,
    id: String,
) -> Result<RecoverySnapshot, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|error| format!("recovery store lock poisoned: {error}"))?;
    let root = recovery_root(&app)?;
    let index = read_index(&root);
    let meta = index
        .entries
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "recovery snapshot not found".to_string())?;
    let content =
        fs::read_to_string(snapshot_path(&root, &meta.id)).map_err(|error| error.to_string())?;
    Ok(RecoverySnapshot { meta, content })
}

/// 删除指定恢复点。
#[tauri::command]
pub fn delete_recovery_snapshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecoveryStoreState>,
    id: String,
) -> Result<(), String> {
    let _guard = state
        .0
        .lock()
        .map_err(|error| format!("recovery store lock poisoned: {error}"))?;
    let root = recovery_root(&app)?;
    let mut index = read_index(&root);
    index.entries.retain(|entry| entry.id != id);
    write_index(&root, &index)?;
    remove_snapshot_file(&root, &id);
    Ok(())
}

/// 删除某个文档当前的未保存恢复点，保留历史版本。
#[tauri::command]
pub fn clear_pending_recovery(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecoveryStoreState>,
    file_path: String,
) -> Result<(), String> {
    let _guard = state
        .0
        .lock()
        .map_err(|error| format!("recovery store lock poisoned: {error}"))?;
    let root = recovery_root(&app)?;
    let mut index = read_index(&root);
    let removed = clear_pending_entries(&mut index, &file_path);
    write_index(&root, &index)?;
    remove_snapshot_files(&root, removed);
    Ok(())
}

/// 文件重命名后同步迁移恢复记录的身份。
#[tauri::command]
pub fn rename_recovery_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecoveryStoreState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let _guard = state
        .0
        .lock()
        .map_err(|error| format!("recovery store lock poisoned: {error}"))?;
    let root = recovery_root(&app)?;
    let mut index = read_index(&root);
    for entry in &mut index.entries {
        if entry.file_path == old_path {
            entry.file_path = new_path.clone();
        }
    }
    write_index(&root, &index)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 创建隔离的临时恢复仓库。
    fn test_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("mark2-recovery-test-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("snapshots")).unwrap();
        root
    }

    #[test]
    fn pending_snapshot_is_replaced_in_place() {
        let root = test_root();
        let mut index = RecoveryIndex {
            version: INDEX_VERSION,
            entries: Vec::new(),
        };
        let first = RecoverySnapshotMeta {
            id: Uuid::new_v4().to_string(),
            file_path: "/tmp/a.md".to_string(),
            view_mode: "markdown".to_string(),
            revision: 1,
            disk_modified_time: Some(1),
            captured_at: 1,
            byte_len: 3,
            kind: "pending".to_string(),
        };
        write_atomically(&snapshot_path(&root, &first.id), b"one").unwrap();
        index.entries.push(first.clone());
        let removed = clear_pending_entries(&mut index, "/tmp/a.md");
        assert!(snapshot_path(&root, &first.id).exists());
        remove_snapshot_files(&root, removed);
        assert!(index.entries.is_empty());
        assert!(!snapshot_path(&root, &first.id).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn history_is_pruned_per_document() {
        let root = test_root();
        let mut index = RecoveryIndex {
            version: INDEX_VERSION,
            entries: Vec::new(),
        };
        for captured_at in 0..25 {
            let id = Uuid::new_v4().to_string();
            write_atomically(&snapshot_path(&root, &id), b"version").unwrap();
            index.entries.push(RecoverySnapshotMeta {
                id,
                file_path: "/tmp/a.md".to_string(),
                view_mode: "markdown".to_string(),
                revision: captured_at,
                disk_modified_time: None,
                captured_at,
                byte_len: 7,
                kind: "history".to_string(),
            });
        }
        let expired = prune_history(&mut index);
        remove_snapshot_files(&root, expired);
        assert_eq!(index.entries.len(), HISTORY_LIMIT_PER_DOCUMENT);
        assert_eq!(
            index.entries.iter().map(|entry| entry.captured_at).min(),
            Some(5)
        );
        let _ = fs::remove_dir_all(root);
    }
}
