/**
 * Mermaid 视觉主题配置。
 * 图表配色与应用皮肤在这里完成映射，渲染器只负责生成和增强 SVG。
 */

/** Classic 皮肤沿用原有的明快图表配色。 */
const CLASSIC_FLOWCHART_PALETTES = [
    { bg: '#e0edff', border: '#6ea8fe', nodeBg: '#c5dbff', nodeBorder: '#4a90f4', text: '#1a3a6b', label: '#2563eb' },
    { bg: '#ece5ff', border: '#a78bfa', nodeBg: '#ddd3fe', nodeBorder: '#8b6cf6', text: '#3b1d8e', label: '#7c3aed' },
    { bg: '#fef0c7', border: '#f0b429', nodeBg: '#fde68a', nodeBorder: '#e09d13', text: '#78530a', label: '#c27803' },
    { bg: '#d0f5e0', border: '#4ade80', nodeBg: '#a7f3d0', nodeBorder: '#22c55e', text: '#064e2b', label: '#16a34a' },
    { bg: '#ffe0e0', border: '#f87171', nodeBg: '#fecaca', nodeBorder: '#ef4444', text: '#7f1d1d', label: '#dc2626' },
    { bg: '#d5f5fd', border: '#38bdf8', nodeBg: '#b0e9fc', nodeBorder: '#0ea5e9', text: '#0c4a6e', label: '#0284c7' },
];

/** Editorial 浅色图表使用纸张、砖红、鼠尾草与旧金色。 */
const EDITORIAL_LIGHT_FLOWCHART_PALETTES = [
    { bg: '#f3eee4', border: '#b78979', nodeBg: '#eadfd3', nodeBorder: '#9c4b37', text: '#342e27', label: '#8b4030' },
    { bg: '#f3eee4', border: '#9aa18f', nodeBg: '#e3e5da', nodeBorder: '#6f7d68', text: '#342e27', label: '#5f6e59' },
    { bg: '#f3eee4', border: '#b7a17e', nodeBg: '#eee3cc', nodeBorder: '#9a7440', text: '#342e27', label: '#876334' },
    { bg: '#f3eee4', border: '#9a9690', nodeBg: '#e7e2dc', nodeBorder: '#716b64', text: '#342e27', label: '#625c55' },
];

/** Editorial 深色图表保持纸墨反差，并使用低饱和的暖色边框。 */
const EDITORIAL_DARK_FLOWCHART_PALETTES = [
    { bg: '#252a26', border: '#9c6658', nodeBg: '#3a322d', nodeBorder: '#dc866e', text: '#eee9de', label: '#e29a85' },
    { bg: '#252a26', border: '#738174', nodeBg: '#303a32', nodeBorder: '#9cad9a', text: '#eee9de', label: '#afbeac' },
    { bg: '#252a26', border: '#8c795e', nodeBg: '#3b362b', nodeBorder: '#c3a36e', text: '#eee9de', label: '#d1b783' },
    { bg: '#252a26', border: '#777b75', nodeBg: '#333733', nodeBorder: '#a9ada5', text: '#eee9de', label: '#bec1b9' },
];

/** Classic Mermaid 基础变量，深色继续由现有 CSS 滤镜即时适配。 */
const CLASSIC_THEME_VARIABLES = {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '13px',
    background: 'transparent',
    primaryColor: '#eef4ff',
    primaryTextColor: '#2c3e50',
    primaryBorderColor: '#b8d4f0',
    secondaryColor: '#f3eeff',
    secondaryTextColor: '#2c3e50',
    secondaryBorderColor: '#d0c4ef',
    tertiaryColor: '#edf8f0',
    tertiaryTextColor: '#2c3e50',
    tertiaryBorderColor: '#b8e0c8',
    lineColor: '#94a3b8',
    textColor: '#475569',
    noteBkgColor: '#fffbeb',
    noteTextColor: '#64748b',
    noteBorderColor: '#e2d5a0',
    clusterBkg: '#f8fafc',
    clusterBorder: '#cbd5e1',
    pie1: '#5b8ff9', pie2: '#5ad8a6', pie3: '#f6bd16',
    pie4: '#e86452', pie5: '#6dc8ec', pie6: '#945fb9',
    pie7: '#ff9845', pie8: '#1e9493', pie9: '#ff99c3',
    xyChart: {
        titleColor: '#475569',
        xAxisLabelColor: '#64748b',
        yAxisLabelColor: '#64748b',
        xAxisTitleColor: '#475569',
        yAxisTitleColor: '#475569',
        xAxisLineColor: '#e2e8f0',
        yAxisLineColor: '#e2e8f0',
    },
    activationBorderColor: '#5b8ff9',
    edgeLabelBackground: '#ffffffee',
};

