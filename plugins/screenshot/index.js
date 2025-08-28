const BasePlugin = require('../BasePlugin');
const html2canvas = require('html2canvas');

class ScreenshotPlugin extends BasePlugin {
  constructor(pluginConfig = {}) {
    super(pluginConfig);
    this.name = pluginConfig.displayName || '截图插件';
  }

  async init() {
    await super.init();
    console.log('ScreenshotPlugin (html2canvas) 初始化完成');
  }

  async destroy() {
    console.log('ScreenshotPlugin 正在销毁...');
    await super.destroy();
  }

  // 主要截图方法
  async takeScreenshot() {
    try {
      console.log('=== html2canvas 截图功能触发 ===');
      console.log('插件状态:', { 
        enabled: this.enabled, 
        initialized: this.initialized,
        isActive: this.isActive()
      });
      
      // 检查插件是否激活
      if (!this.isActive()) {
        console.warn('截图插件未激活');
        this.showNotification('截图插件未激活', 'error');
        return;
      }
      
      // 检查是否有活动内容
      const activeContent = this.getActiveContent();
      console.log('活动内容区域:', activeContent);
      if (!activeContent) {
        this.showNotification('没有可截图的内容', 'error');
        return;
      }

      // 显示进度提示
      this.showNotification('正在截图...', 'info');

      // 使用 html2canvas 进行截图（DOM水印模式）
      const result = await this.captureWithDOMWatermark(activeContent);
      
      if (result.success) {
        this.showNotification('截图已保存并复制到剪切板', 'success');
        console.log('html2canvas 截图成功完成，文件路径:', result.filePath);
      } else if (result.canceled) {
        this.showNotification('截图已取消', 'info');
        console.log('用户取消了截图保存');
      } else {
        this.showNotification(`截图失败: ${result.error}`, 'error');
        console.error('html2canvas 截图失败:', result.error);
      }
    } catch (error) {
      console.error('截图过程出错:', error);
      this.showNotification(`截图失败: ${error.message}`, 'error');
    }
  }

