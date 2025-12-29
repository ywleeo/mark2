/**
 * Monaco 编辑器主题配置
 * 每个主题都有 light 和 dark 两个版本，会根据系统颜色模式自动切换
 */

// ============================================================================
// Monokai 主题
// ============================================================================

export const monokaiDarkTheme = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: '', foreground: 'F8F8F2' },
        { token: 'comment', foreground: '88846F' },
        { token: 'string', foreground: 'E6DB74' },
        { token: 'number', foreground: 'AE81FF' },
        { token: 'keyword', foreground: 'F92672' },
        { token: 'operator', foreground: 'F92672' },
        { token: 'delimiter', foreground: 'F8F8F2' },
        { token: 'type', foreground: '66D9EF', fontStyle: 'italic' },
        { token: 'function', foreground: 'A6E22E' },
        { token: 'variable', foreground: 'F8F8F2' },
        { token: 'constant', foreground: 'AE81FF' },
        { token: 'identifier', foreground: 'F8F8F2' },
    ],
    colors: {
        'editor.background': '#272822',
        'editor.foreground': '#F8F8F2',
        'editor.lineHighlightBackground': '#3E3D32',
        'editor.selectionBackground': '#49483E',
        'editorCursor.foreground': '#F8F8F0',
        'editorWhitespace.foreground': '#3B3A32',
        'editorLineNumber.foreground': '#90908A',
        'editorLineNumber.activeForeground': '#C2C2BF',
    }
};

export const monokaiLightTheme = {
    base: 'vs',
    inherit: true,
    rules: [
        { token: '', foreground: '3B3A32' },
        { token: 'comment', foreground: '75715E' },
        { token: 'string', foreground: 'C19C00' },
        { token: 'number', foreground: '9933CC' },
        { token: 'keyword', foreground: 'E8004F' },
        { token: 'operator', foreground: 'E8004F' },
        { token: 'delimiter', foreground: '3B3A32' },
        { token: 'type', foreground: '0087AF', fontStyle: 'italic' },
        { token: 'function', foreground: '739200' },
        { token: 'variable', foreground: '3B3A32' },
        { token: 'constant', foreground: '9933CC' },
        { token: 'identifier', foreground: '3B3A32' },
    ],
    colors: {
        'editor.background': '#FAFAFA',
        'editor.foreground': '#3B3A32',
        'editor.lineHighlightBackground': '#EFEFEF',
        'editor.selectionBackground': '#C9D0D9',
        'editorCursor.foreground': '#000000',
        'editorWhitespace.foreground': '#E0E0E0',
        'editorLineNumber.foreground': '#A0A0A0',
        'editorLineNumber.activeForeground': '#3B3A32',
    }
};

// ============================================================================
// Dracula 主题
// ============================================================================

export const draculaDarkTheme = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: '', foreground: 'F8F8F2' },
        { token: 'comment', foreground: '6272A4' },
        { token: 'string', foreground: 'F1FA8C' },
        { token: 'number', foreground: 'BD93F9' },
        { token: 'keyword', foreground: 'FF79C6' },
        { token: 'operator', foreground: 'FF79C6' },
        { token: 'delimiter', foreground: 'F8F8F2' },
        { token: 'type', foreground: '8BE9FD', fontStyle: 'italic' },
        { token: 'function', foreground: '50FA7B' },
        { token: 'variable', foreground: 'F8F8F2' },
        { token: 'constant', foreground: 'BD93F9' },
        { token: 'identifier', foreground: 'F8F8F2' },
    ],
    colors: {
        'editor.background': '#282A36',
        'editor.foreground': '#F8F8F2',
        'editor.lineHighlightBackground': '#44475A',
        'editor.selectionBackground': '#44475A',
        'editorCursor.foreground': '#F8F8F0',
        'editorWhitespace.foreground': '#3B3B3B',
        'editorLineNumber.foreground': '#6272A4',
        'editorLineNumber.activeForeground': '#F8F8F2',
    }
};

