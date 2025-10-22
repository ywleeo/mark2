use crate::ai::config::{load_config, save_config, AiConfig, AiConfigSnapshot, AiConfigUpdate};
use parking_lot::{Mutex, RwLock};
use std::path::PathBuf;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

pub struct AiState {
    inner: RwLock<AiConfig>,
    config_path: PathBuf,
    active_tasks: Mutex<HashMap<String, Arc<AtomicBool>>>,
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
            active_tasks: Mutex::new(HashMap::new()),
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

    pub fn register_task(&self, task_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.active_tasks
            .lock()
            .insert(task_id.to_string(), flag.clone());
        flag
    }

    pub fn cancel_task(&self, task_id: &str) -> bool {
        if let Some(flag) = self.active_tasks.lock().get(task_id) {
            flag.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    pub fn unregister_task(&self, task_id: &str) {
        self.active_tasks.lock().remove(task_id);
    }
}
