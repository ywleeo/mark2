const { marked } = require('marked');
const hljs = require('highlight.js');

class MarkdownRenderer {
  constructor() {
    this.keywordHighlightEnabled = true;
    this.setupMarked();
  }

  setupMarked() {
    // 配置 marked - 移除弃用的参数
    marked.setOptions({
      breaks: true,
      gfm: true,
      mangle: false,
      headerIds: false
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

  applyKeywordHighlight(html) {
    const keywords = [
      'TODO', 'FIXME', 'NOTE', 'IMPORTANT', 'WARNING', 'DEPRECATED',
      '重要', '注意', '警告', '待办', '修复', '已弃用'
    ];
    
    let highlightedHtml = html;
    
    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
      highlightedHtml = highlightedHtml.replace(regex, 
        `<span class="keyword-highlight">${keyword}</span>`);
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