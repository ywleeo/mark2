# 插件架构最终实现（2025-10-25）

## 架构概述

Mark2 采用了**纯前端插件架构**，所有插件逻辑都在前端实现，通过 **AppBridge** 调用主应用提供的公共能力。

### 核心设计原则

1. ✅ **插件完全自包含**：所有插件代码在 `plugins/插件ID/` 目录下
2. ✅ **热插拔**：通过 manifest.json 配置，无需在 main.js 中硬编码
3. ✅ **能力抽象**：插件通过 AppBridge 调用 App 能力，不直接访问内部实现
4. ✅ **自动发现**：PluginManager 扫描 plugins 目录，自动加载启用的插件
5. ✅ **菜单配置化**：插件菜单项和快捷键在 manifest.json 中定义

---

## 目录结构

```
mark2-tauri/
├── src/                              # 主应用前端
│   ├── core/
│   │   ├── AppBridge.js              # App 公共能力接口 ⭐
│   │   ├── AppBridge.README.md      # AppBridge API 文档
│   │   ├── PluginManager.js          # 插件管理器（自动扫描加载）
│   │   └── EventBus.js               # 全局事件总线
│   ├── utils/
│   │   └── PointerHelper.js          # 公共工具（插件可引用）
│   └── main.js                       # 主应用入口
│
├── src-tauri/                        # 主应用 Rust 后端
│   ├── src/
│   │   ├── main.rs                   # 无插件硬编码，动态菜单生成
│   │   └── plugin_loader.rs          # 扫描插件 manifest.json
│   └── Cargo.toml                    # 无插件依赖
│
└── plugins/                          # 插件目录（完全独立）⭐
    └── ai-assistant/                 # AI 写作助手插件
        ├── manifest.json             # 插件配置（含菜单定义）
        ├── README.md                 # 插件文档
        └── frontend/                 # 纯前端实现
            ├── index.js              # 插件入口（activate/deactivate）
            ├── AiSidebar.js          # UI 组件
            ├── AiConfigManager.js    # 配置对话框
            └── aiService.js          # AI 服务（直接调用 OpenAI API）
```

---

## 核心组件

### 1. AppBridge - App 公共能力接口

**文件**：`src/core/AppBridge.js`

为插件提供统一的 API，实现插件与主应用的解耦。

**提供的能力**：

#### UI 能力
- `showNotification({ message, type, duration })` - 显示通知
- `showConfirm({ title, message })` - 显示确认对话框

#### 编辑器能力
- `getEditorContext({ includeSelection, includeFullDocument })` - 获取编辑器上下文
- `getDocumentContent()` - 获取完整文档
- `getSelectedText()` - 获取选中文本
- `insertText(text, { position })` - 插入文本
- `replaceSelection(text)` - 替换选中文本

#### 存储能力
- `getConfig(key, defaultValue)` - 获取配置
- `setConfig(key, value)` - 保存配置
- `removeConfig(key)` - 删除配置

#### 事件系统
- `on(event, handler)` - 订阅事件
- `off(event, handler)` - 取消订阅
- `emit(event, data)` - 发送事件
- `once(event, handler)` - 订阅一次性事件

#### 其他能力
- `getActiveViewMode()` - 获取当前视图模式
- `getAppVersion()` - 获取 App 版本

**详细文档**：[src/core/AppBridge.README.md](src/core/AppBridge.README.md)

---

### 2. PluginManager - 插件管理器

**文件**：`src/core/PluginManager.js`

负责插件的自动扫描、加载、激活、卸载。

**工作流程**：

```javascript
// 1. 扫描插件
const manifests = await invoke('list_plugins');

// 2. 使用 Vite glob import 预加载
const modules = import.meta.glob('/plugins/*/frontend/index.js');

// 3. 依次加载并激活
for (const manifest of manifests) {
  if (manifest.frontend?.enabled) {
    const module = await modules[`/plugins/${manifest.id}/frontend/index.js`]();
    await pluginManager.register(manifest.id, module);
    await pluginManager.activate(manifest.id);
  }
}
```

**插件上下文**：

```javascript
{
  pluginId: 'ai-assistant',

  // 事件系统（自动管理订阅/清理）
  eventBus: { on, once, emit, emitAsync },

  // App 能力接口 ⭐
  app: AppBridge,

  // 获取其他插件 API
  getPluginApi: (id) => api,

  // 注册清理函数
  onCleanup: (fn) => void,
}
```

---

### 3. Plugin Loader (Rust)

**文件**：`src-tauri/src/plugin_loader.rs`

扫描 `plugins/` 目录，读取 `manifest.json`，返回插件列表。

**Manifest 结构**：

