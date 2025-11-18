# Markdown 主题说明

## 内置主题

当前提供了三个内置主题：

- **default.css** - GitHub 浅色风格，适合日常使用
- **emerald.css** - 翠绿风格，清新优雅的混合字体主题
- **notion.css** - Notion 风格，简洁优雅

## 如何切换主题

1. 打开设置对话框（菜单 -> 设置）
2. 在"Markdown模式"标签下，选择"主题"
3. 从下拉列表中选择你想要的主题
4. 点击"保存"

## 自定义主题

你可以创建自己的主题文件：

1. 在 `styles/themes/` 目录下创建新的 CSS 文件，例如 `my-theme.css`
2. 参考现有主题文件编写样式
3. 在 `src/components/SettingsDialog.js` 中添加主题选项：
   ```javascript
   <option value="my-theme">我的主题</option>
   ```

## 主题文件结构

主题文件主要定义以下内容：

### CSS 变量
```css
:root[data-theme-appearance='light'] {
    --theme-bg: #ffffff;              /* 背景色 */
    --theme-text: #333333;            /* 主文本颜色 */
    --theme-text-secondary: #666666;  /* 次要文本，例如占位符 */
    --theme-link: #0066cc;            /* 链接颜色，同时也会影响任务复选框等高亮 */
    --theme-code-bg: #f0f0f0;         /* 行内代码背景 */
    --theme-code-block-bg: #f6f8fa;   /* 代码块背景 */
    --theme-accent: #3fb950;          /* 复选框选中、拖拽指示器等强调色 */
    /* ... 其他变量 */
}

:root[data-theme-appearance='dark'] {
    /* 深色模式下的变量值 */
}
```

### 元素样式
- 标题 (h1-h6)
- 段落 (p)
- 代码块 (pre, code)
- 引用 (blockquote)
- 链接 (a)
- 表格 (table)
- 水平线 (hr)

### 代码高亮
- 使用 `.hljs-*` 类定义代码语法高亮颜色

## 提示

- 主题 CSS 会覆盖 `editor.css` 和 `highlight.css` 中的相关样式
- 保持主题文件简洁，只定义颜色和必要的样式差异
- 建议使用 CSS 变量来保持一致性
- 记得同时提供 `[data-theme-appearance='light']` 与 `[data-theme-appearance='dark']` 两套变量值，以便设置中的浅色/深色/跟随系统正确切换
- 如果需要针对不同模式做差异化细节，可使用 `:root[data-theme-appearance="..."]` 选择器追加额外样式
