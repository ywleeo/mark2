/**
 * 应用皮肤注册表：皮肤负责布局与交互，配色方案负责颜色。
 * 经典皮肤保留用户既有的 Markdown 主题设置，避免升级后改变原有外观。
 */
export const APP_SKINS = Object.freeze({
    classic: Object.freeze({
        markdownTheme: null,
        workspaceProfile: 'general',
        defaultColorScheme: 'default',
        colorSchemes: Object.freeze([
            Object.freeze({
                id: 'default',
                labelKey: 'settings.colorSchemeClassicBlackWhite',
                preview: Object.freeze(['#f7f7f8', '#24292f', '#aeb3b9']),
                previewPage: '#fdfdfd',
            }),
            Object.freeze({
                id: 'forest',
                labelKey: 'settings.colorSchemeClassicForest',
                preview: Object.freeze(['#f2f6f3', '#233129', '#2f7d5a']),
                previewPage: '#f3f7f4',
            }),
            Object.freeze({
                id: 'violet',
                labelKey: 'settings.colorSchemeClassicViolet',
                preview: Object.freeze(['#f5f2f8', '#2d2938', '#7656a8']),
                previewPage: '#f7f4fa',
            }),
        ]),
    }),
    editorial: Object.freeze({
        markdownTheme: 'editorial',
        workspaceProfile: 'writing',
        defaultColorScheme: 'terracotta',
        colorSchemes: Object.freeze([
            Object.freeze({
                id: 'terracotta',
                labelKey: 'settings.colorSchemeEditorialTerracotta',
                preview: Object.freeze(['#f3eee4', '#342e27', '#9c4b37']),
            }),
            Object.freeze({
                id: 'pine',
                labelKey: 'settings.colorSchemeEditorialPine',
                preview: Object.freeze(['#eef2eb', '#28342e', '#47745e']),
            }),
            Object.freeze({
                id: 'indigo',
                labelKey: 'settings.colorSchemeEditorialIndigo',
                preview: Object.freeze(['#f0f1f6', '#303346', '#5c68a6']),
            }),
        ]),
    }),
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

/** 根据应用皮肤解析工作区行为配置，与颜色及 Markdown 排版主题解耦。 */
export function resolveWorkspaceProfile(skin) {
    return APP_SKINS[normalizeAppSkin(skin)].workspaceProfile;
}

/** 返回指定皮肤允许展示的配色方案元数据。 */
export function getAppColorSchemes(skin) {
    return APP_SKINS[normalizeAppSkin(skin)].colorSchemes;
}

/**
 * 规范化各皮肤独立保存的配色选择，未知值回退到对应皮肤默认方案。
 * @param {object|null|undefined} candidate - 持久化的皮肤到配色映射。
 * @returns {Record<string, string>} 完整且受控的配色映射。
 */
export function normalizeAppColorSchemes(candidate) {
    return Object.fromEntries(Object.entries(APP_SKINS).map(([skinId, skin]) => {
        const requested = candidate && typeof candidate === 'object' ? candidate[skinId] : null;
        const supported = skin.colorSchemes.some(scheme => scheme.id === requested);
        return [skinId, supported ? requested : skin.defaultColorScheme];
    }));
}

/** 根据当前皮肤解析实际生效的配色方案。 */
export function resolveAppColorScheme(skin, colorSchemes) {
    const normalizedSkin = normalizeAppSkin(skin);
    return normalizeAppColorSchemes(colorSchemes)[normalizedSkin];
}
