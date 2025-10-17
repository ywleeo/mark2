export const SETTINGS_STORAGE_KEY = 'mark2:editorSettings';

export const defaultEditorSettings = {
    theme: 'default',
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: '',
    fontWeight: 400,
    codeFontSize: 14,
    codeLineHeight: 1.5,
    codeFontFamily: '',
    codeFontWeight: 400,
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

        if (typeof candidate.codeFontFamily === 'string') {
            prefs.codeFontFamily = candidate.codeFontFamily.trim();
        }

        if (candidate.codeFontWeight !== undefined) {
            const weight = Number(candidate.codeFontWeight);
            if (Number.isFinite(weight)) {
                prefs.codeFontWeight = normalizeFontWeight(weight);
            }
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
}

function loadTheme(themeName) {
    const theme = themeName || 'default';
    const themeId = 'markdown-theme-stylesheet';

    const existingTheme = document.getElementById(themeId);
    if (existingTheme) {
        existingTheme.remove();
    }

    const link = document.createElement('link');
    link.id = themeId;
    link.rel = 'stylesheet';
    link.href = `/styles/themes/${theme}.css`;

    document.head.appendChild(link);
}
