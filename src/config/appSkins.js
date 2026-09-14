/**
 * 应用皮肤注册表：应用外壳与 Markdown 主题由同一皮肤选择协调。
 * 经典皮肤保留用户既有的 Markdown 主题设置，避免升级后改变原有外观。
 */
export const APP_SKINS = Object.freeze({
    classic: Object.freeze({ markdownTheme: null }),
    editorial: Object.freeze({ markdownTheme: 'editorial' }),
});

/** 将持久化的皮肤值限制在已内置的皮肤内。 */
export function normalizeAppSkin(value) {
    return typeof value === 'string' && Object.hasOwn(APP_SKINS, value)
        ? value
        : 'classic';
}

/** 根据整体皮肤选择实际显示和导出使用的 Markdown 主题。 */
export function resolveMarkdownTheme(skin, preferredTheme) {
    const entry = APP_SKINS[normalizeAppSkin(skin)];
    return entry.markdownTheme || preferredTheme || 'default';
}
