/**
 * Apply i18n translations to static HTML elements.
 * Called once at startup after initLocale().
 */
import { t, getLocale } from './index.js';

export function applyHtmlLocale() {
    const locale = getLocale();
    document.documentElement.lang = (locale === 'zh-CN' || locale === 'zh-TW') ? locale : 'en';

    // aria-label / title mappings  —  selector → [attribute, i18n key]
    const attrs = [
        ['#titlebar-menu', 'aria-label', 'titlebar.menu'],
        ['#theme-toggle', 'aria-label', 'titlebar.toggleTheme'],
        ['#titlebar-minimize', 'aria-label', 'titlebar.minimize'],
        ['#titlebar-maximize', 'aria-label', 'titlebar.maximize'],
        ['#titlebar-close', 'aria-label', 'titlebar.close'],
        ['.status-zoom-btn[data-zoom="out"]', 'aria-label', 'statusBar.zoomOut'],
        ['.status-zoom-btn[data-zoom="in"]', 'aria-label', 'statusBar.zoomIn'],
        ['#statusBarToc', 'title', 'statusBar.toc'],
        ['#statusBarAiTask', 'title', 'statusBar.aiTask'],
        ['#statusBarTranslator', 'title', 'statusBar.translator'],
        ['.translator-title', 'textContent', 'translator.title'],
        ['.translator-input', 'placeholder', 'translator.placeholder'],
        ['.translator-submit', 'textContent', 'translator.submit'],
        ['.translator-close-btn', 'title', 'translator.close'],
    ];

    for (const [selector, attr, key] of attrs) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const value = t(key);
        if (attr === 'textContent') {
            el.textContent = value;
        } else {
            el.setAttribute(attr, value);
        }
    }
}
