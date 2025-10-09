# Mark2 Tauri 迁移进度

## 已完成功能

### ✅ 1. 初始化 Tauri 项目结构
- 创建了 Tauri 项目基础结构
- 配置了 package.json 和 Cargo.toml
- 设置了 Vite 构建系统

### ✅ 2. 配置 Tauri 基础设置
- 配置了 tauri.conf.json
- 实现了 Rust 后端的基础文件操作命令:
  - `read_file`: 读取文件
  - `write_file`: 写入文件
  - `read_dir`: 读取目录
- 集成了 Tauri 插件:
  - tauri-plugin-dialog (文件对话框)
  - tauri-plugin-fs (文件系统)

### ✅ 3. 迁移样式文件
- 复制了 layout.css
- 复制了 light-theme.css
- 复制了 dark-theme.css

### 🔄 4. 实现文件打开和文件树功能 (进行中)
- 创建了 FileTreeManager.js
- 实现了打开文件夹功能
- 实现了文件树渲染
- 正在编译测试中...

## 待实现功能

### ⏳ 5. Markdown 渲染和预览功能
- 集成 marked.js
- 集成 highlight.js
- 实现 Markdown 渲染器

### ⏳ 6. 编辑器模式 (CodeMirror 集成)
- 集成 CodeMirror 6
- 实现编辑/预览模式切换

### ⏳ 7. 文件保存功能
- 实现保存逻辑
- 实现自动保存

### ⏳ 8. 多标签页系统
- 迁移 Tab.js
- 迁移 TabManager.js

### ⏳ 9. 侧边栏切换功能
- 实现侧边栏显示/隐藏

### ⏳ 10. 主题切换系统
- 实现浅色/深色主题切换

### ⏳ 11. 设置管理功能
- 实现设置界面
- 实现设置持久化

### ⏳ 12. 文件监听和自动刷新
- 实现文件监听
- 实现自动刷新

### ⏳ 13. 搜索功能
- 实现文件搜索

### ⏳ 14. 截图功能
- 集成 html2canvas

### ⏳ 15. 插件系统
- 迁移插件架构
- 迁移现有插件

### ⏳ 16. 菜单系统和快捷键
- 实现应用菜单
- 实现快捷键系统

### ⏳ 17. 配置打包和发布
- 配置打包选项
- 测试多平台构建

## 技术栈对比

### Electron 版本
- 主进程: Node.js + Electron API
- 渲染进程: HTML/CSS/JS
- 通信: ipcMain/ipcRenderer

### Tauri 版本
- 后端: Rust + Tauri API
- 前端: HTML/CSS/JS
- 通信: invoke/command
- 构建: Vite

## 当前状态

正在进行第一次编译和测试,预计完成后可以看到:
1. 窗口打开
2. 文件树界面
3. 打开文件夹功能

## 下一步计划

1. 测试文件打开和文件树基础功能
2. 实现 Markdown 渲染和预览
3. 逐步添加其他功能,每完成一个功能就测试
