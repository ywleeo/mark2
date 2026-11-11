/** 全局文件排除配置的数据协议与推荐值，不依赖 UI 或 Tauri。 */

/** 每次返回独立对象，避免设置草稿修改当前生效的配置。 */
export function defaultFileExclusionSettings() {
    return {
        enabled: true,
        applyToSearch: true,
        rules: ['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized', '.git', '.gitignore']
            .map(pattern => ({ pattern, enabled: true })),
    };
}

/** 校正配置形状并复制规则；语法错误留给统一的后端校验器逐行报告。 */
export function normalizeFileExclusionSettings(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.rules)) {
        return defaultFileExclusionSettings();
    }
    return {
        enabled: value.enabled !== false,
        applyToSearch: value.applyToSearch !== false,
        rules: value.rules.map(rule => ({
            pattern: typeof rule?.pattern === 'string' ? rule.pattern.trim() : '',
            enabled: rule?.enabled !== false,
        })),
    };
}