```rust
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub frontend: Option<FrontendConfig>,
    pub backend: Option<BackendConfig>,
    pub permissions: Vec<String>,
    pub menu: Option<MenuConfig>,  // ⭐ 菜单配置
}

pub struct MenuConfig {
    pub toggle: Option<MenuItemConfig>,
    pub settings: Option<MenuItemConfig>,
}

pub struct MenuItemConfig {
    pub label: Option<String>,
    pub accelerator: Option<String>,  // 快捷键
}
```

---

### 4. 动态菜单生成 (Rust)

**文件**：`src-tauri/src/main.rs`

根据插件 manifest.json 自动生成菜单项，**无硬编码**。

```rust
// 加载插件配置
let plugins = plugin_loader::scan_plugins().unwrap_or_default();

// 动态创建插件菜单
let mut plugins_menu_builder = SubmenuBuilder::new(app, "Plugins");

for plugin in &plugins {
    let mut submenu_builder = SubmenuBuilder::new(app, &plugin.name);

    // 从 manifest 读取菜单配置
    if let Some(menu_config) = &plugin.menu {
        if let Some(toggle_config) = &menu_config.toggle {
            let toggle_item = MenuItemBuilder::with_id(
                format!("plugin-{}-toggle", plugin.id),
                toggle_config.label.as_deref().unwrap_or("Toggle"),
            )
            .accelerator(toggle_config.accelerator.as_deref().unwrap_or(""))
            .build(app)?;

            submenu_builder = submenu_builder.item(&toggle_item);
        }
        // settings 菜单项同理...
    }

    plugins_menu_builder = plugins_menu_builder.item(&submenu_builder.build()?);
}
```

**菜单事件处理**（模式匹配，无硬编码）：

```rust
app.on_menu_event(|app, event| {
    let event_id = event.id().as_ref();

    // 所有 plugin- 开头的事件，转发到前端
    if event_id.starts_with("plugin-") {
        let menu_event_name = format!("menu-{}", event_id);
        let _ = app.emit(&menu_event_name, ());
    }
});
```

---

## 插件开发指南

### 插件目录结构

```
plugins/my-plugin/
├── manifest.json              # 必需：插件配置
├── README.md                  # 推荐：插件文档
└── frontend/
    ├── index.js               # 必需：插件入口
    ├── MyComponent.js         # 可选：UI 组件
    └── myService.js           # 可选：业务逻辑
```

### manifest.json 示例

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "作者",

  "frontend": {
    "entry": "./frontend/index.js",
    "enabled": true
  },

  "menu": {
    "toggle": {
      "label": "Toggle 我的插件",
      "accelerator": "CmdOrCtrl+Shift+M"
    },
    "settings": {
      "label": "我的插件 Settings...",
      "accelerator": "CmdOrCtrl+,"
    }
  },

  "permissions": [
    "network:request"
  ]
}
```

### 插件入口 index.js

```javascript
export const metadata = {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
};

/**
 * 插件激活
 * @param {Object} context - 插件上下文
 * @param {AppBridge} context.app - App 能力接口
 * @param {Object} context.eventBus - 事件总线
 */
export async function activate(context) {
  const { app, eventBus } = context;

  // 订阅菜单事件
  eventBus.on('menu-plugin-my-plugin-toggle', async () => {
    // 处理 toggle 逻辑
    const content = await app.getEditorContext();
    console.log('当前内容:', content);
  });

  eventBus.on('menu-plugin-my-plugin-settings', () => {
    // 打开设置对话框
  });

  // 注册清理函数
  context.onCleanup(() => {
    console.log('插件清理');
  });

  // 返回插件 API（供其他插件调用）
  return {
    doSomething() {
      console.log('插件方法');
    }
  };
}

/**
 * 插件停用
 */
export async function deactivate() {
  console.log('插件已停用');
}
```

### 调用 AppBridge API

```javascript
export async function activate(context) {
  const { app } = context;

  // 获取编辑器内容
  const content = await app.getEditorContext({
    includeSelection: true,
    includeFullDocument: false
  });

  // 插入文本
  await app.insertText('新内容', { position: 'cursor' });

  // 显示通知
  app.showNotification({
    message: '操作完成',
    type: 'success',
    duration: 3000
  });

  // 保存配置
  app.setConfig('my-plugin:setting', { value: 123 });

  // 读取配置
  const config = app.getConfig('my-plugin:setting', { value: 0 });

  // 订阅事件
  app.on('file:opened', (data) => {
    console.log('文件已打开:', data);
  });
}
```

---

## AI 插件实现示例

### 文件结构

```
plugins/ai-assistant/
├── manifest.json              # 配置文件（含菜单定义）
├── README.md                  # 插件文档
└── frontend/
    ├── index.js               # 插件入口
    ├── AiSidebar.js           # 侧边栏 UI
    ├── AiConfigManager.js     # 配置对话框
    └── aiService.js           # AI 服务（调用 OpenAI API）
