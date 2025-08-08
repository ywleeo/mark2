const { marked } = require('marked');
const hljs = require('highlight.js');

class MarkdownRenderer {
  constructor() {
    this.keywordHighlightEnabled = true;
    this.setupMarked();
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

  renderMarkdown(content) {
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
      
      // 应用关键词高亮
      if (this.keywordHighlightEnabled) {
        html = this.applyKeywordHighlight(html);
      }
      
      return html;
    } catch (error) {
      console.error('Markdown rendering error:', error);
      return '<p>渲染错误</p>';
    }
  }

  preprocessMarkdown(content) {
    // 将可能被误判为 setext 标题的模式转换为安全格式
    let processed = content;
    
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
    
    // 简单粗暴的解决方案：转义所有尖括号，防止HTML标签被执行
    processed = processed.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    return processed;
  }

  applyCodeHighlight(html) {
    // 手动处理代码块高亮
    return html.replace(/<pre><code class="language-(\w+)">(.*?)<\/code><\/pre>/gs, (match, lang, code) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          const highlighted = hljs.highlight(code, { language: lang }).value;
          return `<pre><code class="language-${lang}">${highlighted}</code></pre>`;
        } catch (err) {
          console.error('Highlight.js error:', err);
        }
      }
      const highlighted = hljs.highlightAuto(code).value;
      return `<pre><code>${highlighted}</code></pre>`;
    });
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

  applyKeywordHighlight(html) {
    
    // 使用新的 KeywordHighlighter 系统
    if (window.keywordHighlighter) {
      const result = window.keywordHighlighter.highlight(html);
      return result;
    }
    
    // 降级处理：如果 KeywordHighlighter 不可用，使用简单的高亮
    const keywords = [
      'TODO', 'FIXME', 'NOTE', 'IMPORTANT', 'WARNING', 'DEPRECATED',
      '重要', '注意', '警告', '待办', '修复', '已弃用'
    ];
    
    let highlightedHtml = html;
    
    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
      highlightedHtml = highlightedHtml.replace(regex, 
        `<mark class="highlight-keyword">${keyword}</mark>`);
    });
    
    return highlightedHtml;
  }

  setKeywordHighlight(enabled) {
    this.keywordHighlightEnabled = enabled;
  }

  isKeywordHighlightEnabled() {
    return this.keywordHighlightEnabled;
  }
}

module.exports = MarkdownRenderer;