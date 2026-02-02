/**
 * 卡片模板配置
 * - id: 模板唯一标识，对应 CSS 类名 card-preview-card__background--{id}
 * - color: 色块颜色（用于选择器显示）
 * - theme: 'dark' | 'light'，控制文字颜色
 * - buildDecorations: 返回装饰元素数组 [{ class, content }]
 */

export const CARD_TEMPLATES = [
    {
        id: 'quote-red',
        color: '#c45c5c',
        theme: 'light',
        buildDecorations: () => [
            { class: 'card-deco card-deco--quote-open', content: '❝' },
            { class: 'card-deco card-deco--quote-close', content: '❞' },
        ],
    },
    {
        id: 'minimal-cream',
        color: '#f5f0e8',
        theme: 'light',
        buildDecorations: () => [
            { class: 'card-deco card-deco--date', content: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
        ],
    },
    {
        id: 'pixel-dark',
        color: '#2d3748',
        theme: 'dark',
        buildDecorations: () => [
            { class: 'card-deco card-deco--pixel-corner', content: '+++' },
            { class: 'card-deco card-deco--pixel-face', content: ':)' },
        ],
    },
    {
        id: 'lined-paper',
        color: '#fafafa',
        theme: 'light',
        buildDecorations: () => [],
    },
    {
        id: 'quote-pink',
        color: '#fce4ec',
        theme: 'light',
        buildDecorations: () => [
            { class: 'card-deco card-deco--quote-open card-deco--pink', content: '❝' },
        ],
    },
    {
        id: 'blue-stripe',
        color: '#e3f2fd',
        theme: 'light',
        buildDecorations: () => [],
    },
    {
        id: 'grid-note',
        color: '#f0fff4',
        theme: 'light',
        buildDecorations: () => [
            { class: 'card-deco card-deco--date-small', content: `Date: ${new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })}` },
        ],
    },
    {
        id: 'shadow-light',
        color: '#f8f8f8',
        theme: 'light',
        buildDecorations: () => [
            { class: 'card-deco card-deco--corner-date', content: `${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}` },
        ],
    },
];
