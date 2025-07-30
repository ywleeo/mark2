/**
 * Markdown 语法高亮器
 * 使用简化的 LDT 集成方案
 */

class MarkdownHighlighter {
  constructor() {
    this.textarea = null;
    this.isInitialized = false;
  }

  // 初始化高亮器 - 使用脚本标签加载的方式
  async init(textareaElement) {
    if (this.isInitialized) {
      return;
    }

    this.textarea = textareaElement;
    
    // 等待 LDT 脚本加载完成
    if (typeof window.LDT_Parser !== 'undefined' && typeof window.LDT_TextareaDecorator !== 'undefined') {
      this.setupHighlighter();
    } else {
      // 如果 LDT 还没加载，等待一下再试
      setTimeout(() => {
        if (typeof window.LDT_Parser !== 'undefined' && typeof window.LDT_TextareaDecorator !== 'undefined') {
          this.setupHighlighter();
        } else {
          console.warn('LDT 库未加载，使用普通 textarea');
        }
      }, 100);
    }
  }

  setupHighlighter() {
    try {
      // 创建 Markdown 解析器 - 使用更简单但有效的正则表达式
      const parser = new window.LDT_Parser({
        // 代码块 ``` (最高优先级)
        codeBlock: /```[\s\S]*?```/,
        
        // 代码块标记符 ``` (单独匹配三个反引号)
        codeBlockMark: /```/,
        
        // 删除线标记 ~~ (高优先级，避免被其他规则抢占)
        strikethroughMark: /~~/,
        
        // 粗体标记 ** 或 __
        boldMark: /\*\*|__/,
        
        // 标题标记 # ## ### 等 (匹配标记本身)
        headingMark: /#{1,6}/,
        
        // 水平线 --- 或 ***
        horizontalRule: /-{3,}|\*{3,}|_{3,}/,
        
        // 斜体标记 * 或 _ (简化版本)
        italicMark: /\*|_/,
        
        // 行内代码标记 `
        inlineCodeMark: /`/,
        
        // 链接标记 [ ] ( )
        linkMark: /\[|\]|\(|\)/,
        
        // 图片标记 !
        imageMark: /!/,
        
        // 引用标记 >
        blockquoteMark: />/,
        
        // 有序列表标记 1. 2. 3. (数字加点)
        orderedListMark: /\d+\./,
        
        // 无序列表标记 - * +
        unorderedListMark: /[-\*\+]/,
        
        // HTML 标签
        htmlTag: /<\/?[a-zA-Z][^>]*>/,
        
        // 空白字符
        whitespace: /\s+/,
        
        // 其他字符
        other: /\S/
      });
      
      // 创建装饰器
      this.decorator = new window.LDT_TextareaDecorator(this.textarea, parser);
      
      this.isInitialized = true;
      console.log('Markdown 语法高亮器初始化成功');
      
    } catch (error) {
      console.error('初始化 Markdown 语法高亮器失败:', error);
    }
  }

  // 更新高亮
  update() {
    if (this.decorator && this.decorator.update) {
      this.decorator.update();
    }
  }

  // 销毁高亮器
  destroy() {
    if (this.decorator && this.decorator.destroy) {
      this.decorator.destroy();
    }
    this.decorator = null;
    this.textarea = null;
    this.isInitialized = false;
  }

  // 检查是否已初始化
  isReady() {
    return this.isInitialized;
  }
}

module.exports = MarkdownHighlighter;