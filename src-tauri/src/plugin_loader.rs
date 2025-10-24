use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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
pub fn scan_plugins() -> Result<Vec<PluginManifest>, String> {
    // 获取项目根目录下的 plugins 目录
    let plugins_dir = PathBuf::from("plugins");

    if !plugins_dir.exists() {
        println!("[PluginLoader] plugins 目录不存在，创建空目录");
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();

    let entries = fs::read_dir(&plugins_dir).map_err(|e| {
        format!("读取 plugins 目录失败: {}", e)
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();

        // 跳过非目录
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");

        if manifest_path.exists() {
            match fs::read_to_string(&manifest_path) {
                Ok(content) => {
                    match serde_json::from_str::<PluginManifest>(&content) {
                        Ok(manifest) => {
                            println!("[PluginLoader] 发现插件: {} ({})", manifest.name, manifest.id);
                            manifests.push(manifest);
                        }
                        Err(e) => {
                            eprintln!("[PluginLoader] 解析 manifest.json 失败 ({}): {}", manifest_path.display(), e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[PluginLoader] 读取 manifest.json 失败 ({}): {}", manifest_path.display(), e);
                }
            }
        }
    }

    println!("[PluginLoader] 总共发现 {} 个插件", manifests.len());
    Ok(manifests)
}

/// Tauri 命令：列出所有插件
#[tauri::command]
pub fn list_plugins() -> Result<Vec<PluginManifest>, String> {
    scan_plugins()
}
