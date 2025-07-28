class SearchManager {
  constructor() {
    this.isSearchVisible = false;
    this.currentMatches = [];
    this.currentMatchIndex = -1;
    this.lastSearchTerm = '';
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
      searchInput.addEventListener('input', (event) => {
        this.performSearch(event.target.value);
      });

      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (event.shiftKey) {
            this.navigateToPrevious();
          } else {
            this.navigateToNext();
          }
        } else if (event.key === 'Escape') {
          this.hideSearch();
        }
      });
    }

    if (searchPrev) {
      searchPrev.addEventListener('click', () => this.navigateToPrevious());
    }

    if (searchNext) {
      searchNext.addEventListener('click', () => this.navigateToNext());
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

    this.clearSearchResults();
  }

  performSearch(searchTerm) {
    this.currentSearchTerm = searchTerm.trim();
    
    if (!this.currentSearchTerm) {
      this.clearSearchResults();
      return;
    }

    const preview = document.getElementById('markdownContent');
    if (!preview) return;

    // 清除之前的高亮
    this.clearSearchResults();

    // 执行搜索
    this.searchResults = this.findTextInElement(preview, this.currentSearchTerm);
    this.currentResultIndex = this.searchResults.length > 0 ? 0 : -1;

    // 高亮搜索结果
    this.highlightSearchResults();
    this.updateSearchCounter();

    // 滚动到第一个结果
    if (this.searchResults.length > 0) {
      this.scrollToResult(0);
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
    this.searchResults.forEach((result, index) => {
      const { node, start, end } = result;
      const text = node.textContent;
      
      // 创建高亮元素
      const beforeText = text.substring(0, start);
      const matchText = text.substring(start, end);
      const afterText = text.substring(end);

      const highlightSpan = document.createElement('span');
      highlightSpan.className = `search-highlight ${index === this.currentResultIndex ? 'current' : ''}`;
      highlightSpan.textContent = matchText;
      highlightSpan.dataset.searchIndex = index;

      // 替换文本节点
      const parent = node.parentNode;
      const fragment = document.createDocumentFragment();
      
      if (beforeText) {
        fragment.appendChild(document.createTextNode(beforeText));
      }
      fragment.appendChild(highlightSpan);
      if (afterText) {
        fragment.appendChild(document.createTextNode(afterText));
      }

      parent.replaceChild(fragment, node);
    });
  }

  clearSearchResults() {
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
    this.updateCurrentHighlight();
    this.scrollToResult(this.currentResultIndex);
    this.updateSearchCounter();
  }

  navigateToPrevious() {
    if (this.searchResults.length === 0) return;

    this.currentResultIndex = this.currentResultIndex <= 0 ? 
      this.searchResults.length - 1 : this.currentResultIndex - 1;
    this.updateCurrentHighlight();
    this.scrollToResult(this.currentResultIndex);
    this.updateSearchCounter();
  }

  updateCurrentHighlight() {
    const highlights = document.querySelectorAll('.search-highlight');
    highlights.forEach((highlight, index) => {
      if (highlight && highlight.classList) {
        if (index === this.currentResultIndex) {
          highlight.classList.add('current');
        } else {
          highlight.classList.remove('current');
        }
      }
    });
  }

  scrollToResult(index) {
    const highlight = document.querySelector(`[data-search-index="${index}"]`);
    if (highlight) {
      highlight.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }

  updateSearchCounter() {
    const counter = document.getElementById('searchCounter');
    if (counter) {
      if (this.searchResults.length === 0) {
        counter.textContent = '0/0';
      } else {
        counter.textContent = `${this.currentResultIndex + 1}/${this.searchResults.length}`;
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
}

module.exports = SearchManager;