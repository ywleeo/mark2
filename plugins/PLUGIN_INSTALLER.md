# 插件安装系统设计方案

## 支持的插件格式

### 1. 开发格式（文件夹）
```
plugins/
├── my-plugin/
│   ├── index.js
│   ├── config.json
│   ├── styles.css
│   └── assets/
```

### 2. 分发格式（.mpk 包）
```
my-plugin.mpk  (实际上是zip文件)
├── index.js
├── config.json  
├── styles.css
└── assets/
```

### 3. 单文件格式（.js）
```javascript
// plugin-header.js
/**
 * @plugin-name: Simple Highlighter  
 * @plugin-version: 1.0.0
 * @plugin-description: Simple text highlighter
 */

class SimpleHighlighterPlugin extends BasePlugin {
    // 插件实现...
}

module.exports = SimpleHighlighterPlugin;
```

## 插件安装器 (PluginInstaller)

### 核心功能
- 自动检测插件格式
- 安装 .mpk 包（解压到用户插件目录）
- 安装单文件 .js 插件
- 插件版本管理和更新
- 插件卸载和清理

### 安装流程
1. **检测格式**：根据文件扩展名判断插件类型
2. **验证插件**：检查插件结构和配置的有效性
3. **解决冲突**：处理同名插件的版本冲突
4. **安装插件**：
   - .mpk：解压到用户插件目录
   - .js：复制并生成默认 config.json
   - 文件夹：直接复制
5. **注册插件**：更新插件注册表
6. **热加载**：动态加载新安装的插件

### 用户界面集成
- 拖拽安装：将插件文件拖拽到应用窗口
- 菜单安装：通过菜单选择插件文件安装
- 插件管理界面：列出已安装插件，支持启用/禁用/卸载

## 插件打包工具 (Plugin Packager)

### 开发者工具
```bash
# 将文件夹打包为 .mpk
node plugins/packager.js pack ./my-plugin ./dist/my-plugin.mpk

# 验证插件包
node plugins/packager.js validate ./my-plugin.mpk

# 提取插件信息
node plugins/packager.js info ./my-plugin.mpk
```

### 打包流程
1. 验证插件文件夹结构
2. 检查必需文件 (index.js, config.json)
3. 压缩文件夹内容
4. 添加插件签名（可选）
5. 生成 .mpk 文件

## 插件市场集成

### 在线安装支持
- 从URL直接安装插件
- 插件市场浏览和搜索
- 自动更新检查

### 安装示例
```javascript
// 从文件安装
await pluginInstaller.installFromFile('/path/to/plugin.mpk');

// 从URL安装  
await pluginInstaller.installFromUrl('https://plugins.mark2.com/highlight.mpk');

// 从插件市场安装
await pluginInstaller.installFromMarket('highlighter', 'latest');
```

## 向后兼容性

- 现有文件夹插件继续正常工作
- PluginManager 自动适配不同格式
- 开发者可以选择最适合的分发方式

## 实现优先级

### Phase 1：基础打包支持
- 实现 PluginInstaller 类
- 支持 .mpk 格式安装
- 基础的拖拽安装界面

### Phase 2：单文件插件
- 支持 .js 单文件插件格式  
- 自动生成配置文件

### Phase 3：高级功能
- 插件管理界面
- 在线市场集成
- 自动更新功能

这样的设计既保持了开发的便利性，又提供了用户友好的安装体验！