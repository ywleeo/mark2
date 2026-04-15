/**
 * PTY (Pseudo Terminal) 管理模块
 * 提供终端模拟功能
 */
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

/// PTY 实例
pub struct PtyInstance {
    pub pair: PtyPair,
    pub writer: Box<dyn Write + Send>,
    pub killer: Box<dyn ChildKiller + Send + Sync>,
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

/// 检测是否在沙盒环境中运行
/// MAS 版本会设置 APP_SANDBOX_CONTAINER_ID 环境变量
fn is_sandboxed() -> bool {
    std::env::var("APP_SANDBOX_CONTAINER_ID").is_ok()
}

/// 获取用户的默认 shell
/// macOS 使用 dscl 查询用户的 UserShell，不依赖可能被修改的 SHELL 环境变量
/// 注意：沙盒应用只能访问系统自带的 shell，不能访问 Homebrew 等第三方安装的 shell
fn get_user_shell() -> String {
    #[cfg(target_os = "macos")]
    {
        let sandboxed = is_sandboxed();

        if let Ok(username) = std::env::var("USER") {
            if let Ok(output) = std::process::Command::new("dscl")
                .args([".", "-read", &format!("/Users/{}", username), "UserShell"])
                .output()
            {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    // 输出格式: "UserShell: /bin/zsh"
                    if let Some(shell) = stdout.trim().strip_prefix("UserShell:") {
                        let shell_path = shell.trim();
                        // 沙盒应用只能访问 /bin 下的系统 shell
                        // 非沙盒应用可以使用用户的完整 shell（包括 Homebrew 安装的）
                        if !sandboxed || shell_path.starts_with("/bin/") {
                            return shell_path.to_string();
                        }
                    }
                }
            }
        }
    }
    // fallback
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        // macOS Catalina+ 默认 shell
        "/bin/zsh".to_string()
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

#[derive(serde::Serialize, Clone)]
struct PtyExitPayload {
    code: Option<u32>,
}

/// 创建新的 PTY 实例
/// event_id: 可选的事件 ID，用于事件命名。如果提供，使用 event_id 作为事件名；否则使用 ptyId
///           这允许 JS 端在调用 spawn 之前先设置好 listener，避免竞态条件
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    command: Option<String>,
    event_id: Option<String>,
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

    // 获取用户的默认 shell（macOS 使用 dscl 查询，不依赖可能被修改的 SHELL 环境变量）
    let shell = get_user_shell();

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // login shell
    if let Some(command) = command {
        cmd.arg("-i"); // interactive, load rc files for env
        cmd.arg("-c");
        cmd.arg(command);
    }

    // 设置工作目录
    if let Some(dir) = cwd {
        cmd.cwd(&dir);
    }

    // 设置环境变量
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("CLICOLOR", "1"); // macOS: 让 ls 等命令自动显示颜色
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }

    // 启动子进程
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let killer = child.clone_killer();

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
    // 使用 event_id（如果提供）或 pty_id 作为事件名
    let event_name = event_id.unwrap_or_else(|| pty_id.clone());
    let event_name_clone = event_name.clone();

    // 创建 PTY 实例
    let instance = Arc::new(Mutex::new(PtyInstance {
        pair,
        writer,
        killer,
    }));

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
                    println!("[PTY {}] EOF", event_name_clone);
                    break;
                }
                Ok(n) => {
                    // Send raw bytes instead of lossy UTF-8 string
                    // xterm.js handles encoding internally
                    let data: Vec<u8> = buf[..n].to_vec();
                    let _ = app_handle.emit(&format!("pty-data:{}", event_name_clone), data);
                }
                Err(e) => {
                    eprintln!("[PTY {}] Read error: {}", event_name_clone, e);
                    break;
                }
            }
        }

        // 清理实例
        let state = app_handle.state::<PtyState>();
        if let Ok(mut instances) = state.instances.lock() {
            instances.remove(&pty_id_for_cleanup);
        }

        // 等待子进程退出并发出退出事件
        let exit_payload = match child.wait() {
            Ok(status) => PtyExitPayload {
                code: Some(status.exit_code()),
            },
            Err(_) => PtyExitPayload {
                code: None,
            },
        };
        let _ = app_handle.emit(&format!("pty-exit:{}", event_name_clone), exit_payload);
    });

    println!("[PTY] Spawned: {} (event_name: {})", pty_id, event_name);
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

    if let Some(instance) = instances.remove(&pty_id) {
        if let Ok(mut instance) = instance.lock() {
            let _ = instance.killer.kill();
        }
        println!("[PTY] Killed: {}", pty_id);
        return Ok(());
    }
    Err(format!("PTY not found: {}", pty_id))
}
