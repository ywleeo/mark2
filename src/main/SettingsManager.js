const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class SettingsManager {
  static getSettingsPath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'app-settings.json');
  }

  static async getAllSettings() {
    try {
      const settingsPath = this.getSettingsPath();
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return settings;
      }
      return { 
        theme: 'light',
        keywordHighlight: true,
        plugins: {},
        window: {
          x: undefined,
          y: undefined,
          width: 800,
          height: 600,
          isMaximized: false
        }
      }; // 默认设置
    } catch (error) {
      console.error('读取设置失败:', error);
      return { 
        theme: 'light',
        keywordHighlight: true,
        plugins: {},
        window: {
          x: undefined,
          y: undefined,
          width: 800,
          height: 600,
          isMaximized: false
        }
      };
    }
  }

  static async getThemeSettings() {
    try {
      const settings = await this.getAllSettings();
      return { theme: settings.theme || 'light' };
    } catch (error) {
      console.error('读取主题设置失败:', error);
      return { theme: 'light' };
    }
  }

  static async saveThemeSettings(theme) {
    try {
      const settings = await this.getAllSettings();
      settings.theme = theme;
      
      const settingsPath = this.getSettingsPath();
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('保存主题设置失败:', error);
      throw new Error('无法保存主题设置: ' + error.message);
    }
  }

  static async saveKeywordHighlightSettings(enabled) {
    try {
      const settings = await this.getAllSettings();
      settings.keywordHighlight = enabled;
      
      const settingsPath = this.getSettingsPath();
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('保存关键词高亮设置失败:', error);
      throw new Error('无法保存关键词高亮设置: ' + error.message);
    }
  }

  static async savePluginSettings(pluginId, enabled) {
    try {
      const settings = await this.getAllSettings();
      if (!settings.plugins) {
        settings.plugins = {};
      }
      settings.plugins[pluginId] = enabled;
      
      const settingsPath = this.getSettingsPath();
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('保存插件设置失败:', error);
      throw new Error('无法保存插件设置: ' + error.message);
    }
  }

  static async getKeywordHighlightSettings() {
    try {
      const settings = await this.getAllSettings();
      return settings.keywordHighlight !== undefined ? settings.keywordHighlight : true;
    } catch (error) {
      console.error('读取关键词高亮设置失败:', error);
      return true;
    }
  }

  static async getPluginSettings() {
    try {
      const settings = await this.getAllSettings();
      return settings.plugins || {};
    } catch (error) {
      console.error('读取插件设置失败:', error);
      return {};
    }
  }

  static async getWindowState() {
    try {
      const settings = await this.getAllSettings();
      return settings.window || {
        x: undefined,
        y: undefined,
        width: 800,
        height: 600,
        isMaximized: false
      };
    } catch (error) {
      console.error('读取窗口状态失败:', error);
      return {
        x: undefined,
        y: undefined,
        width: 800,
        height: 600,
        isMaximized: false
      };
    }
  }

  static async saveWindowState(windowState) {
    try {
      const settings = await this.getAllSettings();
      settings.window = {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        isMaximized: windowState.isMaximized
      };
      
      const settingsPath = this.getSettingsPath();
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('保存窗口状态失败:', error);
      throw new Error('无法保存窗口状态: ' + error.message);
    }
  }
}

module.exports = SettingsManager;