export const draculaLightTheme = {
    base: 'vs',
    inherit: true,
    rules: [
        { token: '', foreground: '2F2F2F' },
        { token: 'comment', foreground: '6272A4' },
        { token: 'string', foreground: 'A08800' },
        { token: 'number', foreground: '8959A8' },
        { token: 'keyword', foreground: 'C41A7E' },
        { token: 'operator', foreground: 'C41A7E' },
        { token: 'delimiter', foreground: '2F2F2F' },
        { token: 'type', foreground: '0184BC', fontStyle: 'italic' },
        { token: 'function', foreground: '00A800' },
        { token: 'variable', foreground: '2F2F2F' },
        { token: 'constant', foreground: '8959A8' },
        { token: 'identifier', foreground: '2F2F2F' },
    ],
    colors: {
        'editor.background': '#F8F8F2',
        'editor.foreground': '#2F2F2F',
        'editor.lineHighlightBackground': '#EFEFEF',
        'editor.selectionBackground': '#D0D0D0',
        'editorCursor.foreground': '#000000',
        'editorWhitespace.foreground': '#E0E0E0',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#2F2F2F',
    }
};

// ============================================================================
// One Dark Pro 主题
// ============================================================================

export const oneDarkProDarkTheme = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: '', foreground: 'ABB2BF' },
        { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
        { token: 'string', foreground: '98C379' },
        { token: 'number', foreground: 'D19A66' },
        { token: 'keyword', foreground: 'C678DD' },
        { token: 'operator', foreground: '56B6C2' },
        { token: 'delimiter', foreground: 'ABB2BF' },
        { token: 'type', foreground: 'E5C07B' },
        { token: 'function', foreground: '61AFEF' },
        { token: 'variable', foreground: 'E06C75' },
        { token: 'constant', foreground: 'D19A66' },
        { token: 'identifier', foreground: 'ABB2BF' },
    ],
    colors: {
        'editor.background': '#282C34',
        'editor.foreground': '#ABB2BF',
        'editor.lineHighlightBackground': '#2C313C',
        'editor.selectionBackground': '#3E4451',
        'editorCursor.foreground': '#528BFF',
        'editorWhitespace.foreground': '#3B4048',
        'editorLineNumber.foreground': '#495162',
        'editorLineNumber.activeForeground': '#ABB2BF',
    }
};

export const oneDarkProLightTheme = {
    base: 'vs',
    inherit: true,
    rules: [
        { token: '', foreground: '383A42' },
        { token: 'comment', foreground: 'A0A1A7', fontStyle: 'italic' },
        { token: 'string', foreground: '50A14F' },
        { token: 'number', foreground: '986801' },
        { token: 'keyword', foreground: 'A626A4' },
        { token: 'operator', foreground: '0184BC' },
        { token: 'delimiter', foreground: '383A42' },
        { token: 'type', foreground: 'C18401' },
        { token: 'function', foreground: '4078F2' },
        { token: 'variable', foreground: 'E45649' },
        { token: 'constant', foreground: '986801' },
        { token: 'identifier', foreground: '383A42' },
    ],
    colors: {
        'editor.background': '#FAFAFA',
        'editor.foreground': '#383A42',
        'editor.lineHighlightBackground': '#F0F0F0',
        'editor.selectionBackground': '#D0D0D0',
        'editorCursor.foreground': '#4078F2',
        'editorWhitespace.foreground': '#E5E5E6',
        'editorLineNumber.foreground': '#9D9D9F',
        'editorLineNumber.activeForeground': '#383A42',
    }
};

// ============================================================================
// GitHub 主题
// ============================================================================

export const githubDarkTheme = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: '', foreground: 'E6EDF3' },
        { token: 'comment', foreground: '8B949E', fontStyle: 'italic' },
        { token: 'string', foreground: 'A5D6FF' },
        { token: 'number', foreground: '79C0FF' },
        { token: 'keyword', foreground: 'FF7B72' },
        { token: 'operator', foreground: 'FF7B72' },
        { token: 'delimiter', foreground: 'E6EDF3' },
        { token: 'type', foreground: 'FFA657' },
        { token: 'function', foreground: 'D2A8FF' },
        { token: 'variable', foreground: 'FFA657' },
        { token: 'constant', foreground: '79C0FF' },
        { token: 'identifier', foreground: 'E6EDF3' },
    ],
    colors: {
        'editor.background': '#0D1117',
        'editor.foreground': '#E6EDF3',
        'editor.lineHighlightBackground': '#161B22',
        'editor.selectionBackground': '#264F78',
        'editorCursor.foreground': '#E6EDF3',
        'editorWhitespace.foreground': '#3B3B3B',
        'editorLineNumber.foreground': '#6E7681',
        'editorLineNumber.activeForeground': '#E6EDF3',
    }
};

