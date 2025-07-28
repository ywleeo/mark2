const { contextBridge, webUtils, ipcRenderer } = require('electron');
const { marked } = require('marked');

// 暴露API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile: (file) => {
    return webUtils.getPathForFile(file);
  },
  // IPC通信
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, callback) => ipcRenderer.on(channel, callback),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  // Marked库
  marked: marked
});