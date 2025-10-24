# 完全解耦的插件架构设计 v2

## 核心问题

当前设计的问题：
1. ❌ Rust AI 代码仍在 `src-tauri/src/ai/`，没有真正解耦
2. ❌ 前端需要手动 `import` 插件，不是自动加载
3. ❌ 插件的前后端代码分离在不同位置，不够独立

## 正确的架构

### 目录结构

```
mark2-tauri/
├── src/                          # 主应用前端
│   ├── core/
│   │   ├── PluginManager.js      # 插件管理器（带自动扫描）
│   │   └── EventBus.js
│   └── main.js                   # 不再手动 import 插件
│
├── src-tauri/                    # 主应用后端
│   ├── src/
│   │   ├── main.rs               # 不再有 AI 相关代码
│   │   └── plugin_loader.rs     # 插件加载器
│   └── Cargo.toml
│
└── plugins/                      # 插件目录（完全独立）
    ├── ai-assistant/             # AI 插件
    │   ├── manifest.json         # 插件元信息
    │   ├── frontend/             # 前端代码
    │   │   ├── index.js          # 前端入口
    │   │   ├── AiSidebar.js
    │   │   ├── aiService.js
    │   │   └── ...
    │   └── backend/              # 后端代码（Rust）
    │       ├── Cargo.toml        # 独立的 Rust 包
    │       ├── mod.rs
    │       ├── config.rs
    │       └── ...
    │
    └── markdown-tools/           # 其他插件...
        ├── manifest.json
        └── frontend/
            └── index.js
```

---

## 插件配置文件

### manifest.json

```json
{
  "id": "ai-assistant",
  "name": "AI 写作助手",
  "version": "1.0.0",
  "description": "基于 LLM 的智能写作助手",
  "author": "Mark2 Team",

  "frontend": {
    "entry": "./frontend/index.js",
    "enabled": true
  },

  "backend": {
    "path": "./backend",
    "enabled": true,
    "commands": [
      "ai_execute",
      "ai_execute_stream",
      "get_ai_config",
      "save_ai_config"
    ]
  },

  "permissions": [
    "fs:read",
    "fs:write",
    "network:request"
  ],

  "dependencies": {
    "frontend": [],
    "backend": []
  }
}
```

---

## 自动加载机制

### 前端插件管理器

```javascript
// src/core/PluginManager.js
export class PluginManager {
    /**
     * 自动扫描并加载所有插件
     */
    async scanAndLoadPlugins() {
        // 1. 通过 Tauri 命令获取插件列表
        const pluginManifests = await invoke('list_plugins');

        // 2. 依次加载每个插件
        for (const manifest of pluginManifests) {
            if (!manifest.frontend?.enabled) continue;

            try {
                // 3. 动态 import 插件前端代码
                const pluginModule = await import(
                    `../../plugins/${manifest.id}/frontend/index.js`
                );

                // 4. 自动注册和激活
                await this.register(manifest.id, pluginModule);
                await this.activate(manifest.id);
            } catch (error) {
                console.error(`加载插件 ${manifest.id} 失败:`, error);
            }
        }
    }
}
```

### Rust 插件加载器

```rust
// src-tauri/src/plugin_loader.rs
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub frontend: Option<FrontendConfig>,
    pub backend: Option<BackendConfig>,
}

#[derive(Serialize, Deserialize)]
pub struct FrontendConfig {
    pub entry: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize)]
pub struct BackendConfig {
    pub path: String,
    pub enabled: bool,
    pub commands: Vec<String>,
}

/// 扫描 plugins 目录，读取所有 manifest.json
pub fn scan_plugins() -> Result<Vec<PluginManifest>, String> {
    let plugins_dir = PathBuf::from("plugins");
    let mut manifests = Vec::new();

    if !plugins_dir.exists() {
        return Ok(manifests);
    }

    for entry in fs::read_dir(&plugins_dir)
        .map_err(|e| e.to_string())?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let manifest_path = entry.path().join("manifest.json");

        if manifest_path.exists() {
            let content = fs::read_to_string(&manifest_path)
                .map_err(|e| e.to_string())?;
            let manifest: PluginManifest = serde_json::from_str(&content)
                .map_err(|e| e.to_string())?;
            manifests.push(manifest);
        }
    }

    Ok(manifests)
}

#[tauri::command]
pub fn list_plugins() -> Result<Vec<PluginManifest>, String> {
    scan_plugins()
}
```

---

## 主应用改造

### main.js（零手动导入）

```javascript
// ❌ 删除手动导入
// import * as aiPlugin from './plugins/ai-assistant/index.js';

async function initializeApplication() {
    await ensureCoreModules();

    // 创建插件管理器
    pluginManager = new PluginManager({
        eventBus,
        appContext: {
            getActiveViewMode: () => activeViewMode,
            getEditorContext: requestActiveEditorContext,
        },
    });

    // ✅ 自动扫描并加载所有插件
    await pluginManager.scanAndLoadPlugins();

    // 其余初始化代码...
}
```

### main.rs（动态注册插件命令）

