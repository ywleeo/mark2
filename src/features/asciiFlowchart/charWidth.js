/**
 * 等宽字体下字符显示宽度（East Asian Width 简化版）。
 * 配合 Sarasa Mono SC（CJK 严格 2 倍 ASCII）使用，几何对齐才稳定。
 */

export function charDisplayWidth(ch) {
    const cp = ch.codePointAt(0);
    if (cp == null) return 0;
    // 控制字符 / NULL
    if (cp < 0x20) return 0;
    // ASCII / Latin-1
    if (cp < 0x100) return 1;
    // 制表符 / 几何形状 / 箭头：在 Sarasa Mono SC 中是单宽
    if (cp >= 0x2190 && cp <= 0x2BFF) return 1;
    // CJK 及全角范围
    if (
        (cp >= 0x1100 && cp <= 0x115F) ||         // Hangul Jamo
        (cp >= 0x2E80 && cp <= 0x303E) ||         // CJK Radicals / Symbols
        (cp >= 0x3041 && cp <= 0x33FF) ||         // Hiragana / Katakana / CJK Symbols
        (cp >= 0x3400 && cp <= 0x4DBF) ||         // CJK Ext A
        (cp >= 0x4E00 && cp <= 0x9FFF) ||         // CJK Unified
        (cp >= 0xA000 && cp <= 0xA4CF) ||         // Yi
        (cp >= 0xAC00 && cp <= 0xD7A3) ||         // Hangul Syllables
        (cp >= 0xF900 && cp <= 0xFAFF) ||         // CJK Compat
        (cp >= 0xFE30 && cp <= 0xFE4F) ||         // CJK Compat Forms
        (cp >= 0xFF01 && cp <= 0xFF60) ||         // Fullwidth ASCII
        (cp >= 0xFFE0 && cp <= 0xFFE6)            // Fullwidth signs
    ) return 2;
    return 1;
}

export function strDisplayWidth(s) {
    let w = 0;
    for (const ch of s) w += charDisplayWidth(ch);
    return w;
}