  // 使用DOM水印方式截图
  async captureWithDOMWatermark(element) {
    let watermarkElement = null;
    let originalPosition = null;
    try {
      console.log('=== 开始 DOM水印截图 ===');
      
      // 1. 确保element有相对定位，然后创建DOM水印
      originalPosition = element.style.position;
      element.style.position = 'relative'; // 确保作为定位参考点
      
      watermarkElement = this.createDOMWatermark();
      element.appendChild(watermarkElement);
      console.log('DOM水印已添加');
      
      // 2. 进行截图
      const result = await this.captureWithHtml2Canvas(element);
      
      return result;
      
    } catch (error) {
      console.error('DOM水印截图失败:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      // 3. 确保移除DOM水印并恢复原始样式
      if (watermarkElement && watermarkElement.parentNode) {
        const parent = watermarkElement.parentNode;
        parent.removeChild(watermarkElement);
        console.log('DOM水印已移除');
      }
      // 恢复原始position样式
      if (element) {
        if (originalPosition) {
          element.style.position = originalPosition;
        } else {
          element.style.position = '';
        }
      }
    }
  }
  
  // 创建DOM水印元素
  createDOMWatermark() {
    const watermarkElement = document.createElement('div');
    watermarkElement.style.cssText = `
      position: absolute;
      bottom: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: red;
      color: white;
      padding: 4px 8px;
      font: bold 10px Arial;
      pointer-events: none;
      z-index: 9999;
    `;
    watermarkElement.textContent = '# <MARK2> #';
    watermarkElement.className = 'screenshot-watermark';
    return watermarkElement;
  }

  // 使用 html2canvas 进行截图
  async captureWithHtml2Canvas(element) {
    try {
      console.log('=== 开始 html2canvas 截图 ===');
      
      const startTime = Date.now();
      
      // 获取元素信息
      const rect = element.getBoundingClientRect();
      const scrollWidth = element.scrollWidth;
      const scrollHeight = element.scrollHeight;
      
      console.log('元素信息:', {
        visible: { width: rect.width, height: rect.height },
        scroll: { width: scrollWidth, height: scrollHeight }
      });

      // 动态获取背景色
      const backgroundColor = this.getElementBackgroundColor(element);
      console.log('检测到的背景色:', backgroundColor);

      // 配置 html2canvas 选项
      const options = {
        allowTaint: true,
        useCORS: true,
        backgroundColor: backgroundColor,
        width: scrollWidth,
        height: scrollHeight,
        scale: this.config.configuration?.pixelRatio || 2,
        scrollX: 0,
        scrollY: 0,
        logging: false, // 减少控制台输出
        imageTimeout: 10000, // 图片加载超时时间
        removeContainer: true, // 自动清理临时容器
        ignoreElements: (element) => {
          // 忽略通知元素和不需要的元素
          if (element.classList && element.classList.contains('screenshot-notification')) {
            return true;
          }
          if (element.tagName === 'SCRIPT') {
            return true;
          }
          return false;
        },
        onclone: (clonedDoc, element) => {
          // 在克隆文档中进行一些预处理
          console.log('html2canvas 正在克隆文档...');
          
          // 处理可能的样式问题
          const clonedElement = clonedDoc.querySelector(element.tagName.toLowerCase() + 
            (element.className ? '.' + element.className.split(' ').join('.') : ''));
          
          if (clonedElement) {
            // 确保滚动区域正确显示
            clonedElement.style.overflow = 'visible';
            clonedElement.style.height = scrollHeight + 'px';
            clonedElement.style.width = scrollWidth + 'px';
          }
        }
      };

      console.log('html2canvas 配置:', options);
      console.log('开始调用 html2canvas...');
      
      // 生成截图
      const canvas = await html2canvas(element, options);
      
      const duration = Date.now() - startTime;
      console.log(`html2canvas 截图完成，耗时: ${duration}ms`);
      console.log('生成的 canvas 尺寸:', { width: canvas.width, height: canvas.height });
      
      // 转换为 Blob
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png', this.config.configuration?.quality || 0.95);
      });
      
      if (!blob) {
        throw new Error('生成截图失败：无法转换为 Blob');
      }
      
      console.log(`截图文件大小: ${Math.round(blob.size / 1024)}KB`);
      
      // 直接保存到剪切板和临时文件（DOM水印已经在截图中）
      const clipboardResult = await this.saveToClipboardAndFile(blob);
      
      return {
        success: clipboardResult.success,
        duration: duration,
        size: blob.size,
        filePath: clipboardResult.filePath,
        error: clipboardResult.error
      };
      
    } catch (error) {
      console.error('html2canvas 截图失败:', error);
      return {
        success: false,
        error: error.message || '截图过程中发生未知错误'
      };
    }
  }

  // 在 Canvas 上添加水印
  async addWatermarkToCanvas(canvas, originalSize = {}) {
    console.log('在 Canvas 上添加水印...');
    
    const ctx = canvas.getContext('2d');
    
    const watermarkText = '# <MARK2> #';

    // 设置字体样式并测量文字尺寸（考虑2倍缩放）
    const scale = this.config.configuration?.pixelRatio || 2;
    ctx.font = `bold 10px Arial`;
    const textMetrics = ctx.measureText(watermarkText);
    const textWidth = textMetrics.width;
    const textHeight = fontSize;
    
    // 直接使用Canvas实际尺寸计算中心（忽略style，因为Canvas已经是缩放后的）
    const x = canvas.width / 2;
    const y = canvas.height / 2 + 40; // 2倍缩放下的偏移也要翻倍
    
    console.log('水印坐标调试:', {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      canvasOffsetWidth: canvas.offsetWidth,
      canvasOffsetHeight: canvas.offsetHeight,
      canvasStyle: canvas.style.width + ' x ' + canvas.style.height,
      textWidth: textWidth,
      centerX: x,
      centerY: y,
      actualCenterShouldBe: canvas.offsetWidth ? canvas.offsetWidth / 2 : 'undefined'
    });
    
    // 绘制红色背景矩形（添加一些内边距，考虑缩放）
    const padding = 4 * scale;

    // 绘制水印背景矩形
    ctx.fillStyle = 'red';
    ctx.fillRect(
      x - textWidth / 2 - padding, 
      y - textHeight / 2 - padding, 
      textWidth + padding * 2, 
      textHeight + padding * 2
    );

    // 绘制水印文字
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(watermarkText, x, y);
    
    console.log('水印已添加到 Canvas');
    
    // 转换为 Blob
    return new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/png', this.config.configuration?.quality || 0.95);
    });
  }

  // 保存到剪切板和临时文件
  async saveToClipboardAndFile(blob) {
    try {
      const { ipcRenderer } = require('electron');
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // 通过 IPC 同时保存到剪切板和文件
      const result = await ipcRenderer.invoke('save-screenshot-dual', {
        buffer: buffer.toString('base64'),
        format: 'png'
      });
      
      if (result.success) {
        console.log('截图已保存到剪切板和临时文件:', result.filePath);
        return { 
          success: true, 
          filePath: result.filePath 
        };
      } else {
        console.error('截图保存失败:', result.error);
        return { success: false, error: result.error };
      }
      
    } catch (error) {
      console.error('保存截图失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 获取活动内容区域
  getActiveContent() {
    const contentArea = document.querySelector('.content-area');
    const previewArea = document.querySelector('.preview-area');
    const editorArea = document.querySelector('.editor-area');
    const markdownContent = document.querySelector('#markdownContent');

    console.log('查找内容区域:', {
      contentArea: !!contentArea,
      previewArea: !!previewArea,
      editorArea: !!editorArea,
      markdownContent: !!markdownContent
    });

    // 优先使用包含 padding 的外层容器
    if (contentArea && contentArea.style.display !== 'none') {
      console.log('使用 content-area 作为截图区域');
      return contentArea;
    } else if (previewArea && previewArea.style.display !== 'none') {
      console.log('使用 preview-area 作为截图区域');
      return previewArea;
    } else if (editorArea && editorArea.style.display !== 'none') {
      console.log('使用 editor-area 作为截图区域');
      return editorArea;
    }
    
    // 回退到 markdownContent
    if (markdownContent && markdownContent.offsetHeight > 0) {
      console.log('回退使用 markdownContent 作为截图区域');
      return markdownContent;
    }

    return null;
  }

  // 动态获取元素的背景色
  getElementBackgroundColor(element) {
    // 尝试从多个层级获取背景色
    let currentElement = element;
    let backgroundColor = 'transparent';
    
    // 向上遍历 DOM 树查找有效的背景色
    while (currentElement && currentElement !== document.body) {
      const computedStyle = window.getComputedStyle(currentElement);
      const bgColor = computedStyle.backgroundColor;
      
      console.log(`检查元素 ${currentElement.className || currentElement.tagName} 的背景色:`, bgColor);
      
      // 如果找到非透明的背景色
      if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
        backgroundColor = bgColor;
        console.log('找到有效背景色:', bgColor);
        break;
      }
      
      currentElement = currentElement.parentElement;
    }
    
    // 如果没有找到，检查 body 的背景色
    if (backgroundColor === 'transparent') {
      const bodyStyle = window.getComputedStyle(document.body);
      const bodyBgColor = bodyStyle.backgroundColor;
      
      if (bodyBgColor && bodyBgColor !== 'transparent' && bodyBgColor !== 'rgba(0, 0, 0, 0)') {
        backgroundColor = bodyBgColor;
        console.log('使用 body 的背景色:', bodyBgColor);
      } else {
        // 检查 html 元素的背景色
        const htmlStyle = window.getComputedStyle(document.documentElement);
        const htmlBgColor = htmlStyle.backgroundColor;
        
        if (htmlBgColor && htmlBgColor !== 'transparent' && htmlBgColor !== 'rgba(0, 0, 0, 0)') {
          backgroundColor = htmlBgColor;
          console.log('使用 html 的背景色:', htmlBgColor);
        } else {
          // 根据当前主题设置默认背景色
          const isDarkTheme = document.body.classList.contains('dark-theme') || 
                             document.documentElement.getAttribute('data-theme') === 'dark';
          backgroundColor = isDarkTheme ? '#1e1e1e' : '#ffffff';
          console.log('使用主题默认背景色:', backgroundColor);
        }
      }
    }
    
    return backgroundColor;
  }

  // 显示通知
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `screenshot-notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 4px;
      color: white;
      font-size: 14px;
      z-index: 10001;
      transition: opacity 0.3s ease;
      background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
    `;

    document.body.appendChild(notification);

    // 3秒后自动隐藏
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }


  // 插件配置更新时调用
  updateConfig(newConfig) {
    super.updateConfig(newConfig);
    console.log('Screenshot plugin config updated:', newConfig);
  }
}

module.exports = ScreenshotPlugin;