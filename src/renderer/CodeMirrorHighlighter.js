/**
 * CodeMirror 6 高亮器
 * 替代 LDT，提供更好的性能和稳定性
 */

// CodeMirror 6 导入
const { EditorView, minimalSetup } = require('codemirror');
const { EditorState, StateEffect, Compartment } = require('@codemirror/state');
const { markdown } = require('@codemirror/lang-markdown');
const { syntaxHighlighting, HighlightStyle, defaultHighlightStyle } = require('@codemirror/language');
const { tags } = require('@lezer/highlight');
const { SearchCursor } = require('@codemirror/search');
const { Decoration } = require('@codemirror/view');
const { keymap } = require('@codemirror/view');
const { indentWithTab } = require('@codemirror/commands');
const { indentUnit } = require('@codemirror/language');

// 语言包导入 - 用于代码块语法高亮
const { javascript } = require('@codemirror/lang-javascript');
const { python } = require('@codemirror/lang-python');
const { java } = require('@codemirror/lang-java');
const { cpp } = require('@codemirror/lang-cpp');
const { html } = require('@codemirror/lang-html');
const { css } = require('@codemirror/lang-css');
const { sql } = require('@codemirror/lang-sql');
const { json } = require('@codemirror/lang-json');
const { xml } = require('@codemirror/lang-xml');

// highlight.js 用于备用高亮
const hljs = require('highlight.js');

class CodeMirrorHighlighter {
  constructor() {
    this.editor = null;
    this.textarea = null;
    this.container = null;
    this.ready = false;
    this.themeCompartment = new Compartment(); // 创建主题compartment
    this.highlightCompartment = new Compartment(); // 创建高亮compartment
    this.searchCompartment = new Compartment(); // 创建搜索compartment
    this.searchDecorations = [];
    
    // 滚动监听相关
    this.scrollListeners = [];
    this.lastScrollTop = 0;
    
    // 暴露CodeMirror搜索API到全局
    this.exposeSearchAPI();
    
    // 语言映射，用于代码块高亮
    this.languageMap = this.initLanguageMap();
  }