```

### aiService.js - 纯前端实现

```javascript
class AiService {
  async runTask(request) {
    // 直接调用 OpenAI API（无需 Rust 后端）
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: true,
      }),
    });

    // 处理流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      // 解析 SSE 格式...
    }
  }
}
```

### index.js - 插件入口

```javascript
import { AiSidebar } from './AiSidebar.js';
import { AiConfigManager } from './AiConfigManager.js';
import { aiService } from './aiService.js';

export async function activate(context) {
  const { app, eventBus } = context;

  let aiSidebar = null;
  let aiConfigManager = null;

  // Toggle 菜单事件
  eventBus.on('menu-plugin-ai-assistant-toggle', () => {
    if (!aiSidebar) {
      const container = document.getElementById('aiSidebar');
      aiSidebar = new AiSidebar(container, async (options) => {
        // 通过 AppBridge 获取编辑器上下文
        return await app.getEditorContext(options);
      });
    }
    aiSidebar.toggle();
  });

  // Settings 菜单事件
  eventBus.on('menu-plugin-ai-assistant-settings', () => {
    if (!aiConfigManager) {
      aiConfigManager = new AiConfigManager({
        onSubmit: (config) => {
          aiService.saveConfig(config);
        }
      });
    }
    aiConfigManager.open(aiService.getConfig());
  });

  return {
    showSidebar: () => aiSidebar?.show(),
    getService: () => aiService,
  };
}
```

---

## 关键改进点

### 1. ❌ 之前的问题

```javascript
// src/main.js - 硬编码导入插件
import { activate as activateAi } from '../plugins/ai-assistant/frontend/index.js';
activateAi(context);
```

```rust
// src-tauri/src/main.rs - 硬编码菜单
.accelerator(if plugin_id == "ai-assistant" { "CmdOrCtrl+Shift+A" } else { "" })
```

### 2. ✅ 现在的实现

```javascript
// src/main.js - 自动加载
pluginManager = new PluginManager({ eventBus, appContext });
await pluginManager.scanAndLoadPlugins();
```

```rust
// src-tauri/src/main.rs - 从 manifest 读取配置
let accelerator = toggle_config.accelerator.as_deref().unwrap_or("");
```

---

## 扩展 AppBridge

当需要为插件提供新能力时：

### 1. 在 AppBridge.js 中添加方法

```javascript
// src/core/AppBridge.js
export class AppBridge {
  async getFileList() {
    if (typeof this.appContext.getFileList === 'function') {
      return await this.appContext.getFileList();
    }
    return [];
  }
}
```

### 2. 在 main.js 中提供实现

```javascript
// src/main.js
pluginManager = new PluginManager({
  eventBus,
  appContext: {
    getActiveViewMode: () => activeViewMode,
    getEditorContext: requestActiveEditorContext,
    getFileList: async () => {
      // 实现文件列表获取逻辑
      return fileManager.getFiles();
    }
  }
});
```

### 3. 更新文档

在 `src/core/AppBridge.README.md` 中添加新 API 的说明。

---

## 架构优势

1. ✅ **真正的热插拔**：删除插件目录即可禁用，无需修改代码
2. ✅ **插件独立性**：所有插件代码在 `plugins/` 目录，易于分发
3. ✅ **配置驱动**：菜单、快捷键在 manifest.json 中定义
4. ✅ **能力抽象**：插件通过 AppBridge 调用，不耦合内部实现
5. ✅ **易于扩展**：新增 App 能力只需在 AppBridge 中添加方法
6. ✅ **纯前端架构**：无需 Rust 后端，开发更简单

---

## 文档索引

- [AppBridge API 文档](src/core/AppBridge.README.md) - App 公共能力接口
- [AI 插件文档](plugins/ai-assistant/README.md) - AI 插件使用说明
- [PluginManager 源码](src/core/PluginManager.js) - 插件管理器实现
- [Plugin Loader 源码](src-tauri/src/plugin_loader.rs) - Rust 插件扫描

---

## 下一步计划

可能的改进方向：

1. **插件依赖管理**：支持插件间依赖声明
2. **插件权限系统**：细粒度控制插件可访问的 API
3. **插件市场**：在线安装/更新插件
4. **插件沙箱**：iframe 或 worker 隔离插件运行环境
5. **插件调试工具**：DevTools 扩展，查看插件状态
6. **插件热重载**：开发时无需重启应用即可更新插件

---

**更新日期**：2025-10-25
**架构版本**：v3.0 (纯前端插件 + AppBridge)
