/**
 * Lightweight i18n module — key-value JSON, no third-party deps.
 *
 * Usage:
 *   import { t, getLocale, setLocale } from '../i18n/index.js';
 *   t('menu.file')            → "File" or "文件"
 *   t('about.version', { version: '1.0' }) → "Version 1.0"
 */

import en from './en.json';
import zhCN from './zh-CN.json';

const STORAGE_KEY = 'mark2:locale';
const SUPPORTED = { en, 'zh-CN': zhCN };
const DEFAULT_LOCALE = 'en';

// Auto-init on module load — must happen before any t() call from other modules
const _stored = localStorage.getItem(STORAGE_KEY);
const _initLocale = _stored && SUPPORTED[_stored] ? _stored : DEFAULT_LOCALE;
let currentLocale = _initLocale;
let currentMessages = SUPPORTED[_initLocale];


// Sync locale file for Rust backend (fire-and-forget)
async function _syncLocaleFile(locale) {
    try {
        const { appDataDir, join } = await import('@tauri-apps/api/path');
        const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
        const dir = await appDataDir();
        await mkdir(dir, { recursive: true }).catch(() => {});
        const filePath = await join(dir, 'locale.txt');
        await writeTextFile(filePath, locale);
    } catch (e) {
        console.warn('[i18n] failed to write locale file:', e);
    }
}
_syncLocaleFile(currentLocale);

/** Get current locale code. */
export function getLocale() {
    return currentLocale;
}

/** Persist new locale and reload the page. */
export async function setLocale(locale) {
    if (!SUPPORTED[locale] || locale === currentLocale) return;
    localStorage.setItem(STORAGE_KEY, locale);
    await _syncLocaleFile(locale);
    location.reload();
}

/**
 * Translate a key, with optional interpolation.
 * @param {string} key   dot-separated key, e.g. "menu.file"
 * @param {Record<string, string|number>} [params]  e.g. { count: 5 }
 * @returns {string}
 */
export function t(key, params) {
    let text = currentMessages[key] ?? en[key] ?? key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, String(v));
        }
    }
    return text;
}
