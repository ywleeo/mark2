class EventManager {
  constructor() {
    this.listeners = new Map();
  }

  // 注册事件监听器
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
  }

  // 移除事件监听器
  off(eventName, callback) {
    if (!this.listeners.has(eventName)) return;
    
    const callbacks = this.listeners.get(eventName);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  // 触发事件
  emit(eventName, ...args) {
    if (!this.listeners.has(eventName)) return;
    
    const callbacks = this.listeners.get(eventName);
    callbacks.forEach(callback => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`Error in event listener for ${eventName}:`, error);
      }
    });
  }

  // 注册一次性事件监听器
  once(eventName, callback) {
    const onceCallback = (...args) => {
      callback(...args);
      this.off(eventName, onceCallback);
    };
    this.on(eventName, onceCallback);
  }

  // 清除所有监听器
  clear() {
    this.listeners.clear();
  }

  // 清除特定事件的所有监听器
  clearEvent(eventName) {
    this.listeners.delete(eventName);
  }

  // 获取事件监听器数量
  getListenerCount(eventName) {
    return this.listeners.has(eventName) ? this.listeners.get(eventName).length : 0;
  }

  // 获取所有事件名称
  getEventNames() {
    return Array.from(this.listeners.keys());
  }
}

module.exports = EventManager;