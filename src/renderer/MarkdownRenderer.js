const { marked } = require('marked');
const { markedEmoji } = require('marked-emoji');
const hljs = require('highlight.js');

class MarkdownRenderer {
  constructor() {
    this.setupMarked();
    this.currentHighlightTask = null; // 当前的高亮任务ID
  }

  setupMarked() {
    // 配置 marked - 启用 GFM 扩展语法和代码高亮
    marked.setOptions({
      breaks: true,
      gfm: true,           // 启用 GitHub Flavored Markdown
      mangle: false,
      headerIds: false,
      highlight: function(code, lang) {
        // 让 highlight.js 直接处理代码高亮
        if (lang && hljs.getLanguage(lang)) {
          try {
            let result = hljs.highlight(code, { language: lang });
            
            // 特别处理 bash 语言，添加现代工具包支持
            if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
              // 只对未高亮的命令添加 built_in 标签
              result.value = result.value.replace(
                /(?<!<span class="hljs-built_in">)\b(npm|npx|yarn|pnpm|brew|uv|docker|git|curl|wget|node|deno|bun|pip|pip3|conda|pipenv|ping|ssh|rsync|ps|top|systemctl|sudo|kill|chmod|rg|fd|bat|exa|jq|fzf|gh|kubectl|terraform|ansible)\b(?!<\/span>)/g,
                '<span class="hljs-built_in">$&</span>'
              );
            }
            
            return result.value;
          } catch (err) {
            console.error('Highlight.js error:', err);
          }
        }
        try {
          return hljs.highlightAuto(code).value;
        } catch (err) {
          console.error('Highlight.js auto error:', err);
          return code; // 出错时返回原始代码
        }
      }
    });

    // 保存当前文件路径，用于图片路径解析
    this.currentFilePath = null;

    // 自定义渲染器
    const renderer = new marked.Renderer();
    const originalLinkRenderer = renderer.link.bind(renderer);
    const originalImageRenderer = renderer.image.bind(renderer);
    
    renderer.link = function(href, title, text) {
      // 判断是否为外链（包含协议的完整URL）
      const isExternalLink = /^https?:\/\//.test(href);

      if (isExternalLink) {
        // 外链添加特殊类名和数据属性
        const titleAttr = title ? ` title="${title}"` : '';
        return `<a href="${href}" class="external-link" data-external-url="${href}"${titleAttr}>${text}</a>`;
      } else {
        // 内部链接使用默认渲染
        return originalLinkRenderer(href, title, text);
      }
    };
    
    // 自定义图片渲染器，处理相对路径
    renderer.image = (href, title, text) => {
      // 如果是相对路径且有当前文件路径，则转换为绝对路径
      if (this.currentFilePath && href && !href.match(/^https?:\/\//) && !href.startsWith('/')) {
        const path = require('path');
        const currentDir = path.dirname(this.currentFilePath);
        const absolutePath = path.resolve(currentDir, href);
        // 转换为 file:// 协议路径
        href = `file://${absolutePath}`;
      }
      
      // 调用原始图片渲染器
      return originalImageRenderer(href, title, text);
    };
    
    marked.setOptions({ renderer });
    
    // 添加emoji支持（针对marked 5.0.0）
    try {
      marked.use(markedEmoji());
    } catch (error) {
      console.warn('marked-emoji插件加载失败:', error);
    }
    
    // 启用 GFM 扩展 (删除线、任务列表等)
    marked.use({
      gfm: true,
      strikethrough: true  // 启用删除线支持
    });
    
  }

