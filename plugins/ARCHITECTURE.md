# Mark2 插件架构设计文档

## 架构对比

### ❌ 重构前：伪插件架构
```
┌─────────────────┐
│   应用主体        │
│  ┌─────────────┐ │
│  │   插件包装    │ │  <- 只是包装，不是真正的插件化
│  │ ┌─────────┐ │ │
│  │ │ 完整功能  │ │ │  <- 所有逻辑都在插件内部
│  │ └─────────┘ │ │
│  └─────────────┘ │
└─────────────────┘
```

**问题**：
- 插件包含完整功能实现
- 平台只提供加载机制
- 无法灵活定制和扩展
- 插件间难以协作

### ✅ 重构后：真正的插件架构
```
┌─────────────────┐
│   平台核心        │
│ ┌─────────────┐ │
│ │ Platform API │ │  <- 提供丰富的基础能力
│ │ - highlight  │ │
│ │ - extractText│ │
│ │ - addCSS     │ │
│ │ - findMatch  │ │
│ └─────────────┘ │
└─────────────────┘
        ▲
        │ API 调用
        ▼
┌─────────────────┐
│     插件         │
│ ┌─────────────┐ │
│ │ 业务逻辑      │ │  <- 只定义规则和样式
│ │ - patterns  │ │
│ │ - styles    │ │
│ │ - config    │ │
│ └─────────────┘ │
└─────────────────┘
```

**优势**：
- 平台提供强大 API
- 插件专注业务逻辑
- 高度可定制化
- 插件间可协作

## API 设计原则

### 1. 能力分层
```javascript
// 底层能力 - 文本处理
api.extractText(html)
api.findMatches(text, pattern)

// 中层能力 - HTML 操作
api.replaceInHTML(html, search, replacement)
api.highlight(text, className)

// 高层能力 - 批量处理
api.batchHighlight(html, highlights)

// 支持能力 - 样式管理
api.addCSS(className, styles)
api.addCSSBatch(classStyles)
```

### 2. 安全优先
- 自动处理 HTML 结构完整性
- 避免XSS注入风险
- 智能处理重叠高亮冲突

### 3. 性能优化
- 批量DOM操作减少重排
- 智能缓存和去重
- 按需处理策略

### 4. 开发友好
- 简洁的API设计
- 丰富的调试工具
- 统一的错误处理

## 插件开发模式

### 声明式配置
```javascript
// 插件只需要声明规则和样式
this.patterns = {
    emails: [/\w+@\w+\.\w+/g],
    phones: [/\d{3}-\d{3}-\d{4}/g]
};

this.styleConfig = {
    'highlight-email': { backgroundColor: '#e11d48' },
    'highlight-phone': { backgroundColor: '#10b981' }
};
```

### 组合式功能
```javascript
// 插件可以组合多种处理逻辑
processMarkdown(html) {
    let highlights = [];
    
    // 组合多种匹配结果
    highlights.push(...this.extractEmails(html));
    highlights.push(...this.extractPhones(html));
    highlights.push(...this.extractUrls(html));
    
    // 使用平台API批量处理
    return this.api.batchHighlight(html, highlights);
}
```

### 插件间协作
```javascript
// 插件可以通过事件系统协作
this.api.on('text-selected', (data) => {
    if (this.isEmail(data.text)) {
        this.api.emit('email-detected', { email: data.text });
    }
});
```

## 扩展性设计

### 1. 新插件类型
- **内容处理插件**：文本高亮、格式化
- **交互增强插件**：表格编辑、图表生成
- **功能扩展插件**：导出、分享、同步

### 2. API 扩展
```javascript
// 未来可以扩展更多API
window.platformAPI = {
    // 现有文本处理API
    // ...
    
    // 未来扩展：DOM操作API
    createElement(tag, attrs, children),
    querySelector(selector),
    
    // 未来扩展：数据处理API
    parseCSV(text),
    generateChart(data, type),
    
    // 未来扩展：网络API
    fetch(url, options),
    upload(file, endpoint)
};
```

### 3. 配置系统
```javascript
// 插件可以定义自己的配置界面
getConfigSchema() {
    return {
        enableEmails: { type: 'boolean', default: true },
        emailColor: { type: 'color', default: '#e11d48' },
        patterns: { type: 'array', default: [] }
    };
}
```

## 性能考虑

### 1. 懒加载
- 插件按需加载
- API 功能按需初始化

### 2. 缓存机制
- 匹配结果缓存
- 样式计算缓存

### 3. 批量操作
- DOM操作批量执行
- 样式更新合并处理

## 安全机制

### 1. 沙盒隔离
- 插件无法访问敏感API
- 限制文件系统访问

### 2. 输入验证
- 自动转义HTML内容
- 验证插件配置

### 3. 权限控制
- API访问权限控制
- 插件功能限制

这个架构实现了真正的**平台能力**与**插件创意**的分离，为Mark2带来了无限的扩展可能！