  async init(textarea) {
    if (!textarea) {
      throw new Error('Textarea element is required');
    }

    this.textarea = textarea;
    
    // 创建容器
    this.container = document.createElement('div');
    this.container.className = 'codemirror-container';
    this.container.style.position = 'relative';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.overflow = 'hidden'; // 让CodeMirror自己处理滚动
    
    // 插入容器
    textarea.parentNode.insertBefore(this.container, textarea);
    
    // 隐藏原始textarea但保持其存在（用于表单提交等）
    textarea.style.display = 'none';
    
    // 创建编辑器状态
    const state = EditorState.create({
      doc: this.preprocessMarkdown(textarea.value),
      extensions: [
        // 基本扩展
        EditorView.lineWrapping,
        // 增强的 Markdown 语言支持（包含代码块高亮）
        this.createEnhancedMarkdown(),
        // 设置Tab大小为4个字符宽度
        EditorState.tabSize.of(4),
        // 设置Tab为真正的Tab字符
        indentUnit.of("\t"),
        // Tab键缩进支持
        keymap.of([indentWithTab]),
        // 先应用自定义高亮样式，再应用默认样式
        this.highlightCompartment.of([
          syntaxHighlighting(this.getCustomHighlightStyle()),
          syntaxHighlighting(defaultHighlightStyle)
        ]),
        // 搜索装饰
        this.searchCompartment.of([]),
        // 文档更新监听
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            textarea.value = update.state.doc.toString();
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }),
        // 基本主题
        this.themeCompartment.of(this.getEditorTheme()),
      ]
    });
    
    // 创建编辑器视图
    this.editor = new EditorView({
      state,
      parent: this.container,
    });
    
    // 设置焦点
    setTimeout(() => {
      this.editor.focus();
      this.ready = true;
      
      // 设置滚动监听器
      this.setupScrollListener();
    }, 100);
    
    // 监听主题变化
    this.setupThemeListener();
    
  }
  
  // 初始化语言映射
  initLanguageMap() {
    return {
      javascript: javascript,
      js: javascript,
      typescript: javascript,
      ts: javascript,
      python: python,
      py: python,
      java: java,
      cpp: cpp,
      c: cpp,
      'c++': cpp,
      html: html,
      css: css,
      sql: sql,
      json: json,
      xml: xml,
      // 添加更多语言别名
      jsx: javascript,
      tsx: javascript,
      node: javascript,
      php: javascript, // 目前用JS高亮代替
      go: cpp, // 目前用C++高亮代替
      rust: cpp, // 目前用C++高亮代替
      ruby: python, // 目前用Python高亮代替
      shell: cpp, // 目前用C++高亮代替
      bash: cpp,
      sh: cpp,
      yaml: json, // 目前用JSON高亮代替
      yml: json,
      toml: json,
      ini: json,
      conf: json
    };
  }
  
  // 创建增强的 Markdown 扩展，支持代码块语法高亮
  createEnhancedMarkdown() {
    try {
      // 使用基础 markdown 并添加代码块解析器
      return markdown({
        codeLanguages: (info) => {
          // info 是代码块的语言标识（如 'javascript', 'python' 等）
          const lang = info.toLowerCase();
          
          // 首先尝试使用 CodeMirror 语言包
          if (this.languageMap[lang]) {
            try {
              return this.languageMap[lang]().language;
            } catch (error) {
              console.warn(`CodeMirror language pack for '${lang}' failed:`, error);
            }
          }
          
          // 备用方案：返回null，让 markdown 解析器使用默认处理
          return null;
        }
      });
    } catch (error) {
      console.warn('创建增强 Markdown 解析器失败，使用基础版本:', error);
      return markdown();
    }
  }

  // 暴露搜索API到全局
  exposeSearchAPI() {
    // 确保全局CodeMirror对象存在
    if (!window.CodeMirror) {
      window.CodeMirror = {};
    }
    
    // 暴露搜索相关的类和方法
    window.CodeMirror.SearchCursor = SearchCursor;
    window.CodeMirror.StateEffect = StateEffect;
    window.CodeMirror.StateField = require('@codemirror/state').StateField;
    window.CodeMirror.Decoration = Decoration;
    window.CodeMirror.EditorView = EditorView;
    
    // 暴露当前编辑器实例的引用
    window.CodeMirror.getCurrentEditor = () => this.editor;
  }
  
  // 搜索方法
  search(query, options = {}) {
    if (!this.editor || !query) return [];
    
    const doc = this.editor.state.doc;
    const matches = [];
    const caseSensitive = options.caseSensitive || false;
    
    const cursor = new SearchCursor(
      doc,
      query,
      0,
      doc.length,
      caseSensitive ? undefined : x => x.toLowerCase()
    );
    
    while (!cursor.next().done) {
      matches.push({
        from: cursor.value.from,
        to: cursor.value.to
      });
    }
    
    return matches;
  }
  
  // 高亮搜索结果
  highlightMatches(matches, currentIndex = 0) {
    if (!this.editor || !matches.length) return;
    
    // 清除之前的高亮
    this.clearSearchHighlights();
    
    // 创建装饰，区分当前匹配项
    const decorations = matches.map((match, index) => {
      const className = index === currentIndex ? 'search-highlight current' : 'search-highlight';
      return Decoration.mark({ class: className }).range(match.from, match.to);
    });
    
    // 应用装饰 - 使用EditorView.decorations.of()正确应用装饰
    this.editor.dispatch({
      effects: this.searchCompartment.reconfigure(
        EditorView.decorations.of(Decoration.set(decorations))
      )
    });
    
    // 保存装饰引用用于清理
    this.searchDecorations = decorations;
  }
  
  // 清除搜索高亮
  clearSearchHighlights() {
    if (!this.editor) return;
    
    // 清空装饰数组
    this.searchDecorations = [];
    
    // 移除搜索高亮 - 使用空的装饰集合
    this.editor.dispatch({
      effects: this.searchCompartment.reconfigure(
        EditorView.decorations.of(Decoration.set([]))
      )
    });
  }
  
  // 滚动到指定位置
  scrollToPosition(pos) {
    if (!this.editor) return;
    
    this.editor.dispatch({
      selection: { anchor: pos, head: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' })
    });
  }
  
  // 获取自定义高亮样式，覆盖默认样式
  getCustomHighlightStyle() {
    const settings = this.getUserSettings();
    
    // 根据主题动态设置颜色
    const colors = settings.isDark ? {
      // 深色主题 - 超亮配色
      keyword: '#ff92d0',
      string: '#ffff99',
      comment: '#9aa3d6',
      number: '#ddb3ff',
      operator: '#ff92d0',
      punctuation: '#ffffff',
      variableName: '#b3f0ff',
      propertyName: '#80ff9a',
      function: '#80ff9a',
      className: '#b3f0ff',
      typeName: '#b3f0ff',
      definition: '#80ff9a',
      regexp: '#ffd699',
      escape: '#ffd699',
      special: '#ff92d0',
      meta: '#b3bfeb',
      tag: '#ff92d0',
      attributeName: '#80ff9a',
      attributeValue: '#ffff99',
      bracket: '#ffffff',
      // Markdown 元素
      heading: '#68b5df',
      strong: '#ff7373',
      emphasis: '#34d399',
      strikethrough: '#9ca3af',
      link: '#60a5fa',
      url: '#a78bfa',
      monospace: '#ffd466',
      quote: '#999',
      list: '#4fdaaf',
    } : {
      // 浅色主题 - GitHub 风格配色
      keyword: '#d73a49',
      string: '#032f62',
      comment: '#6a737d',
      number: '#005cc5',
      operator: '#d73a49',
      punctuation: '#24292e',
      variableName: '#e36209',
      propertyName: '#005cc5',
      function: '#6f42c1',
      className: '#6f42c1',
      typeName: '#6f42c1',
      definition: '#6f42c1',
      regexp: '#032f62',
      escape: '#e36209',
      special: '#d73a49',
      meta: '#6a737d',
      tag: '#22863a',
      attributeName: '#6f42c1',
      attributeValue: '#032f62',
      bracket: '#24292e',
      // Markdown 元素
      heading: '#478fb7',
      strong: '#dc2626',
      emphasis: '#059669',
      strikethrough: '#6b7280',
      link: '#2563eb',
      url: '#7c3aed',
      monospace: '#dc2626',
      quote: '#6b7280',
      list: '#4fdaaf',
    };
    
    // 使用内联样式而不是CSS类，确保主题切换生效
    return HighlightStyle.define([
      // 代码语法高亮
      { tag: tags.keyword, color: colors.keyword, fontWeight: 'bold' },
      { tag: tags.string, color: colors.string },
      { tag: tags.comment, color: colors.comment, fontStyle: 'italic' },
      { tag: tags.number, color: colors.number },
      { tag: tags.operator, color: colors.operator },
      { tag: tags.punctuation, color: colors.punctuation },
      { tag: tags.variableName, color: colors.variableName },
      { tag: tags.propertyName, color: colors.propertyName },
      { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: colors.function, fontWeight: 'bold' },
      { tag: tags.className, color: colors.className, fontWeight: 'bold' },
      { tag: tags.typeName, color: colors.typeName },
      { tag: tags.definition(tags.variableName), color: colors.definition, fontWeight: 'bold' },
      { tag: tags.regexp, color: colors.regexp },
      { tag: tags.escape, color: colors.escape },
      { tag: tags.special(tags.string), color: colors.special },
      { tag: tags.meta, color: colors.meta },
      { tag: tags.tagName, color: colors.tag },
      { tag: tags.attributeName, color: colors.attributeName },
      { tag: tags.attributeValue, color: colors.attributeValue },
      { tag: [tags.bracket, tags.squareBracket, tags.brace, tags.angleBracket], color: colors.bracket },
      
      // Markdown 语法高亮
      { tag: tags.heading1, color: colors.heading, fontWeight: 'bold', fontSize: '1.5em' },
      { tag: tags.heading2, color: colors.heading, fontWeight: 'bold', fontSize: '1.3em' },
      { tag: tags.heading3, color: colors.heading, fontWeight: 'bold', fontSize: '1.1em' },
      { tag: tags.heading4, color: colors.heading, fontWeight: 'bold' },
      { tag: tags.heading5, color: colors.heading, fontWeight: 'bold' },
      { tag: tags.heading6, color: colors.heading, fontWeight: 'bold' },
      { tag: tags.strong, color: colors.strong, fontWeight: 'bold' },
      { tag: tags.emphasis, color: colors.emphasis, fontStyle: 'italic' },
      { tag: tags.strikethrough, color: colors.strikethrough, textDecoration: 'line-through' },
      { tag: tags.link, color: colors.link, textDecoration: 'underline' },
      { tag: tags.url, color: colors.url },
      { tag: tags.monospace, color: colors.monospace, backgroundColor: settings.isDark ? '#2d2d2d' : '#f3f4f6', padding: '2px 4px', borderRadius: '3px' },
      { tag: tags.quote, color: colors.quote, fontStyle: 'italic' },
      { tag: tags.list, color: colors.list },
      { tag: tags.contentSeparator, color: colors.list, fontWeight: 'bold', opacity: '0.7' },
    ]);
  }
  
  // 获取编辑器主题 - 应用用户设置和应用主题
  getEditorTheme() {
    // 获取用户设置
    const settings = this.getUserSettings();
    
    // 在容器上设置主题标识，让CSS能够识别
    if (this.container) {
      if (settings.isDark) {
        this.container.setAttribute('data-theme', 'dark');
      } else {
        this.container.removeAttribute('data-theme');
      }
    }
    
    return EditorView.theme({
      '&': {
        fontSize: settings.fontSize + 'px',
        fontFamily: settings.fontFamily,
        lineHeight: settings.lineHeight,
        letterSpacing: settings.letterSpacing + 'px',
        height: '100%',
        backgroundColor: settings.isDark ? '#1a1a1a' : '#f5f5f5',
        color: settings.isDark ? '#e0e0e0' : '#333',
      },
      '.cm-content': {
        padding: '16px',
        minHeight: '100%',
        caretColor: settings.isDark ? '#e0e0e0' : '#333',
      },
      '.cm-focused': {
        outline: 'none',
      },
      '.cm-editor': {
        height: '100%',
        maxHeight: '100%',
      },
      '.cm-scroller': {
        fontFamily: 'inherit',
        height: '100%',
        maxHeight: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: settings.isDark ? '#e0e0e0' : '#333',
      },
    });
  }
  
  // 获取用户设置
  getUserSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem('appSettings') || '{}');
      
      // 通过检查当前加载的CSS文件来判断主题
      let isDark = false;
      const themeCSS = document.getElementById('theme-css');
      if (themeCSS && themeCSS.href) {
        isDark = themeCSS.href.includes('dark-theme.css');
      }
      
      // 备用方案：检查localStorage
      if (!isDark) {
        isDark = localStorage.getItem('theme') === 'dark';
      }
      
      // console.log('主题检测:', {
      //   'themeCSS.href': themeCSS ? themeCSS.href : 'not found',
      //   'localStorage.theme': localStorage.getItem('theme'),
      //   'isDark': isDark
      // });
      
      return {
        fontSize: settings.fontSize || 14,
        fontFamily: settings.fontFamily || '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace',
        lineHeight: settings.lineHeight || 1.6,
        letterSpacing: settings.letterSpacing || 0,
        isDark: isDark
      };
    } catch (error) {
      console.warn('获取设置失败，使用默认值:', error);
      return {
        fontSize: 14,
        fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace',
        lineHeight: 1.6,
        letterSpacing: 0,
        isDark: false
      };
    }
  }
  
  // 预处理Markdown内容，避免setext标题误识别
  preprocessMarkdown(content) {
    if (!content) return content;
    
    let processed = content;
    
    // 匹配 文本\n--- 的模式，将其转换为 文本\n\n---
    // 避免 CodeMirror Markdown 解析器将前面的文本识别为标题
    processed = processed.replace(/^(.+)\n(-{3,})$/gm, (match, text, dashes) => {
      return `${text}\n\n${dashes}`;
    });
    
    // 对 = 号也做同样处理
    processed = processed.replace(/^(.+)\n(={3,})$/gm, (match, text, equals) => {
      return `${text}\n\n${equals}`;
    });
    
    return processed;
  }

  // 更新内容
  setValue(content) {
    if (!this.editor) return;
    
    // 预处理内容，避免setext标题问题
    const processedContent = this.preprocessMarkdown(content);
    
    const transaction = this.editor.state.update({
      changes: {
        from: 0,
        to: this.editor.state.doc.length,
        insert: processedContent,
      },
    });
    
    this.editor.dispatch(transaction);
  }
  
  // 获取内容
  getValue() {
    return this.editor ? this.editor.state.doc.toString() : '';
  }
  
  // 设置焦点
  focus() {
    if (this.editor) {
      this.editor.focus();
    }
  }
  
  // 获取滚动位置
  getScrollInfo() {
    if (!this.editor) return { top: 0, left: 0, height: 0, clientHeight: 0 };
    
    const scrollDOM = this.editor.scrollDOM;
    return {
      top: scrollDOM.scrollTop,
      left: scrollDOM.scrollLeft,
      height: scrollDOM.scrollHeight,
      clientHeight: scrollDOM.clientHeight,
    };
  }
  
  // 设置滚动位置
  scrollTo(top, left = 0) {
    if (!this.editor) return;
    
    const scrollDOM = this.editor.scrollDOM;
    scrollDOM.scrollTop = Math.max(0, top);
    scrollDOM.scrollLeft = Math.max(0, left);
  }
  
  // 设置滚动监听器
  setupScrollListener() {
    if (!this.editor) return;
    
    const scrollDOM = this.editor.scrollDOM;
    
    const handleScroll = (event) => {
      const currentScrollTop = scrollDOM.scrollTop;
      
      // 只有滚动位置真正变化时才通知监听器
      if (currentScrollTop !== this.lastScrollTop) {
        this.lastScrollTop = currentScrollTop;
        
        // 调用所有注册的滚动监听器
        this.scrollListeners.forEach(listener => {
          try {
            listener({
              top: currentScrollTop,
              left: scrollDOM.scrollLeft,
              height: scrollDOM.scrollHeight,
              clientHeight: scrollDOM.clientHeight
            });
          } catch (error) {
            console.warn('滚动监听器执行失败:', error);
          }
        });
      }
    };
    
    // 添加滚动事件监听器
    scrollDOM.addEventListener('scroll', handleScroll);
    
    // 保存移除函数以便销毁时清理
    this.removeScrollListener = () => {
      scrollDOM.removeEventListener('scroll', handleScroll);
    };
  }
  
  // 添加滚动监听器
  onScroll(callback) {
    if (typeof callback === 'function') {
      this.scrollListeners.push(callback);
    }
  }
  
  // 移除滚动监听器
  offScroll(callback) {
    const index = this.scrollListeners.indexOf(callback);
    if (index > -1) {
      this.scrollListeners.splice(index, 1);
    }
  }
  
  // 清除所有滚动监听器
  clearScrollListeners() {
    this.scrollListeners = [];
  }
  
  // 获取滚动容器（用于EditorManager的滚动同步）
  getScrollContainer() {
    return this.editor ? this.editor.scrollDOM : null;
  }
  
  // 滚动到行
  scrollToLine(line) {
    if (!this.editor) return;
    
    try {
      const pos = this.editor.state.doc.line(line + 1).from;
      this.editor.dispatch({
        effects: EditorView.scrollIntoView(pos),
      });
    } catch (error) {
      console.warn('无法滚动到指定行:', line, error);
    }
  }
  
  // 检查是否就绪
  isReady() {
    return this.ready && this.editor !== null;
  }
  
  // 销毁编辑器
  destroy() {
    // 清理主题监听器
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }
    
    // 清理滚动监听器
    if (this.removeScrollListener) {
      this.removeScrollListener();
      this.removeScrollListener = null;
    }
    this.clearScrollListeners();
    
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    
    if (this.container && this.container.parentNode) {
      // 显示原始textarea
      if (this.textarea) {
        this.textarea.style.display = '';
      }
      
      // 移除容器
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
    
    this.textarea = null;
    this.ready = false;
    
  }
  
  // 设置主题监听器
  setupThemeListener() {
    const themeCSS = document.getElementById('theme-css');
    if (!themeCSS) return;
    
    // 监听CSS文件的href属性变化
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
          // 延迟一点时间让CSS加载完成
          setTimeout(() => {
            this.updateTheme();
          }, 100);
        }
      });
    });
    
    // 监听theme-css元素的href属性变化
    observer.observe(themeCSS, {
      attributes: true,
      attributeFilter: ['href']
    });
    
    // 保存observer引用以便销毁时清理
    this.themeObserver = observer;
  }
  
  // 更新主题 - 使用compartment实现快速切换
  updateTheme() {
    if (!this.editor || !this.themeCompartment || !this.highlightCompartment) return;
    
    try {
      // 同时更新主题和高亮样式compartment，实现丝滑的主题切换
      const newTheme = this.getEditorTheme();
      const newHighlight = [
        syntaxHighlighting(this.getCustomHighlightStyle()),
        syntaxHighlighting(defaultHighlightStyle)
      ];
      this.editor.dispatch({
        effects: [
          this.themeCompartment.reconfigure(newTheme),
          this.highlightCompartment.reconfigure(newHighlight)
        ]
      });
    } catch (error) {
      console.warn('CodeMirror 主题更新失败:', error);
    }
  }
}

module.exports = CodeMirrorHighlighter;