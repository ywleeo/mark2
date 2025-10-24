# 完全解耦的插件系统 - 最终方案

## ✅ 已完成

### 1. 核心架构

**插件目录结构（真正独立）：**
```
mark2-tauri/
├── plugins/                      # 插件完全独立目录
│   └── ai-assistant/
│       ├── manifest.json         # 插件配置（自动扫描）
│       └── frontend/
│           └── index.js          # 前端入口
│
├── src/                          # 主应用前端
│   ├── core/
│   │   ├── EventBus.js
│   │   └── PluginManager.js      # 支持自动扫描
│   └── main.js                   # 零手动导入
│
└── src-tauri/                    # 主应用后端
    └── src/
        ├── main.rs               # 注册 list_plugins 命令
        ├── plugin_loader.rs      # 新增：插件扫描器
        └── ai/                   # AI 后端代码（暂未移动）
```

### 2. 自动加载机制

**前端（main.js）：**
```javascript
// ❌ 不再手动导入
// import * as aiPlugin from './plugins/ai-assistant/index.js';
// await pluginManager.register('ai-assistant', aiPlugin);

// ✅ 自动扫描和加载
await pluginManager.scanAndLoadPlugins();
```

**后端（plugin_loader.rs）：**
```rust
/// 扫描 plugins/ 目录，读取所有 manifest.json
pub fn scan_plugins() -> Result<Vec<PluginManifest>, String>

/// Tauri 命令：前端调用获取插件列表
#[tauri::command]
pub fn list_plugins() -> Result<Vec<PluginManifest>, String>
```

### 3. 插件配置（manifest.json）

```json
{
  "id": "ai-assistant",
  "name": "AI 写作助手",
  "version": "1.0.0",
  "description": "基于 LLM 的智能写作助手",

  "frontend": {
    "entry": "./frontend/index.js",
    "enabled": true
  },

  "backend": {
    "enabled": true,
    "commands": ["ai_execute", "ai_execute_stream", ...]
  },

  "permissions": ["fs:read", "fs:write", "network:request"]
}
```

---

## 🎯 核心优势

| 特性 | v1（手动导入） | v2（自动扫描） |
|-----|---------------|---------------|
| 前端导入 | `import * as aiPlugin from '...'` | 自动扫描 |
| 注册方式 | `pluginManager.register('ai-assistant', aiPlugin)` | `pluginManager.scanAndLoadPlugins()` |
| 新增插件 | 需修改 main.js | 零修改（只需添加插件目录） |
| 禁用插件 | 注释导入代码 | 修改 `manifest.json` 中 `enabled: false` |
| 插件分发 | 困难 | 简单（复制插件目录） |
| 代码位置 | AI 代码在 `src-tauri/src/ai/` | ✅ 应移至 `plugins/ai-assistant/backend/` |

---

## 📦 已实现的文件

### 新增文件

1. **plugins/ai-assistant/manifest.json** - 插件配置
2. **plugins/ai-assistant/frontend/index.js** - 前端入口（从 `src/plugins/` 移动）
3. **src-tauri/src/plugin_loader.rs** - Rust 插件扫描器
4. **PLUGIN_ARCHITECTURE_V2.md** - 完整架构文档
5. **PLUGIN_SYSTEM_FINAL.md** - 本文档

### 修改文件

1. **src/core/PluginManager.js** - 新增 `scanAndLoadPlugins()` 方法
2. **src/main.js** - 删除手动导入，改为自动加载
3. **src-tauri/src/main.rs** - 新增 `mod plugin_loader`，注册 `list_plugins` 命令

---

## 🚀 使用方式

### 创建新插件

```bash
# 1. 创建插件目录
mkdir -p plugins/my-plugin/frontend

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

# 4. 重启应用 - 插件自动加载！
npm run tauri:dev
```

### 禁用插件

**方式 1：修改 manifest.json**
```json
{
  "frontend": {
    "enabled": false  // 禁用
  }
}
```

**方式 2：删除插件目录**
```bash
rm -rf plugins/my-plugin
```

---

## 📝 未完成的工作（可选）

### 1. 移动 Rust AI 代码到插件目录

**当前状态：**
- AI 后端代码仍在 `src-tauri/src/ai/`
- 应该移动到 `plugins/ai-assistant/backend/`

**移动步骤：**
```bash
# 1. 创建插件后端目录
mkdir -p plugins/ai-assistant/backend/src

# 2. 移动 AI 模块代码
mv src-tauri/src/ai/* plugins/ai-assistant/backend/src/

# 3. 创建独立的 Cargo.toml
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
# ... 其他依赖
EOF

# 4. 更新 main.rs 动态加载插件后端
# （需要实现动态插件后端加载机制）
```

**注意：** 这需要实现 Rust 插件的动态加载机制，比较复杂。当前方案是：
- 前端完全解耦（✅ 已完成）
- 后端代码位置解耦（⚠️ 待完成，可选）

### 2. 动态菜单注册

**当前状态：**
- AI 菜单项硬编码在 main.rs 中

**理想状态：**
- 插件可以通过 manifest.json 声明菜单项
- 主应用动态构建菜单

**示例 manifest.json：**
```json
{
  "menus": [
    {
      "parent": "Mark2 > Plugins",
      "items": [
        {
          "id": "toggle-ai-sidebar",
          "label": "AI 写作助手",
          "accelerator": "CmdOrCtrl+Shift+A"
        }
      ]
    }
  ]
}
```

---

## 🧪 测试

### 启动应用

```bash
npm run tauri:dev
```

### 预期日志

```
[PluginLoader] 发现插件: AI 写作助手 (ai-assistant)
[PluginLoader] 总共发现 1 个插件
[PluginManager] 发现 1 个插件
[PluginManager] 加载插件: ai-assistant (/plugins/ai-assistant/frontend/index.js)
[PluginManager] 已注册插件: ai-assistant
[AI Plugin] 正在激活...
[AI Plugin] 激活完成
[PluginManager] 已激活插件: ai-assistant
```

### 测试清单

- [ ] 应用正常启动
- [ ] 控制台显示插件扫描日志
- [ ] AI 侧边栏可以打开/关闭
- [ ] AI 对话功能正常
- [ ] 禁用插件后功能消失
- [ ] 创建新插件能自动加载

---

## 📚 相关文档

- [插件系统使用指南](src/core/README.md)
- [插件架构 v2](PLUGIN_ARCHITECTURE_V2.md)
- [迁移指南 v1](PLUGIN_MIGRATION.md)

---

## 🎉 总结

### 已实现

✅ **前端完全解耦** - 插件目录独立，自动扫描加载
✅ **零手动导入** - main.js 不再需要 import 插件
✅ **配置化管理** - manifest.json 控制插件启用/禁用
✅ **Rust 扫描器** - 后端支持插件列表查询

### 架构优势

1. **新增插件** - 复制目录即可，零代码修改
2. **禁用插件** - 修改配置或删除目录
3. **分发简单** - 复制 `plugins/插件名/` 目录
4. **扩展性强** - 支持无限数量插件

### 下一步（可选）

1. 移动 Rust AI 代码到插件目录
2. 实现动态菜单注册
3. 插件权限管理
4. 插件市场

---

**这才是真正完全解耦的插件系统！** 🚀