export const githubLightTheme = {
    base: 'vs',
    inherit: true,
    rules: [
        { token: '', foreground: '24292F' },
        { token: 'comment', foreground: '6E7781', fontStyle: 'italic' },
        { token: 'string', foreground: '0A3069' },
        { token: 'number', foreground: '0550AE' },
        { token: 'keyword', foreground: 'CF222E' },
        { token: 'operator', foreground: 'CF222E' },
        { token: 'delimiter', foreground: '24292F' },
        { token: 'type', foreground: '953800' },
        { token: 'function', foreground: '8250DF' },
        { token: 'variable', foreground: '953800' },
        { token: 'constant', foreground: '0550AE' },
        { token: 'identifier', foreground: '24292F' },
    ],
    colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#24292F',
        'editor.lineHighlightBackground': '#F6F8FA',
        'editor.selectionBackground': '#B6E3FF',
        'editorCursor.foreground': '#24292F',
        'editorWhitespace.foreground': '#D0D7DE',
        'editorLineNumber.foreground': '#8C959F',
        'editorLineNumber.activeForeground': '#24292F',
    }
};

// ============================================================================
// Night Owl 主题
// ============================================================================

export const nightOwlDarkTheme = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: '', foreground: 'D6DEEB' },
        { token: 'comment', foreground: '637777', fontStyle: 'italic' },
        { token: 'string', foreground: 'ECC48D' },
        { token: 'number', foreground: 'F78C6C' },
        { token: 'keyword', foreground: 'C792EA' },
        { token: 'operator', foreground: 'C792EA' },
        { token: 'delimiter', foreground: 'D6DEEB' },
        { token: 'type', foreground: 'FFCB8B' },
        { token: 'function', foreground: '82AAFF' },
        { token: 'variable', foreground: 'D6DEEB' },
        { token: 'constant', foreground: 'FF5874' },
        { token: 'identifier', foreground: 'D6DEEB' },
    ],
    colors: {
        'editor.background': '#011627',
        'editor.foreground': '#D6DEEB',
        'editor.lineHighlightBackground': '#01121F',
        'editor.selectionBackground': '#1D3B53',
        'editorCursor.foreground': '#80A4C2',
        'editorWhitespace.foreground': '#2E3F51',
        'editorLineNumber.foreground': '#4B6479',
        'editorLineNumber.activeForeground': '#C5E4FD',
    }
};

export const nightOwlLightTheme = {
    base: 'vs',
    inherit: true,
    rules: [
        { token: '', foreground: '403F53' },
        { token: 'comment', foreground: '989FB1', fontStyle: 'italic' },
        { token: 'string', foreground: 'BC5454' },
        { token: 'number', foreground: 'AA0982' },
        { token: 'keyword', foreground: '994CC3' },
        { token: 'operator', foreground: '994CC3' },
        { token: 'delimiter', foreground: '403F53' },
        { token: 'type', foreground: 'C96765' },
        { token: 'function', foreground: '4876D6' },
        { token: 'variable', foreground: '403F53' },
        { token: 'constant', foreground: 'AA0982' },
        { token: 'identifier', foreground: '403F53' },
    ],
    colors: {
        'editor.background': '#FBFBFB',
        'editor.foreground': '#403F53',
        'editor.lineHighlightBackground': '#F0F0F0',
        'editor.selectionBackground': '#E0E0E0',
        'editorCursor.foreground': '#403F53',
        'editorWhitespace.foreground': '#E0E0E0',
        'editorLineNumber.foreground': '#90A7B2',
        'editorLineNumber.activeForeground': '#403F53',
    }
};

