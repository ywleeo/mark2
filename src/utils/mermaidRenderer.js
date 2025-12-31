let mermaidPromise = null;
let mermaidInstance = null;
let initialized = false;

async function loadMermaid() {
    if (mermaidInstance) {
        return mermaidInstance;
    }
    if (!mermaidPromise) {
        mermaidPromise = import('mermaid')
            .then(module => {
                const mermaid = module?.default || module;
                if (!initialized) {
                    mermaid.initialize({
                        startOnLoad: false,
                        securityLevel: 'strict',
                    });
                    initialized = true;
                }
                mermaidInstance = mermaid;
                return mermaidInstance;
            })
            .catch(error => {
                mermaidPromise = null;
                throw error;
            });
    }
    return mermaidPromise;
}

const decodeMermaidCode = value => {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch (_error) {
        return value;
    }
};

const encodeMermaidCode = value => {
    if (!value) return '';
    try {
        return encodeURIComponent(value);
    } catch (_error) {
        return value;
    }
};

// 从 mermaid 代码中解析数值
function parseChartValues(mermaidCode) {
    if (!mermaidCode) return [];

    const values = [];
    // 匹配 bar 和 line 行的数值数组
    const barMatch = mermaidCode.match(/bar\s*\[([^\]]+)\]/);
    const lineMatch = mermaidCode.match(/line\s*\[([^\]]+)\]/);

    if (barMatch) {
        const barValues = barMatch[1].split(',').map(v => v.trim());
        values.push(...barValues);
    }
    if (lineMatch) {
        const lineValues = lineMatch[1].split(',').map(v => v.trim());
        values.push(...lineValues);
    }

    return values;
}

// 创建浮层 tooltip 元素
function createTooltipElement() {
    let tooltip = document.getElementById('mermaid-chart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'mermaid-chart-tooltip';
        tooltip.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 14px;
            pointer-events: none;
            z-index: 10000;
            display: none;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        `;
        document.body.appendChild(tooltip);
    }
    return tooltip;
}

// 格式化数字，添加千位分隔符
function formatNumber(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toLocaleString('en-US');
}

// 显示 tooltip
function showTooltip(value, event) {
    const tooltip = createTooltipElement();
    tooltip.textContent = formatNumber(value);
    tooltip.style.display = 'block';
    tooltip.style.left = event.clientX + 10 + 'px';
    tooltip.style.top = event.clientY + 10 + 'px';
}

// 隐藏 tooltip
function hideTooltip() {
    const tooltip = document.getElementById('mermaid-chart-tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}

// 为 mermaid 图表节点添加 hover tooltip
function addTooltipsToNodes(svgElement, mermaidCode) {
    if (!svgElement) return;

    // 解析图表数值
    const values = parseChartValues(mermaidCode);
    console.log('[Tooltip] 解析的数值:', values);

    // 查找所有 rect 元素（柱状图的条）
    const rects = Array.from(svgElement.querySelectorAll('rect'));

    // 过滤掉背景和坐标轴的 rect，只保留数据条
    const dataRects = rects.filter(rect => {
        const height = parseFloat(rect.getAttribute('height') || 0);
        return height > 10;
    });
    console.log('[Tooltip] 数据 rect 数量:', dataRects.length, '数值数量:', values.length);

    // 为每个数据条添加交互事件
    dataRects.forEach((rect, index) => {
        if (index < values.length) {
            const value = values[index];

            // 添加鼠标进入事件
            rect.addEventListener('mouseenter', (e) => {
                showTooltip(value, e);
                rect.style.opacity = '0.8';
                rect.style.cursor = 'pointer';
            });

            // 添加鼠标移动事件（让 tooltip 跟随鼠标）
            rect.addEventListener('mousemove', (e) => {
                showTooltip(value, e);
            });

            // 添加鼠标离开事件
            rect.addEventListener('mouseleave', () => {
                hideTooltip();
                rect.style.opacity = '1';
            });

            console.log(`[Tooltip] rect[${index}] 绑定事件，数值:`, value);
        }
    });
}

export async function renderMermaidIn(rootElement) {
    if (typeof window === 'undefined' || !rootElement) {
        return;
    }

    const matchesMermaid = typeof rootElement.matches === 'function' && rootElement.matches('.mermaid');
    const fromRoot = matchesMermaid ? [rootElement] : [];
    const fromChildren = typeof rootElement.querySelectorAll === 'function'
        ? Array.from(rootElement.querySelectorAll('.mermaid'))
        : [];
    const candidates = [...fromRoot, ...fromChildren];

    const targets = candidates.filter(element => {
        const processed = element.getAttribute('data-processed');
        return processed !== 'true';
    });

    if (targets.length === 0) {
        return;
    }

    const mermaid = await loadMermaid();

    await Promise.all(targets.map(async element => {
        const encodedAttr = element.getAttribute('data-mermaid-code') || '';
        const existingCode = decodeMermaidCode(encodedAttr);
        const sourceNode = element.querySelector('.mermaid-source');
        const rawSource = sourceNode ? sourceNode.textContent : element.textContent || '';
        const raw = existingCode || rawSource;
        const code = raw ? raw.trim() : '';

        if (!code) {
            element.setAttribute('data-processed', 'true');
            return;
        }

        element.setAttribute('data-mermaid-code', encodeMermaidCode(code));

        try {
            element.classList.remove('mermaid--failed');
            const uniqueId =
                element.getAttribute('data-mermaid-id') ||
                `mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            element.setAttribute('data-mermaid-id', uniqueId);
            const { svg } = await mermaid.render(uniqueId, code);
            element.innerHTML = svg;
            const svgElement = element.querySelector('svg');
            if (svgElement) {
                svgElement.removeAttribute('width');
                svgElement.removeAttribute('height');
                svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                svgElement.style.overflow = 'visible';
                svgElement.style.display = 'block';

                // 为节点添加 hover tooltip
                addTooltipsToNodes(svgElement, code);
            }
            element.setAttribute('data-processed', 'true');
            element.classList.add('mermaid--clickable');
        } catch (error) {
            console.warn('[MermaidRenderer] 渲染失败', error);
            element.setAttribute('data-processed', 'true');
            element.classList.add('mermaid--failed');
            element.innerHTML = '';
            const fallback = document.createElement('pre');
            fallback.className = 'mermaid-fallback';
            fallback.textContent = code;
            element.appendChild(fallback);
        }
    }));
}