/**
 * 生成覆盖常见 Mermaid 图表类型的 Editorial 主题变量。
 * @param {'light'|'dark'} appearance - 当前明暗外观。
 * @returns {object} Mermaid base theme 变量。
 */
function createEditorialThemeVariables(appearance) {
    const dark = appearance === 'dark';
    const ink = dark ? '#eee9de' : '#342e27';
    const muted = dark ? '#b7bdb2' : '#786f63';
    const paper = dark ? '#252a26' : '#f3eee4';
    const surface = dark ? '#303630' : '#eae3d7';
    const accent = dark ? '#dc866e' : '#9c4b37';
    const secondary = dark ? '#303a32' : '#e3e5da';
    const secondaryBorder = dark ? '#9cad9a' : '#6f7d68';
    const tertiary = dark ? '#3b362b' : '#eee3cc';
    const tertiaryBorder = dark ? '#c3a36e' : '#9a7440';
    const note = dark ? '#3d3627' : '#f0e2c3';
    const noteBorder = dark ? '#c3a36e' : '#a47b43';
    const series = dark
        ? ['#dc866e', '#9cad9a', '#c3a36e', '#a9ada5', '#b87564', '#82998d', '#d1b783', '#8f8172', '#c58f80']
        : ['#9c4b37', '#6f7d68', '#9a7440', '#716b64', '#b06b57', '#718a80', '#b18c55', '#8b755c', '#c08472'];

    return {
        fontFamily: 'var(--editor-font-family, "Iowan Old Style", "Songti SC", Georgia, serif)',
        fontSize: '13px',
        background: 'transparent',
        mainBkg: surface,
        primaryColor: dark ? '#3a322d' : '#eadfd3',
        primaryTextColor: ink,
        primaryBorderColor: accent,
        secondaryColor: secondary,
        secondaryTextColor: ink,
        secondaryBorderColor: secondaryBorder,
        tertiaryColor: tertiary,
        tertiaryTextColor: ink,
        tertiaryBorderColor: tertiaryBorder,
        lineColor: muted,
        textColor: ink,
        nodeTextColor: ink,
        labelTextColor: ink,
        edgeLabelBackground: paper,
        clusterBkg: paper,
        clusterBorder: dark ? '#777b75' : '#9a9690',
        titleColor: ink,
        actorBkg: dark ? '#3a322d' : '#eadfd3',
        actorBorder: accent,
        actorTextColor: ink,
        actorLineColor: muted,
        signalColor: muted,
        signalTextColor: ink,
        labelBoxBkgColor: secondary,
        labelBoxBorderColor: secondaryBorder,
        labelTextColor: ink,
        loopTextColor: ink,
        activationBkgColor: surface,
        activationBorderColor: accent,
        noteBkgColor: note,
        noteTextColor: ink,
        noteBorderColor: noteBorder,
        stateBkg: surface,
        stateBorder: accent,
        classText: ink,
        altBackground: dark ? '#2c312d' : '#eee8dd',
        sectionBkgColor: dark ? '#343a34' : '#e6e0d5',
        sectionBkgColor2: paper,
        taskBkgColor: dark ? '#3a322d' : '#eadfd3',
        taskBorderColor: accent,
        taskTextColor: ink,
        activeTaskBkgColor: secondary,
        activeTaskBorderColor: secondaryBorder,
        gridColor: dark ? '#596158' : '#cfc5b7',
        todayLineColor: accent,
        git0: series[0], git1: series[1], git2: series[2], git3: series[3],
        git4: series[4], git5: series[5], git6: series[6], git7: series[7],
        pie1: series[0], pie2: series[1], pie3: series[2],
        pie4: series[3], pie5: series[4], pie6: series[5],
        pie7: series[6], pie8: series[7], pie9: series[8],
        cScale0: series[0], cScale1: series[1], cScale2: series[2],
        cScale3: series[3], cScale4: series[4], cScale5: series[5],
        cScale6: series[6], cScale7: series[7], cScale8: series[8],
        xyChart: {
            titleColor: ink,
            xAxisLabelColor: muted,
            yAxisLabelColor: muted,
            xAxisTitleColor: ink,
            yAxisTitleColor: ink,
            xAxisLineColor: dark ? '#596158' : '#cfc5b7',
            yAxisLineColor: dark ? '#596158' : '#cfc5b7',
            plotColorPalette: series.slice(0, 4).join(', '),
        },
    };
}

