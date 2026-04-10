use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const STATE_FILE: &str = "window-state.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
    pub maximized: bool,
    pub fullscreen: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1200.0,
            height: 800.0,
            x: -1.0, // sentinel: let OS decide
            y: -1.0,
            maximized: false,
            fullscreen: false,
        }
    }
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(STATE_FILE))
}

pub fn load(app: &AppHandle) -> WindowState {
    let Some(path) = state_path(app) else {
        return WindowState::default();
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, state: &WindowState) {
    let Some(path) = state_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string(state).unwrap_or_default());
}
