/**
 * Apply i18n translations to static HTML elements.
 * Called once at startup after initLocale().
 */
import { t, getLocale } from './index.js';

export function applyHtmlLocale() {
    document.documentElement.lang = getLocale() === 'zh-CN' ? 'zh-CN' : 'en';

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
        ['#statusBarScratchpad', 'title', 'statusBar.scratchpad'],
        ['.terminal-stop-btn', 'aria-label', 'terminal.stop'],
        ['.terminal-stop-btn', 'title', 'terminal.stop'],
        ['.terminal-split-btn', 'aria-label', 'terminal.split'],
        ['.terminal-settings-btn', 'aria-label', 'terminal.settings'],
        ['.terminal-close-btn', 'aria-label', 'terminal.close'],
        ['.ai-sidebar-clear-btn', 'title', 'ai.clearChat'],
        ['.ai-sidebar-close-btn', 'title', 'ai.close'],
        ['.ai-conversation-empty-text', 'textContent', 'ai.agentTitle'],
        ['.ai-sidebar-input-field', 'placeholder', 'ai.placeholder'],
        ['.ai-sidebar-cancel-btn', 'title', 'ai.cancel'],
        ['.ai-sidebar-send-btn', 'title', 'ai.send'],
        ['.ai-auto-edit-chip [data-i18n="ai.autoEdit.label"]', 'textContent', 'ai.autoEdit.label'],
        ['.scratchpad-title', 'textContent', 'scratchpad.title'],
        ['.scratchpad-textarea', 'placeholder', 'scratchpad.placeholder'],
        ['.scratchpad-close-btn', 'title', 'scratchpad.close'],
        ['.search-input', 'placeholder', 'search.find'],
        ['.replace-input', 'placeholder', 'search.replace'],
        ['.search-button.multi-btn', 'title', 'search.selectAll'],
        ['.search-button.multi-btn', 'aria-label', 'search.selectAll'],
        ['.search-button.prev-btn', 'title', 'search.prev'],
        ['.search-button.next-btn', 'title', 'search.next'],
        ['.search-button.close-btn', 'title', 'search.close'],
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
