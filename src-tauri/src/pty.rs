/**
 * PTY (Pseudo Terminal) 管理模块
 * 提供终端模拟功能
 */
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

/// PTY 实例
pub struct PtyInstance {
    pub pair: PtyPair,
    pub writer: Box<dyn Write + Send>,
}

/// PTY 管理器状态
pub struct PtyState {
    pub instances: Mutex<HashMap<String, Arc<Mutex<PtyInstance>>>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
        }
    }
}

/// 生成唯一的 PTY ID
fn generate_pty_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("pty_{}", timestamp)
}

/// 创建新的 PTY 实例
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // 获取默认 shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // login shell

    // 设置工作目录
    if let Some(dir) = cwd {
        cmd.cwd(&dir);
    }

    // 设置环境变量
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env_remove("PATH"); // 移除继承的 PATH，让 login shell 自己加载

    // 启动子进程
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // 获取读写句柄
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    let pty_id = generate_pty_id();
    let pty_id_clone = pty_id.clone();

    // 创建 PTY 实例
    let instance = Arc::new(Mutex::new(PtyInstance { pair, writer }));

    // 存储实例
    {
        let mut instances = state.instances.lock().unwrap();
        instances.insert(pty_id.clone(), instance.clone());
    }

    // 启动读取线程
    let app_handle = app.clone();
    let pty_id_for_cleanup = pty_id.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF - 进程已退出
                    println!("[PTY {}] EOF", pty_id_clone);
                    let _ = app_handle.emit(&format!("pty-exit:{}", pty_id_clone), ());
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(&format!("pty-data:{}", pty_id_clone), data);
                }
                Err(e) => {
                    eprintln!("[PTY {}] Read error: {}", pty_id_clone, e);
                    let _ = app_handle.emit(&format!("pty-exit:{}", pty_id_clone), ());
                    break;
                }
            }
        }

        // 清理实例
        let state = app_handle.state::<PtyState>();
        if let Ok(mut instances) = state.instances.lock() {
            instances.remove(&pty_id_for_cleanup);
        }

        // 等待子进程退出
        let _ = child.wait();
    });

    println!("[PTY] Spawned: {}", pty_id);
    Ok(pty_id)
}

/// 向 PTY 写入数据
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, pty_id: String, data: String) -> Result<(), String> {
    let instances = state.instances.lock().unwrap();

    if let Some(instance) = instances.get(&pty_id) {
        let mut instance = instance.lock().unwrap();
        instance
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        instance
            .writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    } else {
        Err(format!("PTY not found: {}", pty_id))
    }
}

/// 调整 PTY 大小
#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let instances = state.instances.lock().unwrap();

    if let Some(instance) = instances.get(&pty_id) {
        let instance = instance.lock().unwrap();
        instance
            .pair
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    } else {
        Err(format!("PTY not found: {}", pty_id))
    }
}

/// 关闭 PTY
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, pty_id: String) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();

    if instances.remove(&pty_id).is_some() {
        println!("[PTY] Killed: {}", pty_id);
        Ok(())
    } else {
        Err(format!("PTY not found: {}", pty_id))
    }
}
