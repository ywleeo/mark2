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
    
    // 让 marked.js 自己处理HTML转义，我们只做最小化预处理
    
    return processed;
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

}

module.exports = MarkdownRenderer;