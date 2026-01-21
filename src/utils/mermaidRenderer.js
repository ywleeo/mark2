let mermaidPromise = null;
let mermaidInstance = null;
let initialized = false;

// 渲染队列
let renderQueue = [];
let isRendering = false;
const BATCH_SIZE = 2; // 每批渲染数量

// 内存缓存：code hash -> svg string
const svgCache = new Map();

// 简单 hash 函数
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(36);
}

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

// 处理渲染队列
async function processQueue() {
    if (isRendering || renderQueue.length === 0) return;

    isRendering = true;

    // 取出一批元素
    const batch = renderQueue.splice(0, BATCH_SIZE);

    // 并行渲染这一批
    await Promise.all(batch.map(el => renderSingleMermaid(el)));

    isRendering = false;

    // 如果还有待渲染的，用 requestIdleCallback 继续
    if (renderQueue.length > 0) {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => processQueue(), { timeout: 100 });
        } else {
            setTimeout(processQueue, 50);
        }
    }
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

    // 只匹配 bar 行的数值数组（柱状图的数据）
    const barMatch = mermaidCode.match(/bar\s*\[([^\]]+)\]/);

    if (barMatch) {
        return barMatch[1].split(',').map(v => v.trim());
    }

    return [];
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

    // 查找所有 rect 元素（柱状图的条）
    const rects = Array.from(svgElement.querySelectorAll('rect'));

    // 过滤掉背景和坐标轴的 rect，只保留数据条
    // 背景通常宽度很大，数据条的宽度相对小
    const dataRects = rects.filter(rect => {
        const width = parseFloat(rect.getAttribute('width') || 0);
        const height = parseFloat(rect.getAttribute('height') || 0);
        // 过滤掉背景（宽度太大）和太小的元素
        return width < 100 && height > 0;
    });

    // 按 x 坐标从左到右排序（确保顺序和数据一致）
    dataRects.sort((a, b) => {
        const xA = parseFloat(a.getAttribute('x') || 0);
        const xB = parseFloat(b.getAttribute('x') || 0);
        return xA - xB;
    });

    // 预先计算每个柱子的中心 x 坐标
    const barCenters = dataRects.map(rect => {
        const x = parseFloat(rect.getAttribute('x') || 0);
        const width = parseFloat(rect.getAttribute('width') || 0);
        return x + width / 2;
    });

    let currentHighlightIndex = -1;

    // 创建指示器竖线
    const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    indicator.setAttribute('stroke', 'rgba(0, 0, 0, 0.3)');
    indicator.setAttribute('stroke-width', '1');
    indicator.setAttribute('y1', '0');
    indicator.setAttribute('y2', svgElement.getAttribute('height') || '300');
    indicator.style.transition = 'opacity 0.1s ease-out';
    indicator.style.pointerEvents = 'none';
    indicator.style.opacity = '0';
    svgElement.appendChild(indicator);

    // 找到离鼠标最近的柱子
    function findNearestBar(mouseX) {
        let nearestIndex = 0;
        let minDistance = Infinity;

        barCenters.forEach((centerX, index) => {
            const distance = Math.abs(centerX - mouseX);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = index;
            }
        });

        return nearestIndex;
    }

    // 高亮指定的柱子
    function highlightBar(index) {
        // 清除之前的高亮
        if (currentHighlightIndex >= 0 && currentHighlightIndex < dataRects.length) {
            dataRects[currentHighlightIndex].style.opacity = '1';
        }

        // 设置新的高亮
        if (index >= 0 && index < dataRects.length) {
            dataRects[index].style.opacity = '0.8';
            currentHighlightIndex = index;

            // 淡出 -> 移动 -> 淡入
            const centerX = barCenters[index];

            // 淡出
            indicator.style.opacity = '0';

            // 等淡出完成后移动位置并淡入
            setTimeout(() => {
                indicator.setAttribute('x1', centerX);
                indicator.setAttribute('x2', centerX);
                indicator.style.opacity = '1';
            }, 100);
        }
    }

    // 在整个 SVG 上监听鼠标移动
    svgElement.addEventListener('mousemove', (e) => {
        // 获取 SVG 的边界
        const svgRect = svgElement.getBoundingClientRect();
        // 计算鼠标在 SVG 坐标系中的 x 位置
        const mouseX = e.clientX - svgRect.left;

        // 找到最近的柱子
        const nearestIndex = findNearestBar(mouseX);

        // 如果和当前高亮的不同，更新高亮
        if (nearestIndex !== currentHighlightIndex) {
            highlightBar(nearestIndex);
        }

        // 显示 tooltip
        if (nearestIndex >= 0 && nearestIndex < values.length) {
            showTooltip(values[nearestIndex], e);
        }
    });

    // 鼠标离开 SVG 时隐藏 tooltip 和高亮
    svgElement.addEventListener('mouseleave', () => {
        hideTooltip();
        indicator.style.opacity = '0';
        if (currentHighlightIndex >= 0 && currentHighlightIndex < dataRects.length) {
            dataRects[currentHighlightIndex].style.opacity = '1';
            currentHighlightIndex = -1;
        }
    });

    // 设置鼠标样式
    svgElement.style.cursor = 'pointer';
}

// 渲染单个 mermaid 元素
async function renderSingleMermaid(element) {
    if (element.getAttribute('data-processed') === 'true') {
        return;
    }

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
    const cacheKey = hashCode(code);

    // 检查缓存
    const cached = svgCache.get(cacheKey);
    if (cached) {
        element.innerHTML = cached.svg;
        // 保留 minHeight，让内容自然撑起高度，避免滚动位置跳动
        const svgElement = element.querySelector('svg');
        if (svgElement) {
            addTooltipsToNodes(svgElement, code);
        }
        element.setAttribute('data-processed', 'true');
        element.classList.add('mermaid--clickable');
        return;
    }

    try {
        const mermaid = await loadMermaid();
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
        // 保留 minHeight，让内容自然撑起高度

        // 渲染完成后获取实际高度，存入缓存
        const height = element.offsetHeight;
        svgCache.set(cacheKey, { svg, height });
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

    // 先给所有元素设置占位高度（如果有缓存）
    targets.forEach(element => {
        const encodedAttr = element.getAttribute('data-mermaid-code') || '';
        const existingCode = decodeMermaidCode(encodedAttr);
        const sourceNode = element.querySelector('.mermaid-source');
        const rawSource = sourceNode ? sourceNode.textContent : element.textContent || '';
        const raw = existingCode || rawSource;
        const code = raw ? raw.trim() : '';
        if (code) {
            const cacheKey = hashCode(code);
            const cached = svgCache.get(cacheKey);
            if (cached?.height) {
                element.style.minHeight = cached.height + 'px';
            }
        }
    });

    // 添加到渲染队列
    targets.forEach(element => renderQueue.push(element));

    // 启动队列处理
    processQueue();
}