  renderMarkdown(content, targetElement = null, filePath = null) {
    if (!content) return '';

    try {
      // 设置当前文件路径，用于图片路径解析
      this.currentFilePath = filePath;

      // 检测文件类型
      const fileType = this.detectFileType(filePath, content);

      // 如果是 JSON 文件，使用 JSON 渲染器
      if (fileType === 'json') {
        return this.renderJSON(content);
      }

      // 清理零宽度字符，这些字符会干扰emoji渲染
      if (typeof content === 'string') {
        // 移除可能干扰Unicode渲染的零宽度字符
        content = content.replace(/^[\u200B\u200C\u200D\u200E\u200F\uFEFF]/,"");
        // 移除所有零宽度字符（全局替换）
        content = content.replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, '');
      }

      // 预处理 Markdown
      const preprocessed = this.preprocessMarkdown(content);

      // 渲染为 HTML（marked.js 会自动处理代码高亮）
      let html = marked(preprocessed);

      // 清理预处理时添加的空格标记
      // 1. 移除非空格字符和 <strong> 之间的空格
      html = html.replace(/([^\s]) (<strong>)/g, '$1$2');
      // 2. 移除 </strong> 后的空格标记（ %）
      html = html.replace(/(<\/strong>) %/g, '$1');

      // 修复嵌套的强调标签
      html = this.fixNestedStrongTags(html);

      // 隔离样式标签，防止样式冲突
      html = this.sanitizeStyles(html);

      // 为代码块添加复制按钮
      html = this.addCopyButtonsToCodeBlocks(html);

      // 如果提供了目标元素，启用异步关键词高亮
      if (targetElement) {
        // 取消之前的高亮任务
        if (this.currentHighlightTask) {
          cancelAnimationFrame(this.currentHighlightTask);
          this.currentHighlightTask = null;
        }

        // 为当前内容添加标记，用于验证任务有效性
        const contentId = Date.now() + Math.random();
        targetElement.dataset.contentId = contentId;

        // 创建新的异步高亮任务
        this.currentHighlightTask = requestAnimationFrame(() => {
          try {
            // 检查任务是否还有效（元素存在且内容ID匹配）
            if (targetElement.isConnected && targetElement.dataset.contentId === String(contentId)) {
              let enhancedHtml = this.applyKeywordHighlight(html, content);
              if (enhancedHtml !== html) {
                targetElement.innerHTML = enhancedHtml;
                // 保持内容ID，表示高亮已完成
                targetElement.dataset.contentId = contentId;
              }
            }
          } catch (error) {
            console.warn('异步关键词高亮失败:', error);
          } finally {
            this.currentHighlightTask = null;
          }
        });

        // 立即返回基础版本
        return html;
      }

      // 兼容性：如果没有提供目标元素，保持同步行为
      html = this.applyKeywordHighlight(html, content);

      return html;
    } catch (error) {
      console.error('Markdown rendering error:', error);
      return '<p>渲染错误</p>';
    }
  }

  preprocessMarkdown(content) {
    // 将可能被误判为 setext 标题的模式转换为安全格式
    let processed = content;
    
    // 确保文件末尾有换行符，防止标题在文件末尾时渲染报错
    if (processed && !processed.endsWith('\n')) {
      processed += '\n';
    }
    
    // 匹配 文本\n--- 的模式，将其转换为 文本\n\n---
    // 这样可以避免 marked.js 将前面的文本识别为标题
    processed = processed.replace(/^(.+)\n(-{3,})$/gm, (match, text, dashes) => {
      // 在文本和分隔线之间添加一个空行，避免被识别为 setext 标题
      return `${text}\n\n${dashes}`;
    });
    
    // 对 = 号也做同样处理
    processed = processed.replace(/^(.+)\n(={3,})$/gm, (match, text, equals) => {
      return `${text}\n\n${equals}`;
    });
    
    // 修复 marked.js 无法识别紧贴 ** 的加粗标记问题
    // 问题：当 ** 前后没有空格时，marked.js 无法正确识别加粗
    // 例如：的**"文本"**。 → 无法识别
    //      (括号)**文本** → 无法识别
    // 解决：匹配完整的 **内容** 模式，在前后插入空格

    // 匹配：(非空格非星号字符)?**内容**(非空格非星号字符)?
    // 如果前后紧贴非空格字符，则插入空格（添加 % 标记便于后续移除）
    processed = processed.replace(
      /([^\s*]?)(\*\*[^*]+?\*\*)([^\s*]?)/g,
      (match, before, bold, after) => {
        let result = bold;
        // 如果前面紧贴字符，插入空格
        if (before) {
          result = before + ' ' + result;
        } else {
          result = before + result;
        }
        // 如果后面紧贴字符，插入空格标记（%用于标识需要移除）
        if (after) {
          result = result + ' %' + after;
        } else {
          result = result + after;
        }
        return result;
      }
    );

    // 修复连续加粗的问题：**text1****text2** 应该被解析为两个独立的加粗
    // 问题：marked.js 会把 **** 当作普通文本，而不是两个加粗的边界
    // 解决：匹配 **[非星号内容]**** 的模式，在中间插入空格
    // 例如：**text1****text2** → **text1** **text2**
    // 但保留：**"text"** 这样包含引号的正常加粗语法
    processed = processed.replace(/(\*\*[^*]+\*\*)(\*\*)/g, '$1 $2');

    return processed;
  }


  fixNestedStrongTags(html) {
    // 修复嵌套的 strong 标签，保持语义正确性

    // 匹配类似 <strong>70%<strong>的惊人涨幅。其中，光模块制造商</strong>中际旭创</strong> 的模式
    // 这种情况应该变成 <strong>70%</strong>的惊人涨幅。其中，光模块制造商<strong>中际旭创</strong>

    // 处理最常见的问题模式：<strong>A<strong>B</strong>C</strong>
    // 这通常来自 **A**B** 这样的语法错误
    html = html.replace(
      /<strong>([^<]*?)<strong>([^<]*?)<\/strong>([^<]*?)<\/strong>/g,
      (match, before, middle, after) => {
        // 智能判断分割点
        // 如果before以百分号、数字或简短词结尾，通常是独立的加粗
        if (/[%\d]$/.test(before.trim()) || before.trim().length <= 3) {
          return `<strong>${before}</strong>${middle}<strong>${after}</strong>`;
        }
        // 如果after是简短的词（比如人名、公司名），也应该独立
        else if (after.trim().length <= 10 && !/[，。；：！？]/.test(after)) {
          return `<strong>${before}</strong>${middle}<strong>${after}</strong>`;
        }
        // 其他情况保持为一个加粗块
        else {
          return `<strong>${before}${middle}${after}</strong>`;
        }
      }
    );

    // 处理连续嵌套的情况：<strong><strong>content</strong>other</strong>
    html = html.replace(/<strong><strong>([^<]*)<\/strong>([^<]*)<\/strong>/g,
      '<strong>$1</strong><strong>$2</strong>');

    // 处理末尾嵌套：<strong>content<strong>nested</strong></strong>
    html = html.replace(/<strong>([^<]*)<strong>([^<]*)<\/strong><\/strong>/g,
      '<strong>$1</strong><strong>$2</strong>');

    // 清理空的强调标签
    html = html.replace(/<strong>\s*<\/strong>/g, '');

    return html;
  }

  sanitizeStyles(html) {
    // marked.js 已经处理了HTML转义，这里不需要额外处理
    return html;
  }


  escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
  }


  applyKeywordHighlight(html, originalContent = null) {
    // 检查是否在浏览器环境中
    if (typeof window !== 'undefined' && window.pluginManager && window.pluginManager.initialized) {
      return window.pluginManager.processMarkdown(html, originalContent);
    }

    // 如果不在浏览器环境或插件系统未初始化，直接返回原始HTML
    return html;
  }

  // 检测文件类型
  detectFileType(filePath, content) {
    if (!filePath) {
      // 如果没有文件路径，尝试通过内容判断
      if (typeof content === 'string') {
        const trimmed = content.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            JSON.parse(content);
            return 'json';
          } catch (e) {
            // 不是有效的 JSON
          }
        }
      }
      return 'markdown';
    }

    // 根据文件扩展名判断
    const ext = filePath.split('.').pop().toLowerCase();
    if (ext === 'json') {
      return 'json';
    }

    return 'markdown';
  }

  // 渲染 JSON 内容
  renderJSON(content) {
    try {
      // 解析 JSON
      const jsonObj = JSON.parse(content);

      // 格式化 JSON（美化输出）
      const formatted = JSON.stringify(jsonObj, null, 2);

      // 使用 highlight.js 进行语法高亮
      let highlighted;
      try {
        highlighted = hljs.highlight(formatted, { language: 'json' }).value;
      } catch (e) {
        highlighted = this.escapeHtml(formatted);
      }

      // 返回格式化的 HTML
      return `
        <div class="json-viewer">
          <div class="json-header">
            <span class="json-format-label">JSON</span>
          </div>
          <pre><code class="hljs language-json">${highlighted}</code></pre>
        </div>
      `;
    } catch (error) {
      // JSON 解析失败，显示错误信息
      return `
        <div class="json-viewer json-error">
          <div class="json-header">
            <span class="json-format-label error">JSON 解析错误</span>
          </div>
          <pre><code>${this.escapeHtml(error.message)}</code></pre>
          <div class="json-raw-content">
            <h4>原始内容:</h4>
            <pre><code>${this.escapeHtml(content)}</code></pre>
          </div>
        </div>
      `;
    }
  }

  // HTML 转义函数
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // 为代码块添加复制按钮
  addCopyButtonsToCodeBlocks(html) {
    // 匹配所有 <pre><code>...</code></pre> 代码块
    return html.replace(
      /(<pre>)(<code[^>]*>)([\s\S]*?)(<\/code><\/pre>)/g,
      (match, preOpen, codeOpen, codeContent, closeTags) => {
        // 为每个代码块生成唯一ID
        const blockId = 'code-block-' + Math.random().toString(36).substr(2, 9);

        // 包装代码块并添加复制按钮
        return `<div class="code-block-wrapper" data-block-id="${blockId}">
          ${preOpen}${codeOpen}${codeContent}${closeTags}
          <button class="code-copy-btn" data-block-id="${blockId}" title="复制代码">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>`;
      }
    );
  }

}

module.exports = MarkdownRenderer;