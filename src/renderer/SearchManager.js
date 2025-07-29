class SearchManager {
  constructor() {
    this.isSearchVisible = false;
    this.currentMatches = [];
    this.currentMatchIndex = -1;
    this.lastSearchTerm = '';
    // 初始化搜索相关的属性
    this.searchResults = [];
    this.currentResultIndex = -1;
    this.currentSearchTerm = '';
    this.setupSearchElements();
  }

  setupSearchElements() {
    // 创建搜索栏HTML结构
    this.createSearchBar();
    this.attachSearchEvents();
  }

  createSearchBar() {
    const existingSearchBar = document.getElementById('searchBar');
    if (existingSearchBar) return;

    const searchBarHtml = `
      <div id="searchBar" class="search-bar" style="display: none;">
        <div class="search-container">
          <input type="text" id="searchInput" placeholder="搜索..." />
          <div class="search-controls">
            <button id="searchPrevBtn" title="上一个">↑</button>
            <button id="searchNextBtn" title="下一个">↓</button>
            <span id="searchCounter">0/0</span>
            <button id="searchCloseBtn" title="关闭">×</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', searchBarHtml);
  }

  attachSearchEvents() {
    const searchInput = document.getElementById('searchInput');
    const searchPrev = document.getElementById('searchPrevBtn');
    const searchNext = document.getElementById('searchNextBtn');
    const searchClose = document.getElementById('searchCloseBtn');

    if (searchInput) {
      // 移除 input 事件监听，只在用户完成输入后搜索
      
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const searchTerm = event.target.value.trim();
          
          if (searchTerm) {
            if (event.shiftKey) {
              // Shift+Enter: 如果已有搜索结果则上一个，否则开始搜索
              if (this.searchResults.length > 0) {
                this.navigateToPrevious();
              } else {
                this.performSearch(searchTerm);
              }
            } else {
              // Enter: 如果已有搜索结果则下一个，否则开始搜索
              if (this.searchResults.length > 0 && this.currentSearchTerm === searchTerm) {
                this.navigateToNext();
              } else {
                this.performSearch(searchTerm);
              }
            }
          }
        } else if (event.key === 'Escape') {
          this.hideSearch();
        }
      });
    }

    if (searchPrev) {
      searchPrev.addEventListener('click', () => {
        const searchInput = document.getElementById('searchInput');
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        
        if (searchTerm && this.searchResults.length > 0) {
          this.navigateToPrevious();
        } else if (searchTerm) {
          this.performSearch(searchTerm);
        }
      });
    }

    if (searchNext) {
      searchNext.addEventListener('click', () => {
        const searchInput = document.getElementById('searchInput');
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        
        if (searchTerm && this.searchResults.length > 0) {
          this.navigateToNext();
        } else if (searchTerm) {
          this.performSearch(searchTerm);
        }
      });
    }

    if (searchClose) {
      searchClose.addEventListener('click', () => this.hideSearch());
    }

    // 全局快捷键
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        this.showSearch();
      }
    });
  }

  showSearch() {
    const searchBar = document.getElementById('searchBar');
    const searchInput = document.getElementById('searchInput');

    if (searchBar) {
      searchBar.style.display = 'block';
      this.isSearchVisible = true;
    }

    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  hideSearch() {
    const searchBar = document.getElementById('searchBar');
    const searchInput = document.getElementById('searchInput');

    if (searchBar) {
      searchBar.style.display = 'none';
      this.isSearchVisible = false;
    }

    if (searchInput) {
      searchInput.value = '';
    }

    // 清除搜索结果和状态
    this.clearSearchResults();
    this.currentSearchTerm = '';
  }

  performSearch(searchTerm) {
    this.currentSearchTerm = searchTerm.trim();
    
    if (!this.currentSearchTerm) {
      this.clearSearchResults();
      return;
    }

    // 检查是否在编辑模式
    const editorElement = document.getElementById('editorTextarea');
    const isEditMode = editorElement && editorElement.offsetParent !== null;
    
    if (isEditMode) {
      // 编辑模式：使用编辑器内的文本搜索
      this.searchInEditor(editorElement);
    } else {
      // 预览模式：使用DOM搜索
      this.searchInPreview();
    }
  }

  searchInPreview() {
    // 清除之前的搜索
    this.clearSearchResults();
    
    // 回到简单可靠的实现：使用DOM搜索但简化逻辑
    const previewElement = document.getElementById('markdownContent');
    if (!previewElement) return;
    
    // 搜索所有匹配项
    this.searchResults = this.findTextInElement(previewElement, this.currentSearchTerm);
    this.currentResultIndex = this.searchResults.length > 0 ? 0 : -1;
    
    // 高亮所有匹配项
    this.highlightSearchResults();
    
    // 滚动到第一个结果
    if (this.searchResults.length > 0) {
      this.scrollToCurrentResult();
    }
    
    this.updateSearchCounter();
  }

  searchInEditor(editorElement) {
    const text = editorElement.value;
    const searchTerm = this.currentSearchTerm;
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    
    this.searchResults = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      this.searchResults.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
    }
    
    this.currentResultIndex = this.searchResults.length > 0 ? 0 : -1;
    this.updateSearchCounter();
    
    // 高亮第一个结果
    if (this.searchResults.length > 0) {
      this.highlightInEditor(editorElement);
    }
  }

  findTextInElement(element, searchTerm) {
    const results = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent;
      const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let match;

      while ((match = regex.exec(text)) !== null) {
        results.push({
          node: node,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0]
        });
      }
    }

    return results;
  }

  highlightSearchResults() {
    // 按节点分组处理，避免同一节点多次替换的问题
    const nodeGroups = new Map();
    
    // 将搜索结果按节点分组
    this.searchResults.forEach((result, index) => {
      const { node } = result;
      if (!nodeGroups.has(node)) {
        nodeGroups.set(node, []);
      }
      nodeGroups.get(node).push({ ...result, originalIndex: index });
    });
    
    // 对每个节点进行处理
    nodeGroups.forEach((matches, node) => {
      if (!node.parentNode) return;
      
      const text = node.textContent;
      const fragment = document.createDocumentFragment();
      let lastEnd = 0;
      
      // 按位置排序，从前往后处理
      matches.sort((a, b) => a.start - b.start);
      
      matches.forEach(match => {
        const { start, end, originalIndex } = match;
        
        // 添加匹配前的文本
        if (start > lastEnd) {
          fragment.appendChild(document.createTextNode(text.substring(lastEnd, start)));
        }
        
        // 创建高亮元素
        const highlightSpan = document.createElement('span');
        highlightSpan.className = `search-highlight ${originalIndex === this.currentResultIndex ? 'current' : ''}`;
        highlightSpan.textContent = text.substring(start, end);
        highlightSpan.dataset.searchIndex = originalIndex;
        fragment.appendChild(highlightSpan);
        
        lastEnd = end;
      });
      
      // 添加最后剩余的文本
      if (lastEnd < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastEnd)));
      }
      
      // 替换原节点
      node.parentNode.replaceChild(fragment, node);
    });
  }

  scrollToCurrentResult() {
    const highlight = document.querySelector(`[data-search-index="${this.currentResultIndex}"]`);
    if (highlight) {
      highlight.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }


  highlightInEditor(editorElement) {
    // 在编辑器中高亮搜索结果
    if (this.searchResults.length === 0) return;
    
    // 清除之前的选择
    editorElement.setSelectionRange(0, 0);
    
    // 高亮当前匹配项
    if (this.currentResultIndex >= 0 && this.currentResultIndex < this.searchResults.length) {
      const result = this.searchResults[this.currentResultIndex];
      const textContent = editorElement.value;
      
      let actualStart = 0;
      let actualEnd = 0;
      
      // 需要计算实际在编辑器中的位置
      let currentIndex = 0;
      for (let i = 0; i < this.searchResults.length; i++) {
        const searchResult = this.searchResults[i];
        const searchIndex = textContent.indexOf(searchResult.text, currentIndex);
        if (i === this.currentResultIndex) {
          actualStart = searchIndex;
          actualEnd = searchIndex + searchResult.text.length;
          break;
        }
        currentIndex = searchIndex + searchResult.text.length;
      }
      
      // 使用更简单的方法：搜索匹配的文本位置
      const searchTerm = this.currentSearchTerm;
      const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let match;
      let matches = [];
      
      while ((match = regex.exec(textContent)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length
        });
      }
      
      if (matches.length > 0 && this.currentResultIndex < matches.length) {
        const currentMatch = matches[this.currentResultIndex];
        editorElement.focus();
        editorElement.setSelectionRange(currentMatch.start, currentMatch.end);
        
        // 滚动到选中位置
        const lines = textContent.substring(0, currentMatch.start).split('\n');
        const lineNumber = lines.length;
        const lineHeight = 20; // 假定行高
        const scrollTop = (lineNumber - 5) * lineHeight; // 留一些上下文
        editorElement.scrollTop = Math.max(0, scrollTop);
      }
    }
  }

  clearSearchResults() {
    // 清除浏览器原生搜索的选中状态
    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }

    // 清除编辑器选择
    const editorElement = document.getElementById('editorTextarea');
    if (editorElement) {
      editorElement.setSelectionRange(0, 0);
    }

    // 清除自定义高亮（如果有的话）
    const highlights = document.querySelectorAll('.search-highlight');
    highlights.forEach(highlight => {
      const parent = highlight.parentNode;
      parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
      parent.normalize();
    });

    this.searchResults = [];
    this.currentResultIndex = -1;
    this.updateSearchCounter();
  }

  navigateToNext() {
    if (this.searchResults.length === 0) return;

    this.currentResultIndex = (this.currentResultIndex + 1) % this.searchResults.length;
    
    // 检查是否在编辑模式
    const editorElement = document.getElementById('editorTextarea');
    const isEditMode = editorElement && editorElement.offsetParent !== null;
    
    if (isEditMode) {
      this.highlightInEditor(editorElement);
    } else {
      // 预览模式：更新高亮并滚动
      this.updateCurrentHighlight();
      this.scrollToCurrentResult();
    }
    
    this.updateSearchCounter();
  }

  navigateToPrevious() {
    if (this.searchResults.length === 0) return;

    this.currentResultIndex = this.currentResultIndex <= 0 ? 
      this.searchResults.length - 1 : this.currentResultIndex - 1;
    
    // 检查是否在编辑模式
    const editorElement = document.getElementById('editorTextarea');
    const isEditMode = editorElement && editorElement.offsetParent !== null;
    
    if (isEditMode) {
      this.highlightInEditor(editorElement);
    } else {
      // 预览模式：更新高亮并滚动
      this.updateCurrentHighlight();
      this.scrollToCurrentResult();
    }
    
    this.updateSearchCounter();
  }

  updateCurrentHighlight() {
    const highlights = document.querySelectorAll('.search-highlight');
    highlights.forEach((highlight, index) => {
      if (parseInt(highlight.dataset.searchIndex) === this.currentResultIndex) {
        highlight.classList.add('current');
      } else {
        highlight.classList.remove('current');
      }
    });
  }



  updateSearchCounter() {
    const counter = document.getElementById('searchCounter');
    if (counter) {
      if (!this.searchResults || this.searchResults.length === 0) {
        counter.textContent = '0/0';
      } else {
        const currentIndex = Math.max(0, this.currentResultIndex);
        counter.textContent = `${currentIndex + 1}/${this.searchResults.length}`;
      }
    }
  }

  isVisible() {
    return this.isSearchVisible;
  }

  getCurrentSearchTerm() {
    return this.currentSearchTerm;
  }

  getResultsCount() {
    return this.searchResults.length;
  }

  // 重新应用搜索高亮（用于内容更新后恢复搜索状态）
  reapplySearch() {
    if (this.currentSearchTerm && this.isSearchVisible) {
      // 延迟执行，确保DOM更新完成
      setTimeout(() => {
        // 保存当前的搜索索引
        const savedIndex = this.currentResultIndex;
        // 检查是否在编辑模式（如果是，则不需要重新应用预览模式的搜索）
        const editorElement = document.getElementById('editorTextarea');
        const isEditMode = editorElement && editorElement.offsetParent !== null;
        
        if (!isEditMode) {
          // 只在预览模式下重新应用搜索
          this.searchInPreview();
          // 尝试恢复之前的索引位置
          if (savedIndex >= 0 && savedIndex < this.searchResults.length) {
            this.currentResultIndex = savedIndex;
            this.updateCurrentHighlight();
            this.scrollToCurrentResult();
            this.updateSearchCounter();
          }
        }
      }, 50); // 短暂延迟确保DOM渲染完成
    }
  }
}

module.exports = SearchManager;