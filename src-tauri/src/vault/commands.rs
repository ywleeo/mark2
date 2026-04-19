// vault 对外 Tauri 命令 + 状态

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;

use super::generator::{generate, GenerateOptions};
use super::keychain::get_or_create_master_key;
use super::store::{self, VaultData, VaultEntry, VaultField};

const VAULT_FILE: &str = "vault.bin";
const CLIPBOARD_CLEAR_SECS: u64 = 30;

#[derive(Default)]
pub struct VaultState(pub Mutex<VaultStateInner>);

#[derive(Default)]
pub struct VaultStateInner {
    loaded: bool,
    key: Option<[u8; 32]>,
    path: Option<PathBuf>,
    data: VaultData,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(VAULT_FILE))
        .map_err(|err| format!("vault path unavailable: {err}"))
}

fn ensure_loaded(
    inner: &mut VaultStateInner,
    app: &AppHandle,
) -> Result<(), String> {
    if inner.loaded {
        return Ok(());
    }
    let key = get_or_create_master_key()?;
    let path = vault_path(app)?;
    let data = store::load(&path, &key)?;
    inner.key = Some(key);
    inner.path = Some(path);
    inner.data = data;
    inner.loaded = true;
    Ok(())
}

fn persist(inner: &VaultStateInner) -> Result<(), String> {
    let key = inner.key.as_ref().ok_or("vault key missing")?;
    let path = inner.path.as_ref().ok_or("vault path missing")?;
    store::save(path, key, &inner.data)
}

// ── 对外暴露的数据形态：secret 字段 value 置空，避免批量列表时泄露 ──

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultFieldView {
    pub label: String,
    pub value: String,
    pub secret: bool,
    pub has_value: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntryView {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub fields: Vec<VaultFieldView>,
    pub tags: Vec<String>,
    pub notes: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_used_at: Option<u64>,
}

fn mask_entry(entry: &VaultEntry) -> VaultEntryView {
    VaultEntryView {
        id: entry.id.clone(),
        name: entry.name.clone(),
        kind: entry.kind.clone(),
        fields: entry
            .fields
            .iter()
            .map(|f| VaultFieldView {
                label: f.label.clone(),
                value: if f.secret { String::new() } else { f.value.clone() },
                secret: f.secret,
                has_value: !f.value.is_empty(),
            })
            .collect(),
        tags: entry.tags.clone(),
        notes: entry.notes.clone(),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        last_used_at: entry.last_used_at,
    }
}

// ── 输入结构 ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFieldInput {
    pub label: String,
    pub value: String,
    #[serde(default)]
    pub secret: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntryInput {
    pub name: String,
    pub kind: String,
    pub fields: Vec<VaultFieldInput>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
}

impl VaultFieldInput {
    fn into_field(self) -> VaultField {
        VaultField {
            label: self.label,
            value: self.value,
            secret: self.secret,
        }
    }
}

// ── 命令 ──

#[tauri::command]
pub fn vault_list(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<VaultEntryView>, String> {
    let mut inner = state.0.lock().map_err(|e| format!("vault lock: {e}"))?;
    ensure_loaded(&mut inner, &app)?;
    Ok(inner.data.entries.iter().map(mask_entry).collect())
}

#[tauri::command]
pub fn vault_get_value(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
    label: String,
) -> Result<String, String> {
    let mut inner = state.0.lock().map_err(|e| format!("vault lock: {e}"))?;
    ensure_loaded(&mut inner, &app)?;
    let entry = inner
        .data
        .entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("vault entry not found: {id}"))?;
    let field = entry
        .fields
        .iter()
        .find(|f| f.label == label)
        .ok_or_else(|| format!("vault field not found: {label}"))?;
    Ok(field.value.clone())
}

#[tauri::command]
pub fn vault_add(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    input: VaultEntryInput,
) -> Result<String, String> {
    let mut inner = state.0.lock().map_err(|e| format!("vault lock: {e}"))?;
    ensure_loaded(&mut inner, &app)?;
    let now = now_secs();
    let id = Uuid::new_v4().to_string();
    let entry = VaultEntry {
        id: id.clone(),
        name: input.name,
        kind: input.kind,
        fields: input.fields.into_iter().map(|f| f.into_field()).collect(),
        tags: input.tags,
        notes: input.notes,
        created_at: now,
        updated_at: now,
        last_used_at: None,
    };
    inner.data.entries.push(entry);
    persist(&inner)?;
    Ok(id)
}

#[tauri::command]
pub fn vault_update(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
    input: VaultEntryInput,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| format!("vault lock: {e}"))?;
    ensure_loaded(&mut inner, &app)?;
    let now = now_secs();
    let entry = inner
        .data
        .entries
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("vault entry not found: {id}"))?;
    entry.name = input.name;
    entry.kind = input.kind;
    entry.fields = input.fields.into_iter().map(|f| f.into_field()).collect();
    entry.tags = input.tags;
    entry.notes = input.notes;
    entry.updated_at = now;
    persist(&inner)?;
    Ok(())
}

#[tauri::command]
pub fn vault_delete(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| format!("vault lock: {e}"))?;
    ensure_loaded(&mut inner, &app)?;
    let before = inner.data.entries.len();
    inner.data.entries.retain(|e| e.id != id);
    if inner.data.entries.len() == before {
        return Err(format!("vault entry not found: {id}"));
    }
    persist(&inner)?;
    Ok(())
}

#[tauri::command]
pub fn vault_mark_used(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| format!("vault lock: {e}"))?;
    ensure_loaded(&mut inner, &app)?;
    let now = now_secs();
    let entry = inner
        .data
        .entries
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("vault entry not found: {id}"))?;
    entry.last_used_at = Some(now);
    persist(&inner)?;
    Ok(())
}

#[tauri::command]
pub fn vault_generate_password(
    opts: Option<GenerateOptions>,
) -> Result<String, String> {
    generate(&opts.unwrap_or_default())
}

#[tauri::command]
pub fn vault_copy_to_clipboard(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
    label: String,
) -> Result<(), String> {
    let value = {
        let mut inner = state.0.lock().map_err(|e| format!("vault lock: {e}"))?;
        ensure_loaded(&mut inner, &app)?;
        let entry = inner
            .data
            .entries
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| format!("vault entry not found: {id}"))?;
        let value = entry
            .fields
            .iter()
            .find(|f| f.label == label)
            .map(|f| f.value.clone())
            .ok_or_else(|| format!("vault field not found: {label}"))?;
        entry.last_used_at = Some(now_secs());
        persist(&inner)?;
        value
    };

    app.clipboard()
        .write_text(value.clone())
        .map_err(|e| format!("clipboard write failed: {e}"))?;

    // 30s 后若剪贴板仍为该值则清空
    let handle = app.clone();
    let expected = value;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(CLIPBOARD_CLEAR_SECS)).await;
        let current = handle.clipboard().read_text().unwrap_or_default();
        if current == expected {
            let _ = handle.clipboard().write_text(String::new());
        }
    });

    Ok(())
}
