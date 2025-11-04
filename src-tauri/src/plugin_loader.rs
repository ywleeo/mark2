use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{path::BaseDirectory, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    pub frontend: Option<FrontendConfig>,
    pub backend: Option<BackendConfig>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub menu: Option<MenuConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuConfig {
    #[serde(default)]
    pub toggle: Option<MenuItemConfig>,
    #[serde(default)]
    pub settings: Option<MenuItemConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuItemConfig {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub accelerator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendConfig {
    pub entry: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendConfig {
    pub enabled: bool,
    #[serde(default)]
    pub commands: Vec<String>,
}

/// 扫描 plugins 目录，读取所有 manifest.json
pub fn scan_plugins_from_candidates(candidates: &[PathBuf]) -> Result<Vec<PluginManifest>, String> {
    let mut manifests = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    if candidates.is_empty() {
        println!("[PluginLoader] 未提供候选插件目录，返回空列表");
        return Ok(manifests);
    }

    for candidate in candidates {
        let plugins_dir = candidate;

        if !plugins_dir.exists() {
            println!(
                "[PluginLoader] 插件目录不存在，跳过: {}",
                plugins_dir.display()
            );
            continue;
        }

        println!("[PluginLoader] 正在扫描插件目录: {}", plugins_dir.display());

        let entries = fs::read_dir(plugins_dir)
            .map_err(|e| format!("读取插件目录失败 ({}): {}", plugins_dir.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
            let path = entry.path();

            if !path.is_dir() {
                continue;
            }

            let manifest_path = path.join("manifest.json");

            if !manifest_path.exists() {
                continue;
            }

            match fs::read_to_string(&manifest_path) {
                Ok(content) => match serde_json::from_str::<PluginManifest>(&content) {
                    Ok(manifest) => {
                        if seen_ids.insert(manifest.id.clone()) {
                            println!(
                                "[PluginLoader] 发现插件: {} ({})",
                                manifest.name, manifest.id
                            );
                            manifests.push(manifest);
                        } else {
                            println!(
                                "[PluginLoader] 插件已存在，忽略重复项: {} ({})",
                                manifest.name, manifest.id
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[PluginLoader] 解析 manifest.json 失败 ({}): {}",
                            manifest_path.display(),
                            e
                        );
                    }
                },
                Err(e) => {
                    eprintln!(
                        "[PluginLoader] 读取 manifest.json 失败 ({}): {}",
                        manifest_path.display(),
                        e
                    );
                }
            }
        }
    }

    println!("[PluginLoader] 总共发现 {} 个插件", manifests.len());
    Ok(manifests)
}

fn default_candidate_dirs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // 运行目录相对路径（开发模式）
    candidates.push(PathBuf::from("../plugins"));
    candidates.push(PathBuf::from("plugins"));

    // 打包后位于 Resources/plugins
    candidates.push(PathBuf::from("../Resources/plugins"));
    candidates.push(PathBuf::from("Resources/plugins"));

    // 尝试根据当前可执行文件推断
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(base) = current_exe.parent() {
            candidates.push(base.join("../plugins"));
            candidates.push(base.join("../../plugins"));
            candidates.push(base.join("../Resources/plugins"));
            candidates.push(base.join("Resources/plugins"));
        }
    }

    candidates
}

/// 默认使用候选目录扫描插件（供菜单等场景使用）
pub fn scan_plugins() -> Result<Vec<PluginManifest>, String> {
    let candidates = default_candidate_dirs();
    scan_plugins_from_candidates(&candidates)
}

/// Tauri 命令：列出所有插件
#[tauri::command]
pub fn list_plugins(app_handle: tauri::AppHandle) -> Result<Vec<PluginManifest>, String> {
    let mut candidates = Vec::new();

    let resolver = app_handle.path();
    if let Ok(resource_plugins) = resolver.resolve(Path::new("plugins"), BaseDirectory::Resource) {
        candidates.push(resource_plugins);
    }
    if let Ok(resource_dir) = resolver.resource_dir() {
        candidates.push(resource_dir.join("plugins"));
    }
    // 追加默认候选路径
    candidates.extend(default_candidate_dirs());

    scan_plugins_from_candidates(&candidates)
}
