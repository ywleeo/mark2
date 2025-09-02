# Tab 系统架构设计 (2024重构版)

## 概述

mark2 的 Tab 系统在2024年进行了彻底重构，从原来的"TabManager 统一管理"模式转变为"Tab 自治"模式，实现了更清晰的职责分离和更可靠的状态管理。

## 核心设计理念

### "自治的Tab，服务的Manager"

- **Tab**: 完全自治的状态管理器，负责自己的生命周期
- **TabManager**: 纯粹的集合管理器，只管列表不管内容  
- **EditorManager**: 无状态的DOM服务类，被动提供服务

## 三层架构详解

### 1. Tab 类 - 自治的标签页实例

**文件**: `src/renderer/Tab.js`

**职责**:
- 维护完整的状态数据（内容、编辑模式、滚动位置等）
- 负责自己的内容显示和状态恢复
- 管理自己的生命周期（激活、取消激活）
- 调用EditorManager服务来操作界面

**核心属性**:
```javascript
class Tab {
  // 基本信息
  id, filePath, content, title, belongsTo, fileType
  
  // 状态管理
  isActive, isModified, isReadOnly, hasUnsavedChanges
  
  // 编辑器状态
  isEditMode, scrollRatio, cursorPosition
  viewScrollTop, editScrollTop
  
  // 依赖注入
  editorManager, eventManager
}
```

**核心方法**:
```javascript
// 生命周期管理
async activate()           // 激活tab，检查内容更新并显示
deactivate()              // 取消激活，保存状态
async checkAndRefreshContent()  // 检查文件是否需要刷新

// 状态管理
saveFromEditor()          // 从编辑器保存状态到tab实例
restoreToEditor()         // 将tab状态恢复到编辑器显示
resetEditorState()        // 重置编辑器相关状态

// 内容管理
async updateFileInfo()    // 更新文件信息并自动重新渲染
markSaved()              // 标记文件为已保存状态
```

**自治原则**:
1. **内容更新**: Tab收到新内容时，调用自己的`restoreToEditor()`显示
2. **状态保存**: 编辑器状态变化时，保存到自己的属性中
3. **生命周期**: `activate()`和`deactivate()`管理自己的显示状态
4. **依赖管理**: 通过依赖注入获得EditorManager和EventManager

### 2. TabManager 类 - 纯粹的集合管理器

**文件**: `src/renderer/TabManager.js`

**职责**:
- 管理tab列表的增删改查
- 协调tab之间的切换
- 处理文件打开时的tab选择逻辑
- **不直接操作内容显示**

**核心方法**:
```javascript
// Tab生命周期管理
createTab(filePath, content, title, belongsTo, fileType)
async closeTab(tabId)
async setActiveTab(tabId)

// 文件操作
async openFileFromPath(filePath, isViewOnly, forceNewTab, fileType)
async createNewFileTab()

// Tab查找和管理
findTabByPath(filePath)
getActiveTab()
updateTabBar()
```

**重构后的变化**:
- ❌ **移除**: 所有直接的`editorManager.setContent()`调用
- ❌ **移除**: 直接的内容显示逻辑
- ✅ **保留**: Tab列表管理和切换协调
- ✅ **新增**: 让Tab自己处理内容显示的机制

### 3. EditorManager 类 - 无状态的DOM服务

**文件**: `src/renderer/EditorManager.js`

**职责**:
- 提供DOM操作服务方法
- 处理编辑器和预览区域的显示切换
- 管理CodeMirror实例
- **不保存任何状态数据**

**服务方法**:
```javascript
// 无状态服务方法
renderContent(content, filePath, options)
switchMode(isEditMode, options) 
setScrollPosition(scrollRatio, isEditMode)
getCurrentScrollPosition(isEditMode)
getCurrentContent()

// 状态查询方法（通过TabManager查询）
hasUnsavedContent()       // 查询活动tab的状态
getCurrentFilePath()      // 查询活动tab的文件路径
isInEditMode()           // 查询活动tab的编辑模式
```

**重构后的变化**:
- ❌ **移除**: 所有状态属性（isEditMode, currentFilePath, originalContent等）
- ❌ **移除**: 有状态的方法（setContent, toggleEditMode等）
- ✅ **保留**: 无状态的服务方法
- ✅ **新增**: 通过TabManager获取状态的查询方法

## 数据流向图

```
用户操作 → TabManager → Tab → EditorManager → DOM
         │             │      │
         │             │      └─ renderContent(content, options)
         │             │
         │             ├─ updateFileInfo(filePath, content)
         │             ├─ saveFromEditor() 
         │             └─ restoreToEditor()
         │
         ├─ openFileFromPath()
         ├─ createTab()
         └─ setActiveTab()
```

## 关键业务流程

### 1. 用户点击文件

```javascript
1. 用户点击sidebar文件
2. FileTreeManager.emit('file-selected', filePath)
3. TabManager.openFileFromPath(filePath)
4. TabManager找到或创建对应的Tab
5. Tab.updateFileInfo(filePath, content) // Tab更新自己的信息
6. 如果Tab是活动的: Tab.restoreToEditor() // Tab自己显示内容
7. EditorManager.renderContent(content, options) // 执行DOM操作
```

### 2. Tab切换过程（防串台关键流程）

