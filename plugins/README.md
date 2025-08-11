# Mark2 插件系统 - 真正的插件架构

Mark2 现在支持真正的插件化架构：**平台提供 API，插件定义逻辑**。

## 🏗️ 架构设计

### 平台 API (PlatformAPI)
```javascript
window.platformAPI = {
  // 高亮功能
  highlight(text, className),
  batchHighlight(html, highlights),
  
  // 文本处理
  extractText(html),
  replaceInHTML(html, search, replacement),
  findMatches(text, pattern),
  findMatchesAll(text, patterns),
  
  // 样式管理
  addCSS(className, styles),
  addCSSBatch(classStyles),
  
  // 配置管理
  getConfig(key), setConfig(key, value),
  
  // 事件系统
  emit(eventName, data), on(eventName, handler),
  
  // 调试工具
  log(pluginName, message), warn(pluginName, message)
};
```

### 插件定义逻辑
```javascript
class MyPlugin extends BasePlugin {
    constructor(pluginConfig) {
        super(pluginConfig);
        
        // 插件定义自己的匹配规则
        this.patterns = {
            emails: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g]
        };
        
        // 插件定义自己的样式
        this.styleConfig = {
            'highlight-email': {
                backgroundColor: '#e11d48',
                color: 'white',
                borderRadius: '3px'
            }
        };
    }
    
    async init() {
        await super.init();
        
        // 使用平台 API 注册样式
        this.api.addCSSBatch(this.styleConfig);
    }
    
    processMarkdown(html) {
        // 使用平台 API 提取和高亮
        const text = this.api.extractText(html);
        const emails = this.api.findMatchesAll(text, this.patterns.emails);
        const highlights = emails.map(email => ({
            text: email,
            className: 'highlight-email'
        }));
        
        return this.api.batchHighlight(html, highlights);
    }
}
```

## 🎯 核心特性

### ✅ 真正的分离
- **平台负责**：文本处理、HTML 操作、样式管理、配置存储
- **插件负责**：匹配规则、颜色定义、业务逻辑、用户配置

### ✅ 高度可定制
```javascript
// 插件可以完全自定义样式
this.api.addCSS('my-highlight', {
    backgroundColor: '#ff6b6b',
    color: '#ffffff',
    fontWeight: 'bold',
    textDecoration: 'underline'
});

// 插件可以定义复杂的匹配规则
this.patterns = {
    urls: [/https?:\/\/[^\s]+/g],
    phones: [/\d{3}-\d{3}-\d{4}/g],
    hashtags: [/#\w+/g]
};
```

### ✅ 平台 API 优势
- **安全处理**：自动处理 HTML 结构，避免破坏文档
- **冲突避免**：智能处理重叠高亮，按长度优先
- **性能优化**：批量处理，减少 DOM 操作
- **一致体验**：统一的样式管理和配置系统

## 📋 现有插件

### 关键词高亮插件 (keyword-highlighter)

**功能定义**：
- 数字匹配：百分比、货币、统计数字
- 日期匹配：年月日、时间段、季度
- 实体匹配：公司名、人名、地名
- 热词匹配：技术术语、金融词汇

**样式定义**：
- 数字：蓝色背景 (`#3b82f6`)
- 日期：紫色背景 (`#8b5cf6`)
- 实体：绿色背景 (`#10b981`)
- 热词：橙色背景 (`#f59e0b`)

**配置选项**：
```json
{
  "enableNumbers": true,
  "enableDates": true,
  "enableEntities": true,
  "enableHotwords": true,
  "enableCustomKeywords": true
}
```

## 🚀 开发新插件

### 1. 创建插件目录
```bash
mkdir plugins/my-plugin
cd plugins/my-plugin
```

### 2. 编写配置文件 (config.json)
```json
{
  "name": "我的插件",
  "version": "1.0.0",
  "description": "插件描述",
  "enabled": true,
  "config": {
    "option1": true,
    "color": "#ff6b6b"
  }
}
```

### 3. 编写插件代码 (index.js)
```javascript
const BasePlugin = require('../BasePlugin');

class MyPlugin extends BasePlugin {
    constructor(pluginConfig) {
        super(pluginConfig);
        
        // 定义匹配规则
        this.patterns = {
            // 你的匹配模式
        };
        
        // 定义样式
        this.styleConfig = {
            // 你的样式定义
        };
    }
    
    async init() {
        await super.init();
        
        // 注册样式
        this.api.addCSSBatch(this.styleConfig);
        
        this.api.log(this.name, '插件初始化完成');
    }
    
    processMarkdown(html) {
        if (!this.isActive()) return html;
        
        // 实现你的处理逻辑
        // 使用 this.api.* 方法
        
        return html;
    }
}

module.exports = MyPlugin;
```

### 4. 重启应用
插件会自动加载！

## 🔄 插件示例：邮箱高亮

```javascript
const BasePlugin = require('../BasePlugin');

class EmailHighlighterPlugin extends BasePlugin {
    constructor(pluginConfig) {
        super(pluginConfig);
        
        this.patterns = {
            emails: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g]
        };
        
        this.styleConfig = {
            'highlight-email': {
                backgroundColor: '#e11d48',
                color: 'white',
                padding: '2px 4px',
                borderRadius: '3px',
                textDecoration: 'underline'
            }
        };
    }
    
    async init() {
        await super.init();
        this.api.addCSSBatch(this.styleConfig);
        this.api.log(this.name, '邮箱高亮插件初始化完成');
    }
    
    processMarkdown(html) {
        if (!this.isActive()) return html;
        
        const text = this.api.extractText(html);
        const emails = this.api.findMatchesAll(text, this.patterns.emails);
        const highlights = emails.map(email => ({
            text: email,
            className: 'highlight-email'
        }));
        
        return this.api.batchHighlight(html, highlights);
    }
}

module.exports = EmailHighlighterPlugin;
```

## 🎨 设计原则

1. **平台提供工具，插件定义策略**
2. **插件自包含，样式与逻辑一体化**
3. **API 简洁，功能强大**
4. **配置灵活，扩展容易**
5. **性能优先，智能处理**

这就是真正的插件架构：**平台提供能力，插件发挥创意**！