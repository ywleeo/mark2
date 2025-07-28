const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class SettingsManager {
  static getSettingsPath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'theme-settings.json');
  }

  static async getThemeSettings() {
    try {
      const settingsPath = this.getSettingsPath();
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return settings;
      }
      return { theme: 'light' }; // 默认设置
    } catch (error) {
      console.error('读取主题设置失败:', error);
      return { theme: 'light' };
    }
  }

  static async saveThemeSettings(theme) {
    try {
      const settingsPath = this.getSettingsPath();
      const settings = { theme: theme };
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('保存主题设置失败:', error);
      throw new Error('无法保存主题设置: ' + error.message);
    }
  }
}

module.exports = SettingsManager;