```javascript
1. TabManager.setActiveTab(newTabId)
2. 处理当前活动Tab的编辑状态:
   if (currentActiveTab.isEditMode) {
     // 2.1 获取编辑器内容并判断变化
     const editorContent = this.getEditorContent();
     const hasChanges = this.hasContentChanged(editorContent);
     
     // 2.2 如果有变化则保存，没变化则跳过
     if (hasChanges) {
       await currentActiveTab.confirmModification();
       // 更新Tab内容和基准MD5
       currentActiveTab.content = editorContent;
       currentActiveTab.originalContentMD5 = Tab.calculateMD5(editorContent);
     }
     
     // 2.3 强制关闭当前Tab的编辑模式，清理编辑器状态
     currentActiveTab.isEditMode = false;
   }
3. 当前活动Tab.deactivate() // 取消激活状态
4. 新Tab.activate() // 激活新tab（自动进入view模式）
5. 新Tab.checkAndRefreshContent() // 检查内容是否需要更新
6. 新Tab.restoreToEditor() // 恢复显示状态到view模式
7. EditorManager.renderContent() // 执行DOM操作
```

### 3. 进入编辑模式流程（Cmd+E触发）

```javascript
1. 快捷键管理器捕获Cmd+E
2. 获取当前活跃的Tab（必须是唯一的，由TabManager确保）:
   const activeTab = this.tabManager.getActiveTab();
3. 从活跃Tab获取内容，创建编辑器并显示:
   const content = activeTab.content;
   this.editorManager.switchMode(true, { content, filePath: activeTab.filePath });
4. 标记Tab进入编辑模式:
   activeTab.isEditMode = true;
```

### 3. 新文件创建

```javascript
1. TabManager.createNewFileTab()
2. 创建Tab实例，设置isEditMode=true
3. Tab.activate() // 激活tab
4. Tab.restoreToEditor() // Tab显示内容（空内容，编辑模式）
5. EditorManager.renderContent('', null, {isEditMode: true})
```

## 状态管理原则

### 状态完全隔离

每个Tab的状态完全独立，包括：
- 编辑模式状态
- 滚动位置
- 未保存变更标记
- 光标位置
- 文件内容

### 实时同步机制

```javascript
// 编辑器内容变化时
editor.addEventListener('input', () => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab) {
    activeTab.saveFromEditor(); // 立即保存到tab状态
  }
});
```

### 按需渲染

只有活动的Tab会调用EditorManager进行界面渲染，非活动Tab的状态保存在内存中。

## 开发指南

### 添加新的Tab功能

1. **在Tab.js中添加状态属性**
2. **在saveFromEditor()中保存状态**  
3. **在restoreToEditor()中恢复状态**
4. **如需响应内容更新，在updateFileInfo()中处理**

### TabManager开发约束

✅ **应该做**:
- 管理tab列表
- 协调tab切换
- 处理文件打开逻辑
- 调用Tab的方法

❌ **不应该做**:
- 直接调用`editorManager.renderContent()`
- 直接操作编辑器DOM
- 保存或管理文件内容

### EditorManager开发约束

✅ **应该做**:
- 提供无状态的服务方法
- 通过参数接收所有需要的数据
- 执行DOM操作
- 管理CodeMirror实例

❌ **不应该做**:
- 保存任何状态属性
- 直接读取文件或tab状态
- 假设当前的编辑模式或内容

## 重构优势

1. **职责清晰**: 每个类的边界明确，降低耦合
2. **状态可靠**: Tab状态完全隔离，不会相互干扰  
3. **维护简单**: 修改功能时影响范围明确
4. **扩展容易**: 新增Tab功能只需修改Tab类
5. **测试友好**: 每个类都可以独立测试
6. **调试方便**: 问题定位更准确

## 常见问题

### Q: 为什么不让TabManager直接管理内容显示？
A: 这样会导致TabManager职责过重，且状态管理复杂。Tab自治模式下，每个Tab负责自己的状态，更加可靠。

### Q: EditorManager为什么要设计成无状态？
A: 无状态的服务类更容易测试和维护，且避免了状态同步问题。所有状态由Tab管理，EditorManager只负责执行。

### Q: 如何确保Tab切换时状态不丢失？
A: 通过Tab的`saveFromEditor()`和`restoreToEditor()`机制，确保每次切换都正确保存和恢复状态。

### Q: 如何添加新的编辑器功能？
A: 在Tab类中添加对应的状态属性，在EditorManager中添加对应的服务方法，通过Tab调用服务方法实现功能。

## 迁移指南

如果有旧代码需要迁移到新架构：

1. **替换setContent调用**:
```javascript
// 旧代码
editorManager.setContent(content, filePath)

// 新代码  
tab.content = content
tab.filePath = filePath
tab.restoreToEditor()
```

2. **替换状态查询**:
```javascript
// 旧代码
if (editorManager.isEditMode) { ... }

// 新代码
const activeTab = tabManager.getActiveTab()
if (activeTab?.isEditMode) { ... }
```

3. **替换内容获取**:
```javascript
// 旧代码
const content = editorManager.getCurrentContent()

// 新代码（通过Tab获取）
const activeTab = tabManager.getActiveTab()
const content = activeTab?.content || ''
```