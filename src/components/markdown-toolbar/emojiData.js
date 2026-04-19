/**
 * Emoji 数据适配层
 * 基于 @emoji-mart/data，规范化成 picker 需要的结构。
 * 自带分类 + 关键词搜索 + 多语言 UI 标签。
 */
import rawData from '@emoji-mart/data/sets/15/native.json';
import i18nZh from '@emoji-mart/data/i18n/zh.json';
import i18nEn from '@emoji-mart/data/i18n/en.json';
import { getLocale } from '../../i18n/index.js';

const CATEGORY_ICONS = {
    frequent: '🕐',
    people: '😀',
    nature: '🐶',
    foods: '🍎',
    activity: '⚽',
    places: '🚗',
    objects: '💡',
    symbols: '❤️',
    flags: '🏁'
};

function getI18n() {
    return getLocale() === 'zh-CN' ? i18nZh : i18nEn;
}

/** 分类列表（不含 frequent，frequent 在 picker 里动态拼装） */
export function getCategories() {
    const i18n = getI18n();
    return rawData.categories.map(cat => ({
        id: cat.id,
        name: i18n.categories?.[cat.id] || cat.id,
        icon: CATEGORY_ICONS[cat.id] || '•',
        emojis: cat.emojis.map(id => {
            const e = rawData.emojis[id];
            return {
                id,
                name: e.name,
                native: e.skins[0].native,
                keywords: e.keywords
            };
        })
    }));
}

export function getCategoryIcon(id) {
    return CATEGORY_ICONS[id] || '•';
}

export function getCategoryName(id) {
    return getI18n().categories?.[id] || id;
}

export function getLabels() {
    const i18n = getI18n();
    return {
        search: i18n.search || 'Search',
        noResults: i18n.search_no_results_2 || 'No results'
    };
}

/** 根据 id 取 emoji 原生字符（最近使用恢复用） */
export function getEmojiById(id) {
    const e = rawData.emojis[id];
    if (!e) return null;
    return { id, name: e.name, native: e.skins[0].native, keywords: e.keywords };
}

/**
 * 关键词搜索。匹配 id / name / keywords（均小写）。
 * 中文 locale 下 keywords 仍是英文（emoji-mart 数据源限制），保留 native 字符匹配兜底。
 */
export function searchEmojis(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results = [];
    for (const id in rawData.emojis) {
        const e = rawData.emojis[id];
        const hay = `${id} ${e.name} ${e.keywords.join(' ')}`.toLowerCase();
        if (hay.includes(q) || e.skins[0].native === q) {
            results.push({
                id,
                name: e.name,
                native: e.skins[0].native,
                keywords: e.keywords
            });
            if (results.length >= 200) break;
        }
    }
    return results;
}
