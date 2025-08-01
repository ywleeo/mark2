class SearchManager {
  constructor() {
    this.searchBox = null;
    this.searchInput = null;
    this.resultInfo = null;
    this.prevButton = null;
    this.nextButton = null;
    this.closeButton = null;
    this.currentMatches = [];
    this.currentIndex = -1;
    this.lastQuery = '';
    this.isVisible = false;
    this.editorView = null;
    this.searchDecorations = null;
    this.highlightEffect = null;
    this.highlightField = null;
    
    this.initCodeMirrorSearch();
    this.createSearchBox();
    this.setupEventListeners();
  }

  initCodeMirrorSearch() {
        // CodeMirror搜索API将由CodeMirrorHighlighter暴露到全局
        // 这里不需要额外的初始化
    }

    createSearchBox() {
    // 获取页面中已存在的搜索框元素
    this.searchBox = document.getElementById('searchBox');
    
    // 获取元素引用
    this.searchInput = document.getElementById('searchInput');
    this.searchResults = document.getElementById('searchResults');
    this.prevButton = document.getElementById('searchPrev');
    this.nextButton = document.getElementById('searchNext');
    this.closeButton = document.getElementById('searchClose');
  }

  setupEventListeners() {
    // 搜索输入事件
    this.searchInput.addEventListener('input', (e) => {
      this.search(e.target.value);
    });

    // 键盘事件
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          this.findPrevious();
        } else {
          this.findNext();
        }
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });

    // 按钮事件
    this.prevButton.addEventListener('click', () => this.findPrevious());
    this.nextButton.addEventListener('click', () => this.findNext());
    this.closeButton.addEventListener('click', () => this.hide());
  }

  show() {
    this.searchBox.style.display = 'block';
    this.isVisible = true;
    this.searchInput.focus();
    this.searchInput.select();
  }

  hide() {
    this.searchBox.style.display = 'none';
    this.isVisible = false;
    this.clearHighlights();
  }

  // 重置搜索框状态
  reset() {
    this.hide();
    this.searchInput.value = '';
    this.currentMatches = [];
    this.currentIndex = -1;
    this.lastQuery = '';
    this.updateResults(0, 0);
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  search(query) {
    this.clearHighlights();
    
    if (!query.trim()) {
      this.updateResults(0, 0);
      return;
    }

    // 检查是否在编辑模式
    if (this.isInEditMode()) {
      this.searchInEditor(query);
    } else {
      this.searchInPreview(query);
    }
  }

  // 检查是否在编辑模式
  isInEditMode() {
    const editorContent = document.getElementById('editorContent');
    return editorContent && editorContent.style.display !== 'none';
  }

  // 在编辑器中搜索
  searchInEditor(query) {
    
    const editorManager = window.editorManager;
    
    if (!editorManager) {
      console.log('editorManager 不存在');
      return;
    }
    
    if (!editorManager.markdownHighlighter) {
      console.log('markdownHighlighter 不存在');
      return;
    }

    const highlighter = editorManager.markdownHighlighter;
    
    if (!highlighter.isReady()) {
      console.log('highlighter 未就绪');
      return;
    }
    
    // 使用CodeMirrorHighlighter的搜索方法
    const matches = highlighter.search(query, { caseSensitive: false });
    
    // 转换匹配结果格式，添加行号信息
    this.currentMatches = matches.map(match => {
      const line = this.getLineFromIndex(highlighter.editor.state.doc.toString(), match.from);
      return {
        from: match.from,
        to: match.to,
        line: line
      };
    });
    
    // 设置当前索引
    if (this.currentMatches.length > 0) {
      this.currentIndex = 0;
    } else {
      this.currentIndex = -1;
    }

    // 应用高亮，传入当前索引以区分当前匹配项
    highlighter.highlightMatches(matches, this.currentIndex);
    
    this.updateResults(this.currentIndex + 1, this.currentMatches.length);
  }



  // 在预览模式中搜索
  searchInPreview(query) {
    // 获取所有文本节点
    const textNodes = this.getTextNodes(document.body);
    this.currentMatches = [];
    
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    textNodes.forEach(node => {
      const text = node.textContent;
      // 为每个节点创建新的正则表达式实例，避免全局状态污染
      const regex = new RegExp(escapedQuery, 'gi');
      let match;
      
      while ((match = regex.exec(text)) !== null) {
        this.currentMatches.push({
          node: node,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0]
        });
      }
    });

    // 高亮所有匹配项
    this.highlightMatches();
    
    // 跳转到第一个匹配项
    if (this.currentMatches.length > 0) {
      this.currentIndex = 0;
      this.scrollToMatch(this.currentIndex);
    } else {
      this.currentIndex = -1;
    }
    
    this.updateResults(this.currentIndex + 1, this.currentMatches.length);
  }

  // 根据字符索引获取行号
  getLineFromIndex(content, index) {
    return content.substring(0, index).split('\n').length - 1;
  }

  // 滚动到编辑器中的匹配项
  scrollToEditorMatch(index, onlyScroll = false) {
    if (index < 0 || index >= this.currentMatches.length) {
      return;
    }
    
    const match = this.currentMatches[index];
    const editorManager = window.editorManager;
    
    if (editorManager && editorManager.markdownHighlighter) {
      const highlighter = editorManager.markdownHighlighter;
      
      if (!onlyScroll) {
        // 选中匹配的文本
        highlighter.editor.dispatch({
          selection: { anchor: match.from, head: match.to }
        });
        // 聚焦编辑器
        highlighter.focus();
      }
      
      // 滚动到匹配位置
      highlighter.scrollToPosition(match.from);
    }
  }

  getTextNodes(element) {
    const textNodes = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // 跳过搜索框内的文本节点
          if (this.searchBox.contains(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          // 跳过script和style标签
          const parent = node.parentElement;
          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
            return NodeFilter.FILTER_REJECT;
          }
          return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );
    
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }
    
    return textNodes;
  }

  highlightMatches() {
    this.currentMatches.forEach((match, index) => {
      const span = document.createElement('span');
      span.className = index === this.currentIndex ? 'search-highlight current' : 'search-highlight';
      span.textContent = match.text;
      
      const range = document.createRange();
      
      // 验证节点长度，防止偏移量超出范围
      const nodeLength = match.node.textContent ? match.node.textContent.length : 0;
      const safeStart = Math.min(match.start, nodeLength);
      const safeEnd = Math.min(match.end, nodeLength);
      
      // 确保start不大于end
      const finalStart = Math.min(safeStart, safeEnd);
      const finalEnd = Math.max(safeStart, safeEnd);
      
      range.setStart(match.node, finalStart);
      range.setEnd(match.node, finalEnd);
      
      try {
        range.deleteContents();
        range.insertNode(span);
      } catch (e) {
        console.warn('Failed to highlight match:', e);
      }
    });
  }

  clearHighlights() {
        if (this.isInEditMode()) {
            // 清除编辑器高亮
            const editorManager = window.editorManager;
            if (editorManager && editorManager.markdownHighlighter) {
                editorManager.markdownHighlighter.clearSearchHighlights();
            }
        } else {
            // 清除预览模式的高亮
            const highlights = document.querySelectorAll('.search-highlight');
            highlights.forEach(highlight => {
                const parent = highlight.parentNode;
                parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
                parent.normalize();
            });
        }
    }

  findNext() {
    if (this.currentMatches.length === 0) return;
    
    this.currentIndex = (this.currentIndex + 1) % this.currentMatches.length;
    
    if (this.isInEditMode()) {
      // 重新应用高亮以更新当前匹配项样式
      const editorManager = window.editorManager;
      if (editorManager && editorManager.markdownHighlighter) {
        const matches = this.currentMatches.map(match => ({ from: match.from, to: match.to }));
        editorManager.markdownHighlighter.highlightMatches(matches, this.currentIndex);
      }
      this.scrollToEditorMatch(this.currentIndex, true); // 只滚动，不选中
    } else {
      this.updateHighlightClasses();
      this.scrollToMatch(this.currentIndex);
    }
    
    this.updateResults(this.currentIndex + 1, this.currentMatches.length);
  }

  findPrevious() {
    if (this.currentMatches.length === 0) return;
    
    this.currentIndex = this.currentIndex <= 0 ? this.currentMatches.length - 1 : this.currentIndex - 1;
    
    if (this.isInEditMode()) {
      // 重新应用高亮以更新当前匹配项样式
      const editorManager = window.editorManager;
      if (editorManager && editorManager.markdownHighlighter) {
        const matches = this.currentMatches.map(match => ({ from: match.from, to: match.to }));
        editorManager.markdownHighlighter.highlightMatches(matches, this.currentIndex);
      }
      this.scrollToEditorMatch(this.currentIndex, true); // 只滚动，不选中
    } else {
      this.updateHighlightClasses();
      this.scrollToMatch(this.currentIndex);
    }
    
    this.updateResults(this.currentIndex + 1, this.currentMatches.length);
  }

  updateHighlightClasses() {
    const highlights = document.querySelectorAll('.search-highlight');
    highlights.forEach((highlight, index) => {
      if (index === this.currentIndex) {
        highlight.classList.add('current');
      } else {
        highlight.classList.remove('current');
      }
    });
  }

  scrollToMatch(index) {
    if (index < 0 || index >= this.currentMatches.length) return;
    
    const highlights = document.querySelectorAll('.search-highlight');
    if (highlights[index]) {
      highlights[index].scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }

  updateResults(current, total) {
    if (total === 0) {
      this.searchResults.textContent = '无结果';
    } else {
      this.searchResults.textContent = `${current}/${total}`;
    }
  }
}

module.exports = SearchManager;