export const SETTINGS_STORAGE_KEY = 'mark2:editorSettings';

const VALID_APPEARANCES = new Set(['light', 'dark', 'system']);

export const defaultEditorSettings = {
    theme: 'default',
    appearance: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: '',
    fontWeight: 400,
    codeTheme: 'auto',
    codeFontSize: 14,
    codeLineHeight: 1.5,
    codeFontFamily: '',
    codeFontWeight: 400,
    terminalFontSize: 13,
    terminalFontFamily: '',
};

function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}

function normalizeFontWeight(weight) {
    const allowed = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    if (allowed.includes(weight)) {
        return weight;
    }

    const nearest = allowed.reduce((closest, current) => {
        return Math.abs(current - weight) < Math.abs(closest - weight) ? current : closest;
    }, 400);

    return nearest;
}

export function normalizeEditorSettings(candidate) {
    const prefs = { ...defaultEditorSettings };

    if (candidate && typeof candidate === 'object') {
        if (typeof candidate.theme === 'string') {
            const theme = candidate.theme.trim() || 'default';
            prefs.theme = theme;
        }

        if (typeof candidate.appearance === 'string') {
            const normalizedAppearance = candidate.appearance.trim().toLowerCase();
            if (VALID_APPEARANCES.has(normalizedAppearance)) {
                prefs.appearance = normalizedAppearance;
            }
        }

        if (candidate.fontSize !== undefined) {
            const size = Number(candidate.fontSize);
            if (Number.isFinite(size)) {
                prefs.fontSize = clamp(size, 10, 48);
            }
        }

        if (candidate.lineHeight !== undefined) {
            const height = Number(candidate.lineHeight);
            if (Number.isFinite(height)) {
                const clampedHeight = clamp(height, 1.0, 3.0);
                prefs.lineHeight = Number(clampedHeight.toFixed(2));
            }
        }

        if (typeof candidate.fontFamily === 'string') {
            const trimmedFamily = candidate.fontFamily.trim();
            if (
                trimmedFamily &&
                !trimmedFamily.includes(',') &&
                !/["']/.test(trimmedFamily) &&
                /\s/.test(trimmedFamily)
            ) {
                prefs.fontFamily = `'${trimmedFamily.replace(/'/g, "\\'")}'`;
            } else {
                prefs.fontFamily = trimmedFamily;
            }
        }

        if (candidate.fontWeight !== undefined) {
            const weight = Number(candidate.fontWeight);
            if (Number.isFinite(weight)) {
                prefs.fontWeight = normalizeFontWeight(weight);
            }
        }

        if (candidate.codeFontSize !== undefined) {
            const size = Number(candidate.codeFontSize);
            if (Number.isFinite(size)) {
                prefs.codeFontSize = clamp(size, 10, 48);
            }
        }

        if (candidate.codeLineHeight !== undefined) {
            const height = Number(candidate.codeLineHeight);
            if (Number.isFinite(height)) {
                const clampedHeight = clamp(height, 1.0, 3.0);
                prefs.codeLineHeight = Number(clampedHeight.toFixed(2));
            }
        }

        if (typeof candidate.codeTheme === 'string') {
            const theme = candidate.codeTheme.trim() || 'auto';
            prefs.codeTheme = theme;
        }

        if (typeof candidate.codeFontFamily === 'string') {
            prefs.codeFontFamily = candidate.codeFontFamily.trim();
        }

        if (candidate.codeFontWeight !== undefined) {
            const weight = Number(candidate.codeFontWeight);
            if (Number.isFinite(weight)) {
                prefs.codeFontWeight = normalizeFontWeight(weight);
            }
        }

        if (candidate.terminalFontSize !== undefined) {
            const size = Number(candidate.terminalFontSize);
            if (Number.isFinite(size)) {
                prefs.terminalFontSize = clamp(size, 10, 24);
            }
        }

        if (typeof candidate.terminalFontFamily === 'string') {
            prefs.terminalFontFamily = candidate.terminalFontFamily.trim();
        }
    }

    return prefs;
}

export function loadEditorSettings(storageKey = SETTINGS_STORAGE_KEY) {
    try {
        const stored = window.localStorage.getItem(storageKey);
        if (!stored) {
            return { ...defaultEditorSettings };
        }

        const parsed = JSON.parse(stored);
        return normalizeEditorSettings(parsed);
    } catch (error) {
        console.warn('加载编辑器设置失败，使用默认值', error);
        return { ...defaultEditorSettings };
    }
}

export function saveEditorSettings(settings, storageKey = SETTINGS_STORAGE_KEY) {
    try {
        const normalized = normalizeEditorSettings(settings);
        window.localStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch (error) {
        console.warn('保存编辑器设置失败', error);
    }
}

export function applyEditorSettings(settings) {
    const prefs = normalizeEditorSettings(settings);
    const root = document.documentElement;

    lastAppliedSettings = { ...prefs };
    ensureSystemAppearanceListener();

    const appearancePreference = prefs.appearance || 'system';
    const resolvedAppearance = resolveAppearance(appearancePreference);
    currentAppearancePreference = appearancePreference;

    root.dataset.themeAppearance = resolvedAppearance;
    root.dataset.themeAppearancePreference = appearancePreference;
    root.style.setProperty('color-scheme', resolvedAppearance);

    loadTheme(prefs.theme);

    root.style.setProperty('--editor-font-size', `${prefs.fontSize}px`);
    root.style.setProperty('--editor-line-height', prefs.lineHeight.toString());
    root.style.setProperty('--editor-font-weight', prefs.fontWeight.toString());

    if (prefs.fontFamily && prefs.fontFamily.length > 0) {
        root.style.setProperty('--editor-font-family', prefs.fontFamily);
    } else {
        root.style.removeProperty('--editor-font-family');
    }

    root.style.setProperty('--code-font-size', `${prefs.codeFontSize}px`);
    root.style.setProperty('--code-line-height', prefs.codeLineHeight.toString());
    root.style.setProperty('--code-font-weight', prefs.codeFontWeight.toString());

    if (prefs.codeFontFamily && prefs.codeFontFamily.length > 0) {
        root.style.setProperty('--code-font-family', prefs.codeFontFamily);
    } else {
        root.style.removeProperty('--code-font-family');
    }

    notifyAppearanceChange(resolvedAppearance, appearancePreference);
}

let prefersDarkMediaQuery = null;
let prefersDarkMediaQueryHandler = null;
let lastAppliedSettings = { ...defaultEditorSettings };
let currentAppearancePreference = defaultEditorSettings.appearance;
let lastNotifiedAppearance = null;
let lastNotifiedPreference = null;
const appearanceListeners = new Set();

const themeAssets = import.meta.glob('../../styles/themes/*.css', {
    query: '?url',
    import: 'default',
    eager: true,
});

const themeUrlByName = Object.entries(themeAssets).reduce((acc, [path, url]) => {
    const match = path.match(/\/([^/]+)\.css$/);
    if (match && match[1]) {
        acc[match[1]] = url;
    }
    return acc;
}, {});

function resolveAppearance(preference) {
    if (preference === 'light' || preference === 'dark') {
        return preference;
    }
    return getSystemAppearance();
}

function getSystemAppearance() {
    if (!prefersDarkMediaQuery && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        prefersDarkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }

    if (!prefersDarkMediaQuery) {
        return 'light';
    }

    return prefersDarkMediaQuery.matches ? 'dark' : 'light';
}

function ensureSystemAppearanceListener() {
    if (prefersDarkMediaQuery && prefersDarkMediaQueryHandler) {
        return;
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !prefersDarkMediaQuery) {
        prefersDarkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }

    if (!prefersDarkMediaQuery || prefersDarkMediaQueryHandler) {
        return;
    }

    prefersDarkMediaQueryHandler = () => {
        if (currentAppearancePreference === 'system') {
            applyEditorSettings(lastAppliedSettings);
        }
    };

    if (typeof prefersDarkMediaQuery.addEventListener === 'function') {
        prefersDarkMediaQuery.addEventListener('change', prefersDarkMediaQueryHandler);
    } else if (typeof prefersDarkMediaQuery.addListener === 'function') {
        prefersDarkMediaQuery.addListener(prefersDarkMediaQueryHandler);
    }
}

function notifyAppearanceChange(resolvedAppearance, preference) {
    if (
        resolvedAppearance === lastNotifiedAppearance &&
        preference === lastNotifiedPreference
    ) {
        return;
    }

    lastNotifiedAppearance = resolvedAppearance;
    lastNotifiedPreference = preference;

    appearanceListeners.forEach(listener => {
        try {
            listener({ appearance: resolvedAppearance, preference });
        } catch (error) {
            console.warn('appearance listener error', error);
        }
    });
}

export function onEditorAppearanceChange(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    appearanceListeners.add(listener);
    return () => {
        appearanceListeners.delete(listener);
    };
}

function loadTheme(themeName) {
    const theme = themeName || 'default';
    const themeId = 'markdown-theme-stylesheet';

    const existingTheme = document.getElementById(themeId);
    if (existingTheme) {
        existingTheme.remove();
    }

    const href = themeUrlByName[theme] || themeUrlByName.default || `/styles/themes/${theme}.css`;

    const link = document.createElement('link');
    link.id = themeId;
    link.rel = 'stylesheet';
    link.href = href;

    document.head.appendChild(link);
}
