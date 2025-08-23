const { marked } = require('marked');
const hljs = require('highlight.js');

class MarkdownRenderer {
  constructor() {
    this.setupMarked();
    this.currentHighlightTask = null; // 当前的高亮任务ID
  }

  setupMarked() {
    // 配置 marked - 启用 GFM 扩展语法
    marked.setOptions({
      breaks: true,
      gfm: true,           // 启用 GitHub Flavored Markdown
      mangle: false,
      headerIds: false
    });

    // 自定义链接渲染器，让外链在系统浏览器中打开
    const renderer = new marked.Renderer();
    const originalLinkRenderer = renderer.link.bind(renderer);
    
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
    
    marked.setOptions({ renderer });
    
    // 启用 GFM 扩展 (删除线、任务列表等)
    marked.use({
      gfm: true,
      strikethrough: true  // 启用删除线支持
    });
    
    // 完全禁用 setext 标题，只允许 ATX 标题
    marked.use({
      extensions: [{
        name: 'heading',
        level: 'block',
        start(src) {
          // 只匹配 ATX 标题开头的行
          return src.match(/^#{1,6}\s/)?.index;
        },
        tokenizer(src) {
          // 只处理 ATX 标题 (# ## ###)
          const rule = /^(#{1,6})\s+(.*)$/;
          const match = rule.exec(src);
          if (match) {
            return {
              type: 'heading',
              raw: match[0],
              depth: match[1].length,
              text: match[2].trim()
            };
          }
        }
      }]
    });
  }

  renderMarkdown(content, targetElement = null) {
    if (!content) return '';
    
    try {
      // 预处理 Markdown
      const preprocessed = this.preprocessMarkdown(content);
      
      // 渲染为 HTML，手动处理代码高亮
      let html = marked(preprocessed);
      
      // 手动应用代码高亮
      html = this.applyCodeHighlight(html);
      
      // 隔离样式标签，防止样式冲突
      html = this.sanitizeStyles(html);
      
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
              let enhancedHtml = this.applyKeywordHighlight(html);
              // 解码HTML实体
              enhancedHtml = this.decodeHtmlEntities(enhancedHtml);
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
        
        // 立即返回基础版本（先解码HTML实体）
        return this.decodeHtmlEntities(html);
      }
      
      // 兼容性：如果没有提供目标元素，保持同步行为
      html = this.applyKeywordHighlight(html);
      
      // 解码HTML实体，确保尖括号等字符正确显示
      html = this.decodeHtmlEntities(html);
      
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
    
    // 转义HTML标签，但保护Markdown语法
    // 先保护代码块内容（```...``` 和 `...`）
    const codeBlocks = [];
    const inlineCode = [];
    
    // 保护代码块
    processed = processed.replace(/```[\s\S]*?```/g, (match) => {
      const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
      codeBlocks.push({ placeholder, original: match });
      return placeholder;
    });
    
    // 保护行内代码
    processed = processed.replace(/`[^`\n]*`/g, (match) => {
      const placeholder = `__INLINECODE_${inlineCode.length}__`;
      inlineCode.push({ placeholder, original: match });
      return placeholder;
    });
    
    // 保护引用块语法（行首的 > ，包括嵌套的 >> >>> 等）
    const blockquoteMarkers = [];
    processed = processed.replace(/^([ \t]*)(>+)(\s|$)/gm, (match, indent, markers, space) => {
      const placeholder = `__BLOCKQUOTE_${blockquoteMarkers.length}__`;
      blockquoteMarkers.push({ placeholder, original: markers });
      return `${indent}${placeholder}${space}`;
    });
    
    // 转义其他尖括号
    processed = processed.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // 恢复引用块标记
    blockquoteMarkers.forEach(({ placeholder, original }) => {
      processed = processed.replace(placeholder, original);
    });
    
    // 恢复行内代码
    inlineCode.forEach(({ placeholder, original }) => {
      processed = processed.replace(placeholder, original);
    });
    
    // 恢复代码块
    codeBlocks.forEach(({ placeholder, original }) => {
      processed = processed.replace(placeholder, original);
    });
    
    return processed;
  }

  applyCodeHighlight(html) {
    // 手动处理代码块高亮
    let result = html;
    
    // 处理有语言指定的代码块
    result = result.replace(/<pre><code class="language-(\w+)">(.*?)<\/code><\/pre>/gs, (match, lang, code) => {
      // 先解码HTML实体，再进行语法高亮
      const decodedCode = this.decodeHtmlEntities(code);
      
      if (lang && hljs.getLanguage(lang)) {
        try {
          const highlighted = hljs.highlight(decodedCode, { language: lang }).value;
          return `<pre><code class="language-${lang}">${highlighted}</code></pre>`;
        } catch (err) {
          console.error('Highlight.js error:', err);
        }
      }
      const highlighted = hljs.highlightAuto(decodedCode).value;
      return `<pre><code class="language-${lang}">${highlighted}</code></pre>`;
    });
    
    // 处理没有语言指定的代码块
    result = result.replace(/<pre><code(?![^>]*class="language-)>(.*?)<\/code><\/pre>/gs, (match, code) => {
      // 先解码HTML实体，再进行语法高亮
      const decodedCode = this.decodeHtmlEntities(code);
      const highlighted = hljs.highlightAuto(decodedCode).value;
      return `<pre><code>${highlighted}</code></pre>`;
    });
    
    return result;
  }

  sanitizeStyles(html) {
    // 由于预处理阶段已经转义了所有尖括号，这里只需要基本的清理
    // 主要工作已经在 preprocessMarkdown 中完成了
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

  decodeHtmlEntities(html) {
    // 解码常见的HTML实体，注意顺序：&amp; 必须最后解码
    return html
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")  // 单引号的命名实体
      .replace(/&#39;/g, "'")   // 单引号的数字实体
      .replace(/&amp;/g, '&');
  }

  applyKeywordHighlight(html) {
    // 完全通过插件系统处理
    if (window.pluginManager && window.pluginManager.initialized) {
      return window.pluginManager.processMarkdown(html);
    }
    
    // 如果插件系统未初始化，直接返回原始HTML
    return html;
  }

}

module.exports = MarkdownRenderer;