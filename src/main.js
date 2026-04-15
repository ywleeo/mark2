// 过滤开发环境下 Tauri 热重载产生的无用警告
const originalWarn = console.warn;
console.warn = function(...args) {
    const message = args[0];
    if (typeof message === 'string' && message.includes('[TAURI] Couldn\'t find callback id')) {
        return;
    }
    originalWarn.apply(console, args);
};

import { wireApp } from './app/wireApp.js';

document.addEventListener('DOMContentLoaded', () => {
    // Apply i18n to static HTML elements before components init
    import('./i18n/applyHtmlLocale.js').then(({ applyHtmlLocale }) => applyHtmlLocale());
    const bootstrap = wireApp();
    void bootstrap.initializeApplication();
});