// ============================================================================
// Solarized 主题
// ============================================================================

export const solarizedDarkTheme = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: '', foreground: '839496' },
        { token: 'comment', foreground: '586E75', fontStyle: 'italic' },
        { token: 'string', foreground: '2AA198' },
        { token: 'number', foreground: 'D33682' },
        { token: 'keyword', foreground: '859900' },
        { token: 'operator', foreground: '93A1A1' },
        { token: 'delimiter', foreground: '839496' },
        { token: 'type', foreground: 'B58900' },
        { token: 'function', foreground: '268BD2' },
        { token: 'variable', foreground: '839496' },
        { token: 'constant', foreground: 'CB4B16' },
        { token: 'identifier', foreground: '839496' },
    ],
    colors: {
        'editor.background': '#002B36',
        'editor.foreground': '#839496',
        'editor.lineHighlightBackground': '#073642',
        'editor.selectionBackground': '#073642',
        'editorCursor.foreground': '#D30102',
        'editorWhitespace.foreground': '#073642',
        'editorLineNumber.foreground': '#586E75',
        'editorLineNumber.activeForeground': '#93A1A1',
    }
};

export const solarizedLightTheme = {
    base: 'vs',
    inherit: true,
    rules: [
        { token: '', foreground: '657B83' },
        { token: 'comment', foreground: '93A1A1', fontStyle: 'italic' },
        { token: 'string', foreground: '2AA198' },
        { token: 'number', foreground: 'D33682' },
        { token: 'keyword', foreground: '859900' },
        { token: 'operator', foreground: '586E75' },
        { token: 'delimiter', foreground: '657B83' },
        { token: 'type', foreground: 'B58900' },
        { token: 'function', foreground: '268BD2' },
        { token: 'variable', foreground: '657B83' },
        { token: 'constant', foreground: 'CB4B16' },
        { token: 'identifier', foreground: '657B83' },
    ],
    colors: {
        'editor.background': '#FDF6E3',
        'editor.foreground': '#657B83',
        'editor.lineHighlightBackground': '#EEE8D5',
        'editor.selectionBackground': '#EEE8D5',
        'editorCursor.foreground': '#DC322F',
        'editorWhitespace.foreground': '#EEE8D5',
        'editorLineNumber.foreground': '#93A1A1',
        'editorLineNumber.activeForeground': '#586E75',
    }
};

// ============================================================================
// 主题映射表
// ============================================================================

/**
 * 主题映射：将主题名称映射到其 light 和 dark 版本
 */
export const themeVariants = {
    'vs': {
        light: 'vs',
        dark: 'vs-dark',
    },
    'monokai': {
        light: 'monokai-light',
        dark: 'monokai-dark',
    },
    'dracula': {
        light: 'dracula-light',
        dark: 'dracula-dark',
    },
    'one-dark-pro': {
        light: 'one-dark-pro-light',
        dark: 'one-dark-pro-dark',
    },
    'github': {
        light: 'github-light',
        dark: 'github-dark',
    },
    'night-owl': {
        light: 'night-owl-light',
        dark: 'night-owl-dark',
    },
    'solarized': {
        light: 'solarized-light',
        dark: 'solarized-dark',
    },
};

/**
 * 获取主题的特定颜色模式版本
 * @param {string} themeName - 主题名称
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} 主题 ID
 */
export function getThemeVariant(themeName, isDark) {
    const variants = themeVariants[themeName];
    if (!variants) {
        return isDark ? 'vs-dark' : 'vs';
    }
    return isDark ? variants.dark : variants.light;
}

/**
 * 可用主题列表（用于设置页面展示）
 */
export const availableThemes = [
    { id: 'vs', name: 'VS Code' },
    { id: 'monokai', name: 'Monokai' },
    { id: 'dracula', name: 'Dracula' },
    { id: 'one-dark-pro', name: 'One Dark Pro' },
    { id: 'github', name: 'GitHub' },
    { id: 'night-owl', name: 'Night Owl' },
    { id: 'solarized', name: 'Solarized' },
];