```rust
use tauri::Builder;

fn main() {
    // 1. 扫描插件
    let plugins = plugin_loader::scan_plugins().unwrap_or_default();

    // 2. 动态构建应用
    let mut app = Builder::default();

    // 3. 为每个插件注册命令
    for plugin in plugins {
        if let Some(backend) = plugin.backend {
            if backend.enabled {
                // 动态加载插件的后端模块
                app = register_plugin_commands(app, &plugin);
            }
        }
    }

    // 4. 启动应用
    app.run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 插件开发示例

### 创建新插件

```bash
# 1. 创建插件目录
mkdir -p plugins/my-plugin/frontend
mkdir -p plugins/my-plugin/backend/src

# 2. 创建 manifest.json
cat > plugins/my-plugin/manifest.json << 'EOF'
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "frontend": {
    "entry": "./frontend/index.js",
    "enabled": true
  }
}
EOF

# 3. 创建前端入口
cat > plugins/my-plugin/frontend/index.js << 'EOF'
export async function activate(context) {
    console.log('我的插件已激活');

    return {
        doSomething() {
            console.log('执行操作');
        }
    };
}
EOF
```

**无需修改主应用代码！** 插件会自动被发现和加载。

---

## 禁用插件

### 方式 1：修改 manifest.json

```json
{
  "id": "ai-assistant",
  "frontend": {
    "enabled": false  // 禁用前端
  },
  "backend": {
    "enabled": false  // 禁用后端
  }
}
```

### 方式 2：删除插件目录

```bash
rm -rf plugins/ai-assistant
```

### 方式 3：用户配置（未来）

```javascript
// 在设置中禁用
await pluginManager.setPluginEnabled('ai-assistant', false);
```

---

## 优势对比

| 特性 | v1 设计 | v2 设计 |
|-----|---------|---------|
| 前端导入 | 手动 import | 自动扫描 |
| 后端代码位置 | src-tauri/src/ai/ | plugins/ai-assistant/backend/ |
| 插件独立性 | 部分独立 | 完全独立 |
| 新增插件 | 需修改 main.js | 零修改 |
| 禁用插件 | 注释代码 | 修改配置或删除目录 |
| 插件分发 | 困难 | 简单（复制目录） |

---

## 迁移步骤

### 1. 移动 Rust AI 代码

```bash
# 创建插件后端目录
mkdir -p plugins/ai-assistant/backend/src

# 移动 AI 模块代码
mv src-tauri/src/ai/* plugins/ai-assistant/backend/src/

# 创建独立的 Cargo.toml
cat > plugins/ai-assistant/backend/Cargo.toml << 'EOF'
[package]
name = "ai-assistant-backend"
version = "1.0.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.11", features = ["json", "stream"] }
EOF
```

### 2. 移动前端代码

```bash
# 移动现有前端代码到插件目录
mkdir -p plugins/ai-assistant/frontend
mv src/components/AiSidebar.js plugins/ai-assistant/frontend/
mv src/components/AiConfigManager.js plugins/ai-assistant/frontend/
mv src/modules/aiService.js plugins/ai-assistant/frontend/
mv src/modules/aiSession.js plugins/ai-assistant/frontend/
mv src/modules/aiAdapters plugins/ai-assistant/frontend/
```

### 3. 创建 manifest.json

```bash
cat > plugins/ai-assistant/manifest.json << 'EOF'
{
  "id": "ai-assistant",
  "name": "AI 写作助手",
  "version": "1.0.0",
  "frontend": {
    "entry": "./frontend/index.js",
    "enabled": true
  },
  "backend": {
    "path": "./backend",
    "enabled": true
  }
}
EOF
```

### 4. 更新 main.js

```javascript
// 删除手动导入
- import * as aiPlugin from './plugins/ai-assistant/index.js';
- await pluginManager.register('ai-assistant', aiPlugin);

// 改为自动加载
+ await pluginManager.scanAndLoadPlugins();
```

---

## 动态 Import 路径处理

由于 Vite 的限制，动态 import 需要一些技巧：

```javascript
// src/core/PluginManager.js
async scanAndLoadPlugins() {
    const manifests = await invoke('list_plugins');

    for (const manifest of manifests) {
        if (!manifest.frontend?.enabled) continue;

        try {
            // 使用 Vite 的 glob import
            const modules = import.meta.glob('../../plugins/*/frontend/index.js');
            const modulePath = `../../plugins/${manifest.id}/frontend/index.js`;

            if (modules[modulePath]) {
                const pluginModule = await modules[modulePath]();
                await this.register(manifest.id, pluginModule);
                await this.activate(manifest.id);
            }
        } catch (error) {
            console.error(`加载插件 ${manifest.id} 失败:`, error);
        }
    }
}
```

---

## 总结

这个 v2 设计实现了：

✅ **完全解耦** - 插件前后端代码都在独立目录
✅ **零手动导入** - 自动扫描和加载
✅ **独立分发** - 复制插件目录即可安装
✅ **简单禁用** - 修改配置或删除目录

这才是真正的插件系统！
