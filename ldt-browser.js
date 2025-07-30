/**
 * LDT Browser Adapter
 * 基于 LDT 库的浏览器适配版本
 * 简化版本，专门为 Markdown 语法高亮设计
 */

(function(window) {
  'use strict';

  // Parser - 解析器类
  function Parser(rules, i) {
    var api = this;
    var i = i ? 'i' : '';
    var parseRE = null;
    var ruleSrc = [];
    var ruleMap = {};

    api.add = function(rules) {
      for (var rule in rules) {
        var s = rules[rule].source;
        ruleSrc.push(s);
        ruleMap[rule] = new RegExp('^(' + s + ')$', i);
      }
      parseRE = new RegExp(ruleSrc.join('|'), 'g' + i);
    };

    api.tokenize = function(input) {
      return input.match(parseRE) || [];
    };

    api.identify = function(token) {
      for (var rule in ruleMap) {
        if (ruleMap[rule].test(token)) {
          return rule;
        }
      }
      return null;
    };

    if (rules) {
      api.add(rules);
    }

    return api;
  }

  // TextareaDecorator - 文本区域装饰器
  function TextareaDecorator(textarea, parser) {
    var api = this;
    var container = null;
    var output = null;
    var inputOffset = null;

    // 初始化
    function init() {
      // 保存原始样式
      var originalStyles = {
        position: textarea.style.position,
        zIndex: textarea.style.zIndex,
        background: textarea.style.background,
        margin: textarea.style.margin
      };

      // 创建容器
      container = document.createElement('div');
      container.className = 'ldt';
      container.style.position = 'relative';
      container.style.width = '100%';
      container.style.height = '100%';
      
      // 创建高亮显示层
      output = document.createElement('pre');
      output.className = 'ldt-output';
      output.style.position = 'absolute';
      output.style.top = '0';
      output.style.left = '0';
      output.style.margin = '0';
      output.style.whiteSpace = 'pre-wrap';
      output.style.wordWrap = 'break-word';
      output.style.color = 'inherit'; // 显示高亮颜色
      output.style.pointerEvents = 'none';
      output.style.zIndex = '1';
      output.style.overflow = 'hidden';
      output.style.boxSizing = 'border-box';
      
      // 设置 textarea 样式
      textarea.style.position = 'relative';
      textarea.style.zIndex = '2';
      textarea.style.background = 'transparent';
      
      // 插入到 DOM
      textarea.parentNode.insertBefore(container, textarea);
      container.appendChild(output);
      container.appendChild(textarea);
      
      // 延迟同步尺寸，等待布局完成
      setTimeout(function() {
        syncSize();
        update();
      }, 50);
      
      // 绑定事件
      textarea.addEventListener('input', update);
      textarea.addEventListener('scroll', syncScroll);
      window.addEventListener('resize', function() {
        setTimeout(syncSize, 10);
      });
      
      // 保存原始样式供销毁时恢复
      api._originalStyles = originalStyles;
    }

    // 同步尺寸
    function syncSize() {
      // 检查关键元素是否存在
      if (!output || !textarea) {
        return;
      }
      
      // 使用计算后的样式来同步尺寸
      var computedStyle = window.getComputedStyle(textarea);
      output.style.width = textarea.clientWidth + 'px';
      output.style.height = textarea.clientHeight + 'px';
      output.style.padding = computedStyle.padding;
      output.style.fontSize = computedStyle.fontSize;
      output.style.fontFamily = computedStyle.fontFamily;
      output.style.lineHeight = computedStyle.lineHeight;
    }

    // 同步滚动
    function syncScroll() {
      // 检查关键元素是否存在
      if (!output || !textarea) {
        return;
      }
      output.scrollTop = textarea.scrollTop;
      output.scrollLeft = textarea.scrollLeft;
    }

    // 更新高亮显示
    function update() {
      // 检查关键元素是否存在
      if (!output || !textarea) {
        return;
      }
      
      var input = textarea.value;
      if (!parser || !input) {
        output.innerHTML = '';
        return;
      }
      
      try {
        var tokens = parser.tokenize(input);
        var html = '';
        var lastIndex = 0;
        
        for (var i = 0; i < tokens.length; i++) {
          var token = tokens[i];
          var tokenStart = input.indexOf(token, lastIndex);
          
          // 添加未匹配的文本
          if (tokenStart > lastIndex) {
            html += escapeHtml(input.substring(lastIndex, tokenStart));
          }
          
          // 添加高亮的 token
          var className = parser.identify(token);
          if (className) {
            html += '<span class="' + className + '">' + escapeHtml(token) + '</span>';
          } else {
            html += escapeHtml(token);
          }
          
          lastIndex = tokenStart + token.length;
        }
        
        // 添加剩余文本
        if (lastIndex < input.length) {
          html += escapeHtml(input.substring(lastIndex));
        }
        
        output.innerHTML = html;
        syncSize();
        syncScroll();
        
      } catch (error) {
        console.error('LDT update error:', error);
      }
    }

    // HTML 转义
    function escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // 销毁
    api.destroy = function() {
      if (container && container.parentNode) {
        // 恢复 textarea 样式
        if (api._originalStyles) {
          textarea.style.position = api._originalStyles.position || '';
          textarea.style.zIndex = api._originalStyles.zIndex || '';
          textarea.style.background = api._originalStyles.background || '';
          textarea.style.margin = api._originalStyles.margin || '';
        }
        
        // 移除事件监听
        textarea.removeEventListener('input', update);
        textarea.removeEventListener('scroll', syncScroll);
        
        // 移除容器
        container.parentNode.insertBefore(textarea, container);
        container.parentNode.removeChild(container);
        
        // 清理引用
        container = null;
        output = null;
      }
    };

    // 手动更新
    api.update = update;

    // 初始化
    init();

    return api;
  }

  // 暴露到全局
  window.LDT_Parser = Parser;
  window.LDT_TextareaDecorator = TextareaDecorator;

})(window);