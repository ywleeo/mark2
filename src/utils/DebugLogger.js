/**
 * 全局调试日志工具
 * 捕获所有 console.log, console.error, console.warn, console.info 输出
 * 并写入到 debug.log 文件中，便于 AI 分析
 */

const { ipcRenderer } = require('electron');

class DebugLogger {
  constructor() {
    this.isEnabled = true;
    this.originalConsole = {};
    this.logBuffer = [];
    this.flushTimer = null;
    this.maxBufferSize = 100;
    this.flushInterval = 1000; // 1秒flush一次
    
    this.init();
  }

  init() {
    // 保存原始console方法
    this.originalConsole.log = console.log;
    this.originalConsole.error = console.error;
    this.originalConsole.warn = console.warn;
    this.originalConsole.info = console.info;
    this.originalConsole.debug = console.debug;

    // 重写console方法
    console.log = (...args) => this.interceptConsole('LOG', args);
    console.error = (...args) => this.interceptConsole('ERROR', args);
    console.warn = (...args) => this.interceptConsole('WARN', args);
    console.info = (...args) => this.interceptConsole('INFO', args);
    console.debug = (...args) => this.interceptConsole('DEBUG', args);

    // 清空debug文件
    this.clearDebugFile();

    // 启动定时flush
    this.startFlushTimer();

    // 页面卸载时flush剩余内容
    window.addEventListener('beforeunload', () => {
      this.flush();
    });

    this.writeToFile('=== Debug Logger 已启动 ===');
  }

  interceptConsole(level, args) {
    // 调用原始console方法，保持正常输出到开发者控制台
    this.originalConsole[level.toLowerCase()](...args);

    if (!this.isEnabled) return;

    // 格式化参数为字符串
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    // 添加到缓冲区
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level}: ${message}`;
    
    this.logBuffer.push(logEntry);

    // 如果缓冲区太大，立即flush
    if (this.logBuffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  startFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushTimer = setInterval(() => {
      if (this.logBuffer.length > 0) {
        this.flush();
      }
    }, this.flushInterval);
  }

  flush() {
    if (this.logBuffer.length === 0) return;

    const content = this.logBuffer.join('\n') + '\n';
    this.logBuffer = [];

    this.writeToFile(content);
  }

  writeToFile(content) {
    if (ipcRenderer) {
      ipcRenderer.invoke('append-debug-log', content).catch(err => {
        this.originalConsole.error('Debug Logger: 写入文件失败:', err);
      });
    }
  }

  clearDebugFile() {
    if (ipcRenderer) {
      ipcRenderer.invoke('clear-debug-log').catch(err => {
        this.originalConsole.error('Debug Logger: 清空文件失败:', err);
      });
    }
  }

  // 启用/禁用日志记录
  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.writeToFile(`=== Debug Logger ${enabled ? '已启用' : '已禁用'} ===`);
  }

  // 手动写入自定义日志
  writeCustomLog(message, level = 'CUSTOM') {
    if (!this.isEnabled) return;
    
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level}: ${message}`;
    
    this.logBuffer.push(logEntry);
    
    if (this.logBuffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  // 销毁debug logger，恢复原始console
  destroy() {
    // 恢复原始console方法
    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;
    console.info = this.originalConsole.info;
    console.debug = this.originalConsole.debug;

    // 清理定时器
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // flush剩余内容
    this.flush();

    this.writeToFile('=== Debug Logger 已销毁 ===');
  }
}

// 创建全局实例
let globalDebugLogger = null;

// 初始化函数
function initDebugLogger() {
  if (!globalDebugLogger) {
    globalDebugLogger = new DebugLogger();
  }
  return globalDebugLogger;
}

// 获取实例
function getDebugLogger() {
  return globalDebugLogger;
}

// 销毁函数
function destroyDebugLogger() {
  if (globalDebugLogger) {
    globalDebugLogger.destroy();
    globalDebugLogger = null;
  }
}

module.exports = {
  initDebugLogger,
  getDebugLogger,
  destroyDebugLogger,
  DebugLogger
};