/**
 * 按应用皮肤和明暗模式解析完整的 Mermaid 视觉配置。
 * @param {HTMLElement|null} root - 通常为 document.documentElement。
 * @returns {object} 渲染配置与 SVG 后处理参数。
 */
export function resolveMermaidThemeProfile(root = null) {
    const appSkin = root?.dataset?.appSkin === 'editorial' ? 'editorial' : 'classic';
    const appearance = root?.dataset?.themeAppearance === 'dark' ? 'dark' : 'light';
    if (appSkin !== 'editorial') {
        return {
            key: 'classic',
            editorial: false,
            themeVariables: CLASSIC_THEME_VARIABLES,
            flowchartPalettes: CLASSIC_FLOWCHART_PALETTES,
            lineColor: '#94a3b8',
            textColor: '#475569',
            pointFill: '#ffffff',
            hoverColor: '#f59e0b',
            inverseTextColor: '#ffffff',
            nodeRadius: 8,
            sequenceRadius: 6,
            clusterRadius: 12,
            nodeStrokeWidth: '1.5px',
            edgeStrokeWidth: '2px',
        };
    }

    const dark = appearance === 'dark';
    return {
        key: `editorial-${appearance}`,
        editorial: true,
        themeVariables: createEditorialThemeVariables(appearance),
        flowchartPalettes: dark ? EDITORIAL_DARK_FLOWCHART_PALETTES : EDITORIAL_LIGHT_FLOWCHART_PALETTES,
        lineColor: dark ? '#b7bdb2' : '#786f63',
        textColor: dark ? '#eee9de' : '#342e27',
        pointFill: dark ? '#252a26' : '#f3eee4',
        hoverColor: dark ? '#dc866e' : '#9c4b37',
        inverseTextColor: dark ? '#252a26' : '#fff9f1',
        nodeRadius: 3,
        sequenceRadius: 3,
        clusterRadius: 4,
        nodeStrokeWidth: '1.25px',
        edgeStrokeWidth: '1.5px',
    };
}

/**
 * 构造 Mermaid 初始化配置，使所有图表类型共享同一套皮肤变量。
 * @param {object} profile - resolveMermaidThemeProfile 的返回值。
 * @returns {object} Mermaid 初始化参数。
 */
export function createMermaidConfig(profile) {
    return {
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: profile.themeVariables,
        flowchart: {
            curve: 'basis',
            padding: 16,
            nodeSpacing: 40,
            rankSpacing: 50,
            htmlLabels: true,
        },
        sequence: {
            width: 120,
            height: 50,
            actorMargin: 60,
            boxMargin: 8,
            boxTextMargin: 4,
            noteMargin: 10,
            messageMargin: 32,
            actorFontSize: 13,
            actorFontWeight: 500,
            messageFontSize: 12,
            noteFontSize: 11,
            noteAlign: 'center',
        },
        xyChart: {
            width: 800,
            height: 450,
            chartOrientation: 'vertical',
            plotReservedSpacePercent: 60,
        },
    };
}
