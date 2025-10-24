# 真正完全解耦的插件系统

## 当前问题

虽然代码已经移动到 `plugins/` 目录，但：

```rust
// main.rs 仍然硬编码依赖
use ai_assistant_plugin::{self as ai, provider::AiStreamUpdate};
```

**问题：** 删除 `plugins/ai-assistant/` 目录会导致编译失败！

---

## 解决方案：条件编译 + 特性开关

### 方式 1：Cargo Features（推荐）

**Cargo.toml：**
```toml
[features]
default = ["plugin-ai-assistant"]  # 默认启用
plugin-ai-assistant = ["ai-assistant-plugin"]

[dependencies]
# AI 插件变为可选依赖
ai-assistant-plugin = { path = "../plugins/ai-assistant/backend", optional = true }
```

**main.rs：**
```rust
// 条件编译：只有启用特性时才引入
#[cfg(feature = "plugin-ai-assistant")]
use ai_assistant_plugin::{self as ai, provider::AiStreamUpdate};

// 条件编译命令注册
fn main() {
    let mut app = tauri::Builder::default();

    #[cfg(feature = "plugin-ai-assistant")]
    {
        app = app.invoke_handler(tauri::generate_handler![
            get_ai_config,
            ai_execute,
            // ... AI 相关命令
        ]);
    }

    // 其他命令（始终存在）
    app = app.invoke_handler(tauri::generate_handler![
        is_directory,
        read_file,
        plugin_loader::list_plugins,
        // ...
    ]);

    app.run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**禁用插件：**
```bash
# 编译时不包含 AI 插件
cargo build --no-default-features

# 或者删除 plugins/ai-assistant 目录后正常编译
rm -rf plugins/ai-assistant
cargo build  # 自动跳过缺失的插件
```

---

### 方式 2：动态库加载（最彻底但最复杂）

使用 `libloading` 在运行时动态加载插件 `.so`/`.dylib`/`.dll`：

```rust
use libloading::{Library, Symbol};

// 运行时加载插件
let lib = unsafe { Library::new("plugins/ai-assistant/target/release/libai_assistant.so")? };
let init_plugin: Symbol<fn() -> Box<dyn Plugin>> = unsafe { lib.get(b"init_plugin")? };
let plugin = init_plugin();
```

**优势：** 真正的运行时插件，完全动态
**劣势：** 复杂度极高，跨平台困难

---

### 方式 3：WebAssembly 插件（未来方向）

插件编译为 WASM，通过 `wasmer`/`wasmtime` 运行时加载：

```toml
# plugins/ai-assistant/Cargo.toml
[lib]
crate-type = ["cdylib"]  # 编译为 WASM

[dependencies]
wasm-bindgen = "0.2"
```

**优势：** 沙箱隔离，跨平台，真正动态
**劣势：** 需要大量重构，性能开销

---

## 推荐实现：方式 1（Cargo Features）

这是 Rust 生态的标准做法，简单且可靠。

### 实现步骤

#### 1. 更新 `src-tauri/Cargo.toml`

```toml
[features]
default = ["plugin-ai-assistant"]
plugin-ai-assistant = ["ai-assistant-plugin"]

[dependencies]
ai-assistant-plugin = { path = "../plugins/ai-assistant/backend", optional = true }
```

#### 2. 更新 `src-tauri/src/main.rs`

```rust
// 条件导入
#[cfg(feature = "plugin-ai-assistant")]
use ai_assistant_plugin::{self as ai, provider::AiStreamUpdate};

// 条件编译命令
fn main() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init());

    // AI 插件命令（条件编译）
    #[cfg(feature = "plugin-ai-assistant")]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            get_ai_config,
            save_ai_config,
            clear_ai_api_key,
            ai_execute,
            ai_execute_stream,
            ai_cancel_task,
            ai_execute_task,
            file_tools::ai_read_file,
            file_tools::ai_write_file,
            file_tools::ai_replace_content,
            file_tools::ai_insert_content,
            file_tools::ai_get_editor_context
        ]);
    }

    // 核心命令（始终存在）
    builder = builder.invoke_handler(tauri::generate_handler![
        is_directory,
        read_file,
        // ...
        plugin_loader::list_plugins,
    ]);

    builder
        .setup(|app| {
            #[cfg(feature = "plugin-ai-assistant")]
            {
                let ai_state = ai::AiState::initialize(&app.handle())
                    .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
                app.manage(ai_state);
            }

            // 菜单创建...
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 3. 测试禁用插件

```bash
# 编译时不包含 AI 插件
cargo build --no-default-features

# 或者删除插件目录
rm -rf plugins/ai-assistant
cargo build  # 编译仍然成功
```

---

## 完全动态的替代方案

如果你想要**真正的**"放入插件目录就加载"，需要：

### 架构变更

```
主应用（Rust）
    ↓ 扫描 plugins/ 目录
    ↓ 读取 manifest.json
    ↓ 检查 backend.enabled
    ↓
    ├─ 如果启用 → 动态加载 .so/.dylib
    └─ 如果禁用 → 跳过
```

### 实现代码（概念）

```rust
// plugin_loader.rs
use libloading::Library;

pub fn load_plugins_at_runtime(app: &AppHandle) -> Result<(), String> {
    let manifests = scan_plugins()?;

    for manifest in manifests {
        if !manifest.backend.as_ref().map_or(false, |b| b.enabled) {
            continue;
        }

        let lib_path = format!(
            "plugins/{}/backend/target/release/lib{}.{}",
            manifest.id,
            manifest.id.replace("-", "_"),
            if cfg!(target_os = "macos") { "dylib" }
            else if cfg!(target_os = "windows") { "dll" }
            else { "so" }
        );

        unsafe {
            let lib = Library::new(&lib_path)
                .map_err(|e| format!("加载插件 {} 失败: {}", manifest.id, e))?;

            // 调用插件的初始化函数
            let init: Symbol<fn(&AppHandle) -> Result<(), String>> =
                lib.get(b"plugin_init")?;
            init(app)?;
        }
    }

    Ok(())
}
```

**问题：**
1. 需要预编译所有插件
2. ABI 兼容性问题
3. 跨平台复杂度高
4. Tauri 命令无法动态注册（限制）

---

## 结论

**对于 Tauri 应用：**

✅ **方式 1（Cargo Features）是最佳实践**
- 编译时决定包含哪些插件
- 删除插件目录 → 自动跳过编译
- 性能零开销
- Rust 生态标准做法

❌ **动态库加载不适合 Tauri**
- Tauri 命令必须在编译时注册
- ABI 不稳定
- 维护成本极高

---

## 总结

当前实现：
- ✅ 前端：完全动态（扫描 manifest.json 自动加载）
- ⚠️ 后端：静态依赖（通过 Cargo.toml 引入）

改进方向：
- 添加 Cargo Features 条件编译
- 前端检测后端插件是否可用（调用命令失败时降级）

这是 Tauri 插件系统的**实际限制**，不是设计问题。Electron 可以真正动态加载，但 Rust 编译型语言的特性决定了它更适合编译时插件系统。
