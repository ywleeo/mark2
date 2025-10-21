use crate::ai::config::{load_config, save_config, AiConfig, AiConfigSnapshot, AiConfigUpdate};
use parking_lot::RwLock;
use std::path::PathBuf;
use tauri::Manager;

pub struct AiState {
    inner: RwLock<AiConfig>,
    config_path: PathBuf,
}

impl AiState {
    pub fn initialize(app: &tauri::AppHandle) -> Result<Self, String> {
        let resolver = app.path();
        let config_dir = resolver
            .app_config_dir()
            .map_err(|err| err.to_string())?;

        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir).map_err(|err| err.to_string())?;
        }

        let config_path = config_dir.join("ai-config.json");
        let config = match load_config(&config_path) {
            Ok(cfg) => cfg,
            Err(err) => {
                eprintln!("读取 AI 配置失败，将使用默认配置: {}", err);
                AiConfig::default()
            }
        };

        Ok(Self {
            inner: RwLock::new(config),
            config_path,
        })
    }

    pub fn snapshot(&self) -> AiConfigSnapshot {
        let config = self.inner.read().clone();
        AiConfigSnapshot::from(&config)
    }

    pub fn get_config(&self) -> AiConfig {
        self.inner.read().clone()
    }

    pub fn update_config(&self, update: AiConfigUpdate) -> Result<(), String> {
        {
            let mut guard = self.inner.write();
            guard.apply_update(update);
            save_config(&self.config_path, &guard)?;
        }
        Ok(())
    }

    pub fn clear_api_key(&self) -> Result<(), String> {
        {
            let mut guard = self.inner.write();
            guard.api_key = None;
            save_config(&self.config_path, &guard)?;
        }
        Ok(())
    }
}
