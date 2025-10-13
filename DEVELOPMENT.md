# Mark2 开发规范

## 点击事件处理

### 问题背景

macOS 触控板轻点会同时触发 `pointerup` 和 `click` 事件，导致回调函数被执行两次。

### 统一解决方案

**所有需要处理点击的交互组件，必须使用 `addClickHandler` 工具函数**，不要直接使用 `addEventListener('click')`。

### 使用方法

```javascript
import { addClickHandler } from '../utils/PointerHelper.js';

export class YourComponent {
    constructor() {
        this.cleanupFunctions = [];
        this.init();
    }

    init() {
        const button = document.createElement('button');

        // ✅ 正确：使用 addClickHandler
        const cleanup = addClickHandler(button, (event) => {
            console.log('按钮被点击');
        });
        this.cleanupFunctions.push(cleanup);

        // ❌ 错误：不要直接使用 click 事件
        // button.addEventListener('click', handleClick);
    }

    dispose() {
        // 清理所有事件监听器
        this.cleanupFunctions.forEach(cleanup => cleanup?.());
        this.cleanupFunctions = [];
    }
}
```

### 常见场景

#### 1. 简单点击
```javascript
addClickHandler(element, () => {
    doSomething();
});
```

#### 2. 带条件判断
```javascript
addClickHandler(container, (event) => {
    // 忽略特定子元素的点击
    if (event.target.closest('.ignore-class')) {
        return;
    }
    handleClick();
});
```

#### 3. 阻止冒泡
```javascript
addClickHandler(button, (event) => {
    event.stopPropagation();
    handleAction();
});
```

#### 4. 双击事件
双击仍然使用原生 `dblclick`：
```javascript
addClickHandler(element, handleSingleClick);
element.addEventListener('dblclick', handleDoubleClick);
```

### 清理规范

**所有组件必须实现 `dispose()` 方法**，清理事件监听器：

```javascript
dispose() {
    // 清理点击事件
    this.cleanupFunctions.forEach(cleanup => {
        if (typeof cleanup === 'function') {
            cleanup();
        }
    });
    this.cleanupFunctions = [];

    // 其他清理逻辑...
}
```

### 已实现的组件

以下组件已正确实现：
- ✅ `FileTree.js` - 文件树
- ✅ `SettingsDialog.js` - 设置对话框
- ✅ `TabManager.js` - 标签管理器

新增组件请参考这些组件的实现。

### 工具函数参考

**位置**: `src/utils/PointerHelper.js`

#### `addClickHandler(element, handler, options)`

**参数**:
- `element` (HTMLElement): 目标元素
- `handler` (Function): 点击处理函数，接收 event 参数
- `options` (Object, 可选):
  - `shouldHandle` (Function): 可选的判断函数，返回 false 则忽略该次点击

**返回**: 清理函数，调用后移除事件监听器

**示例**:
```javascript
const cleanup = addClickHandler(button, (event) => {
    console.log('点击了按钮');
});

// 使用完毕后清理
cleanup();
```

#### `isPrimaryPointerActivation(event)`

检查是否是有效的主指针激活事件（鼠标左键/触摸/笔）。

**通常不需要直接调用**，`addClickHandler` 内部已处理。

---

## 其他开发规范

### 代码风格
- 使用 ES6+ 语法
- 类使用 PascalCase，函数和变量使用 camelCase
- 保持代码简洁，避免过度工程化

### 组件结构
```javascript
export class Component {
    constructor() {
        // 初始化状态
        this.cleanupFunctions = [];
        this.init();
    }

    init() {
        // 创建 DOM 和绑定事件
    }

    dispose() {
        // 清理资源
    }
}
```

### 命名规范
- 回调函数：`onXxx` 或 `handleXxx`
- 布尔值：`isXxx` 或 `hasXxx`
- 异步函数：使用 `async/await`
