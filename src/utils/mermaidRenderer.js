let mermaidPromise = null;
let mermaidInstance = null;

// 内存缓存：code hash -> svg string（包含主题标识）
const svgCache = new Map();

// 把 mermaid 输出 SVG 中的 width="" / height="" 空属性清理掉。
// WebKit 在校验 SVG 属性时对空字符串值会报 console error，需要在注入 DOM 前剔除。
function stripEmptyDimensionAttrs(svgString) {
    if (!svgString) return svgString;
    return svgString.replace(/\s(width|height)\s*=\s*(["'])\s*\2/gi, '');
}

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
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'strict',
                    theme: 'base',
                    themeVariables: {
                        // 基础
                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                        fontSize: '13px',
                        background: 'transparent',
                        // 节点 — 淡蓝系
                        primaryColor: '#eef4ff',
                        primaryTextColor: '#2c3e50',
                        primaryBorderColor: '#b8d4f0',
                        // 节点 — 淡紫系
                        secondaryColor: '#f3eeff',
                        secondaryTextColor: '#2c3e50',
                        secondaryBorderColor: '#d0c4ef',
                        // 节点 — 淡绿系
                        tertiaryColor: '#edf8f0',
                        tertiaryTextColor: '#2c3e50',
                        tertiaryBorderColor: '#b8e0c8',
                        // 线条 — 柔灰
                        lineColor: '#94a3b8',
                        textColor: '#475569',
                        // 特殊
                        noteBkgColor: '#fffbeb',
                        noteTextColor: '#64748b',
                        noteBorderColor: '#e2d5a0',
                        // subgraph
                        clusterBkg: '#f8fafc',
                        clusterBorder: '#cbd5e1',
                        // 饼图 / 柱状图
                        pie1: '#5b8ff9', pie2: '#5ad8a6', pie3: '#f6bd16',
                        pie4: '#e86452', pie5: '#6dc8ec', pie6: '#945fb9',
                        pie7: '#ff9845', pie8: '#1e9493', pie9: '#ff99c3',
                        // XY 图表
                        xyChart: {
                            titleColor: '#475569',
                            xAxisLabelColor: '#64748b',
                            yAxisLabelColor: '#64748b',
                            xAxisTitleColor: '#475569',
                            yAxisTitleColor: '#475569',
                            xAxisLineColor: '#e2e8f0',
                            yAxisLineColor: '#e2e8f0',
                        },
                        // 其他
                        activationBorderColor: '#5b8ff9',
                        edgeLabelBackground: '#ffffffee',
                    },
                    flowchart: {
                        curve: 'basis',
                        padding: 16,
                        nodeSpacing: 40,
                        rankSpacing: 50,
                        htmlLabels: true,
                    },
                    sequence: {
                        // actor 框尺寸：默认 150x65 太大
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
                });
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

// ── 流程图配色方案（每个 subgraph 一套） ──
// 配色设计：light mode 下偏淡，经 dark mode invert 后仍清晰
const FLOWCHART_PALETTES = [
    { bg: '#e0edff', border: '#6ea8fe', nodeBg: '#c5dbff', nodeBorder: '#4a90f4', text: '#1a3a6b', label: '#2563eb' },
    { bg: '#ece5ff', border: '#a78bfa', nodeBg: '#ddd3fe', nodeBorder: '#8b6cf6', text: '#3b1d8e', label: '#7c3aed' },
    { bg: '#fef0c7', border: '#f0b429', nodeBg: '#fde68a', nodeBorder: '#e09d13', text: '#78530a', label: '#c27803' },
    { bg: '#d0f5e0', border: '#4ade80', nodeBg: '#a7f3d0', nodeBorder: '#22c55e', text: '#064e2b', label: '#16a34a' },
    { bg: '#ffe0e0', border: '#f87171', nodeBg: '#fecaca', nodeBorder: '#ef4444', text: '#7f1d1d', label: '#dc2626' },
    { bg: '#d5f5fd', border: '#38bdf8', nodeBg: '#b0e9fc', nodeBorder: '#0ea5e9', text: '#0c4a6e', label: '#0284c7' },
];

/**
 * 自动美化流程图：给 subgraph 和节点分配不同配色
 */
function polishFlowchart(svgElement) {
    const allNodes = svgElement.querySelectorAll('.node');
    if (allNodes.length === 0) return; // 不是 flowchart

    const clusters = svgElement.querySelectorAll('.cluster');

    // 收集每个 cluster 的范围和配色
    const clusterInfos = [];
    clusters.forEach((cluster, i) => {
        const palette = FLOWCHART_PALETTES[i % FLOWCHART_PALETTES.length];
        const rect = cluster.querySelector('rect');
        if (!rect) return;

        // cluster 边框有颜色，背景透明
        rect.style.fill = 'transparent';
        rect.style.stroke = palette.border;
        rect.style.strokeWidth = '1px';
        rect.setAttribute('rx', '12');
        rect.setAttribute('ry', '12');

        // cluster label 样式 + 移到左上角
        const labelEl = cluster.querySelector('.cluster-label');
        if (labelEl) {
            const labelText = labelEl.querySelector('.nodeLabel');
            if (labelText) {
                labelText.style.color = palette.label;
                labelText.style.fontWeight = '600';
                labelText.style.fontSize = '12px';
            }
            // label 的 transform 是绝对坐标，直接改为 rect 左上角
            const rx = parseFloat(rect.getAttribute('x')) || 0;
            const ry = parseFloat(rect.getAttribute('y')) || 0;
            // mermaid 内部有 2x 缩放（label translate 值 ≈ rect 坐标 * 2）
            const existingT = labelEl.getAttribute('transform') || '';
            const tm = existingT.match(/translate\(\s*([^,]+),\s*([^)]+)\)/);
            const rectCenterX = rx + (parseFloat(rect.getAttribute('width')) || 0) / 2;
            if (tm) {
                const curTx = parseFloat(tm[1]);
                const curTy = parseFloat(tm[2]);
                // 推算缩放因子
                const scale = curTy > 0 && ry > 0 ? curTy / ry : (curTx / rectCenterX || 1);
                const newTx = (rx + 12) * scale;
                const newTy = (ry + 4) * scale;
                labelEl.setAttribute('transform', `translate(${newTx}, ${newTy})`);
            }
        }

        // 记录 cluster 范围用于匹配节点
        clusterInfos.push({
            x: parseFloat(rect.getAttribute('x')) || 0,
            y: parseFloat(rect.getAttribute('y')) || 0,
            w: parseFloat(rect.getAttribute('width')) || 0,
            h: parseFloat(rect.getAttribute('height')) || 0,
            palette,
        });
    });

    // 节点不在 cluster DOM 内部，按位置匹配到 cluster
    for (const node of allNodes) {
        const shape = node.querySelector('rect, polygon, circle');
        if (!shape) continue;

        // 获取节点中心位置
        const nBBox = node.getBBox?.();
        if (!nBBox) continue;
        const ncx = nBBox.x + nBBox.width / 2;
        const ncy = nBBox.y + nBBox.height / 2;

        // 找包含该节点的最小 cluster
        let bestCluster = null;
        let bestArea = Infinity;
        for (const ci of clusterInfos) {
            if (ncx >= ci.x && ncx <= ci.x + ci.w && ncy >= ci.y && ncy <= ci.y + ci.h) {
                const area = ci.w * ci.h;
                if (area < bestArea) { bestArea = area; bestCluster = ci; }
            }
        }

        const p = bestCluster ? bestCluster.palette : FLOWCHART_PALETTES[0];
        shape.style.fill = p.nodeBg;
        shape.style.stroke = p.nodeBorder;
        shape.style.strokeWidth = '1.5px';
        shape.setAttribute('rx', '8');
        shape.setAttribute('ry', '8');

        // 节点文字
        const nodeLabel = node.querySelector('.nodeLabel');
        if (nodeLabel) {
            nodeLabel.style.color = p.text;
        }
    }

    // ── 连线加粗 ──
    const allPaths = svgElement.querySelectorAll('.edgePath path, .edgePaths path');
    for (const path of allPaths) {
        path.style.setProperty('stroke-width', '2px', 'important');
    }

    // cluster 边框加粗
    for (const cluster of clusters) {
        const rect = cluster.querySelector('rect');
        if (rect) rect.style.setProperty('stroke-width', '1.5px', 'important');
    }
}

/**
 * 美化 sequence diagram：复用 flowchart 配色，让 actor/note/labelBox 与 flowchart node 风格一致
 */
function polishSequence(svgElement) {
    const actorRects = svgElement.querySelectorAll('rect.actor, g.actor rect');
    if (actorRects.length === 0) return;

    const blue   = FLOWCHART_PALETTES[0]; // actor
    const purple = FLOWCHART_PALETTES[1]; // labelBox (par/loop)
    const yellow = FLOWCHART_PALETTES[2]; // note

    const centerTextInRect = (rect, text) => {
        if (!rect || !text) return;
        const rectY = parseFloat(rect.getAttribute('y') || 0);
        const rectH = parseFloat(rect.getAttribute('height') || 0);
        const rectCenterY = rectY + rectH / 2;
        try {
            const b = text.getBBox();
            if (!b) return;
            const textCenterY = b.y + b.height / 2;
            const offset = rectCenterY - textCenterY;
            if (Math.abs(offset) < 0.5) return;
            const prev = text.getAttribute('transform') || '';
            text.setAttribute('transform', `${prev} translate(0, ${offset.toFixed(2)})`.trim());
        } catch (_) { /* getBBox 偶尔抛错，忽略 */ }
    };

    // ── actor 框（顶部矩形，含底部镜像）──
    actorRects.forEach(rect => {
        rect.style.fill = blue.nodeBg;
        rect.style.stroke = blue.nodeBorder;
        rect.style.strokeWidth = '1.5px';
        rect.setAttribute('rx', '6');
        rect.setAttribute('ry', '6');

        const text = rect.parentNode?.querySelector?.('text.actor');
        centerTextInRect(rect, text);
    });
    svgElement.querySelectorAll('text.actor').forEach(t => {
        t.style.fill = blue.text;
        t.style.fontWeight = '500';
    });

    // actor 之间的虚线竖线
    svgElement.querySelectorAll('line.actor-line').forEach(l => {
        l.style.stroke = '#94a3b8';
        l.style.strokeWidth = '1px';
        l.setAttribute('stroke-dasharray', '4 4');
    });

    // ── note 框 ──
    svgElement.querySelectorAll('rect.note, g.note rect').forEach(rect => {
        rect.style.fill = yellow.nodeBg;
        rect.style.stroke = yellow.nodeBorder;
        rect.style.strokeWidth = '1px';
        rect.setAttribute('rx', '4');
        rect.setAttribute('ry', '4');

        // note 文字垂直居中
        const group = rect.parentNode;
        if (!group) return;
        const texts = group.querySelectorAll('text.noteText, text');
        if (texts.length === 0) return;
        const rectY = parseFloat(rect.getAttribute('y') || 0);
        const rectH = parseFloat(rect.getAttribute('height') || 0);
        const rectCenterY = rectY + rectH / 2;
        let minY = Infinity, maxY = -Infinity;
        texts.forEach(t => {
            try {
                const b = t.getBBox();
                if (!b) return;
                if (b.y < minY) minY = b.y;
                if (b.y + b.height > maxY) maxY = b.y + b.height;
            } catch (_) {}
        });
        if (minY === Infinity) return;
        const textCenterY = (minY + maxY) / 2;
        const offset = rectCenterY - textCenterY;
        if (Math.abs(offset) < 0.5) return;
        texts.forEach(t => {
            const prev = t.getAttribute('transform') || '';
            t.setAttribute('transform', `${prev} translate(0, ${offset.toFixed(2)})`.trim());
        });
    });
    svgElement.querySelectorAll('text.noteText, g.note text').forEach(t => {
        t.style.fill = yellow.text;
    });

    // ── par/loop/alt 标签框 ──
    svgElement.querySelectorAll('rect.labelBox, polygon.labelBox').forEach(el => {
        el.style.fill = purple.nodeBg;
        el.style.stroke = purple.nodeBorder;
        el.style.strokeWidth = '1px';
        if (el.tagName === 'rect') {
            el.setAttribute('rx', '3');
            el.setAttribute('ry', '3');
        }
    });
    svgElement.querySelectorAll('text.labelText').forEach(t => {
        t.style.fill = purple.label;
        t.style.fontWeight = '600';
    });
    svgElement.querySelectorAll('text.loopText, .loopLine + text, .loopLine ~ text').forEach(t => {
        t.style.fill = purple.text;
    });
    svgElement.querySelectorAll('line.loopLine').forEach(l => {
        l.style.stroke = purple.nodeBorder;
        l.style.strokeWidth = '1px';
    });

    // ── 消息箭头 ──
    svgElement.querySelectorAll('line.messageLine0, path.messageLine0').forEach(p => {
        p.style.stroke = '#64748b';
        p.style.strokeWidth = '1.6px';
    });
    svgElement.querySelectorAll('line.messageLine1, path.messageLine1').forEach(p => {
        p.style.stroke = '#64748b';
        p.style.strokeWidth = '1.6px';
        p.setAttribute('stroke-dasharray', '5 4');
    });
    svgElement.querySelectorAll('text.messageText').forEach(t => {
        t.style.fill = '#475569';
    });

    // ── autonumber 圆圈 ──
    svgElement.querySelectorAll('circle').forEach(c => {
        const parent = c.parentNode;
        if (parent?.querySelector?.('text.sequenceNumber')) {
            c.style.fill = blue.nodeBorder;
            c.style.stroke = blue.nodeBorder;
        }
    });
    svgElement.querySelectorAll('text.sequenceNumber').forEach(t => {
        t.style.fill = '#ffffff';
        t.style.fontWeight = '600';
    });

    // ── 激活条 ──
    svgElement.querySelectorAll('rect.activation0, rect.activation1, rect.activation2').forEach(rect => {
        rect.style.fill = blue.bg;
        rect.style.stroke = blue.nodeBorder;
        rect.style.strokeWidth = '0.8px';
        rect.setAttribute('rx', '2');
        rect.setAttribute('ry', '2');
    });
}

/**
 * 移除 mermaid SVG 内部的背景，使其透明融入页面
 */
function stripSvgBackground(svgElement) {
    // 移除 SVG 自身的背景样式
    svgElement.style.backgroundColor = 'transparent';
    // mermaid 常用一个 rect 作为背景（通常是第一个 rect，或 class 含 background）
    const rects = svgElement.querySelectorAll('rect');
    for (const rect of rects) {
        // 只处理全尺寸背景 rect（宽高接近 viewBox 或 100%）
        const width = rect.getAttribute('width');
        const height = rect.getAttribute('height');
        if (width === '100%' || height === '100%' ||
            (parseFloat(width) > 200 && parseFloat(height) > 100 && !rect.closest('g[class*="node"]'))) {
            rect.setAttribute('fill', 'transparent');
            rect.style.fill = 'transparent';
        }
    }
}

/**
 * 自动稀疏过密的坐标轴刻度标签
 */
function thinAxisTicks(svgElement) {
    // mermaid xychart 的轴结构：.left-axis .label text / .bottom-axis .label text
    const yTickTexts = Array.from(svgElement.querySelectorAll('.left-axis .label text'));
    const xTickTexts = Array.from(svgElement.querySelectorAll('.bottom-axis .label text'));

    if (yTickTexts.length > 0 || xTickTexts.length > 0) {
        // Y 轴：根据文字长度动态决定最大数量
        const avgLen = yTickTexts.reduce((s, t) => s + (t.textContent?.length || 0), 0) / (yTickTexts.length || 1);
        const yMax = avgLen > 5 ? 6 : 8;
        thinTickGroup(yTickTexts, 'y', yMax);
        thinTickGroup(xTickTexts, 'x', 10);
        return;
    }

    // 非 xychart 类型，按坐标推断
    thinAxisTicksByPosition(svgElement);
}

function thinTickGroup(texts, axis, maxVisible) {
    if (texts.length <= maxVisible) return;

    const sorted = [...texts].sort((a, b) => {
        const attr = axis === 'y' ? 'y' : 'x';
        return parseFloat(a.getAttribute(attr) || 0) - parseFloat(b.getAttribute(attr) || 0);
    });

    // 整数步进，保证间距完全一致
    const step = Math.ceil(sorted.length / maxVisible);
    const keep = new Set();
    for (let i = 0; i < sorted.length; i += step) {
        keep.add(i);
    }

    for (let i = 0; i < sorted.length; i++) {
        if (!keep.has(i)) {
            sorted[i].textContent = '';
        }
    }

    // 同时清理对应的 tick 线段
    const ticksGroup = sorted[0]?.closest('.left-axis, .bottom-axis')?.querySelector('.ticks');
    if (ticksGroup) {
        const tickLines = Array.from(ticksGroup.querySelectorAll('line'));
        if (tickLines.length === sorted.length) {
            for (let i = 0; i < tickLines.length; i++) {
                if (!keep.has(i)) {
                    tickLines[i].setAttribute('visibility', 'hidden');
                }
            }
        }
    }
}

function thinAxisTicksByPosition(svgElement) {
    const allTexts = Array.from(svgElement.querySelectorAll('text'));
    if (allTexts.length < 8) return;

    // 按 x 坐标分组找 Y 轴标签（同一 x 上的多个 text）
    const xGroups = new Map();
    for (const t of allTexts) {
        const x = Math.round(parseFloat(t.getAttribute('x') || 0));
        if (!xGroups.has(x)) xGroups.set(x, []);
        xGroups.get(x).push(t);
    }

    for (const [, texts] of xGroups) {
        if (texts.length > 10) {
            thinTickGroup(texts, 'y', 8);
        }
    }

    // 按 y 坐标分组找 X 轴标签
    const yGroups = new Map();
    for (const t of allTexts) {
        const y = Math.round(parseFloat(t.getAttribute('y') || 0));
        if (!yGroups.has(y)) yGroups.set(y, []);
        yGroups.get(y).push(t);
    }

    for (const [, texts] of yGroups) {
        if (texts.length > 12) {
            thinTickGroup(texts, 'x', 10);
        }
    }
}

/**
 * 优化 xychart 的柱子宽度和折线平滑度
 */
function polishXYChart(svgElement, mermaidCode) {
    const hasXY = svgElement.querySelector('[class*="bar-plot"], [class*="line-plot"]');
    if (!hasXY) return svgElement;

    // 克隆 SVG 去除 mermaid 绑定的事件监听
    const clone = svgElement.cloneNode(true);
    svgElement.parentNode.replaceChild(clone, svgElement);
    const svg = clone;

    // 获取绘图区域边界（从 plot group 推断）
    const plotGroup = svg.querySelector('g.plot');
    const plotRect = plotGroup ? plotGroup.getBBox() : null;
    const chartTop = plotRect ? plotRect.y : 0;
    const chartBottom = plotRect ? plotRect.y + plotRect.height : 500;

    // ── 收集每列数据 ──
    const columns = []; // [{centerX, barOrigX, barOrigW, bar, barFill, dots:[{dot, stroke}]}]

    // 柱子
    const bars = svg.querySelectorAll('[class*="bar-plot"] rect');
    for (const bar of bars) {
        const origW = parseFloat(bar.getAttribute('width'));
        const origX = parseFloat(bar.getAttribute('x'));
        if (!(origW > 0)) continue;
        // 变窄 + 圆角
        const newW = origW * 0.6;
        bar.setAttribute('width', newW);
        bar.setAttribute('x', origX + (origW - newW) / 2);
        bar.setAttribute('rx', '4');
        bar.setAttribute('ry', '4');
        bar.style.opacity = '0.85';

        const centerX = origX + origW / 2;
        const origFill = bar.getAttribute('fill') || bar.style.fill;
        columns.push({ centerX, bar, barFill: origFill, dots: [] });
    }

    // 折线平滑 + 数据点
    const linePlots = svg.querySelectorAll('[class*="line-plot"]');
    for (const plot of linePlots) {
        const path = plot.querySelector('path');
        if (!path) continue;
        const d = path.getAttribute('d');
        if (!d) continue;

        const points = extractPoints(d);

        // 将折线点的 x 对齐到 bar 的 centerX，再平滑
        const alignedPoints = points.map(([cx, cy], idx) => {
            if (idx < columns.length) return [columns[idx].centerX, cy];
            // 超出列数的点，找最近的列
            let closest = cx, minDist = Infinity;
            for (const col of columns) {
                const dist = Math.abs(col.centerX - cx);
                if (dist < minDist) { minDist = dist; closest = col.centerX; }
            }
            return [closest, cy];
        });

        // 用对齐后的坐标重建 path 再平滑
        const alignedD = 'M' + alignedPoints.map(p => p.join(',')).join(' L');
        const smoothed = smoothLinePath(alignedD);
        if (smoothed) path.setAttribute('d', smoothed);

        const stroke = path.getAttribute('stroke') || path.style.stroke || '#4a90d9';
        for (let pi = 0; pi < alignedPoints.length; pi++) {
            const [cx, cy] = alignedPoints[pi];
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', cx);
            dot.setAttribute('cy', cy);
            dot.setAttribute('r', '4');
            dot.setAttribute('fill', 'white');
            dot.setAttribute('stroke', stroke);
            dot.setAttribute('stroke-width', '2');
            dot.style.transition = 'all 0.15s ease';
            plot.appendChild(dot);

            if (pi < columns.length) {
                columns[pi].dots.push({ dot, stroke });
            }
        }
    }

    // 如果没有 bar 但有折线点，按点的 x 创建列
    if (columns.length === 0) {
        const allDots = svg.querySelectorAll('.xychart-dot');
        // fallback: 不做列 hover
        return;
    }

    // ── 解析数据值用于 tooltip ──
    const barValues = parseChartValues(mermaidCode, 'bar');
    const lineValues = parseChartValues(mermaidCode, 'line');
    const xLabels = parseXLabels(mermaidCode);
    // ── 创建透明竖条热区，覆盖整列 ──
    const hitGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    hitGroup.setAttribute('class', 'xychart-hit-zones');
    svg.appendChild(hitGroup);

    for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const bar = col.bar;
        const barX = parseFloat(bar.getAttribute('x'));
        const barW = parseFloat(bar.getAttribute('width'));
        const hitX = col.centerX - barW;
        const hitW = barW * 2;

        const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hitRect.setAttribute('x', hitX);
        hitRect.setAttribute('y', chartTop);
        hitRect.setAttribute('width', hitW);
        hitRect.setAttribute('height', chartBottom - chartTop);
        hitRect.setAttribute('fill', 'transparent');
        hitRect.style.cursor = 'pointer';
        hitGroup.appendChild(hitRect);

        // tooltip 只显示 bar 值（优先）或 line 值
        const tipText = barValues[i] !== undefined ? formatNumber(barValues[i])
            : lineValues[i] !== undefined ? formatNumber(lineValues[i]) : '';

        hitRect.addEventListener('mouseenter', (e) => {
            for (const { dot } of col.dots) {
                dot.setAttribute('r', '6.5');
                dot.setAttribute('fill', '#f59e0b');
                dot.setAttribute('stroke', '#f59e0b');
                dot.setAttribute('stroke-width', '2.5');
            }
            if (tipText) showTooltip(tipText, e);
        });
        hitRect.addEventListener('mousemove', (e) => {
            if (tipText) showTooltip(tipText, e);
        });
        hitRect.addEventListener('mouseleave', () => {
            for (const { dot, stroke } of col.dots) {
                dot.setAttribute('r', '4');
                dot.setAttribute('fill', 'white');
                dot.setAttribute('stroke', stroke);
                dot.setAttribute('stroke-width', '2');
            }
            hideTooltip();
        });
    }

    return svg;
}

/** 从 SVG path d 属性提取坐标点 */
function extractPoints(d) {
    const points = [];
    const parts = d.replace(/([ML])/g, '\n$1').split('\n').filter(Boolean);
    for (const part of parts) {
        const cmd = part[0];
        const coords = part.slice(1).trim().split(/[\s,]+/).map(Number);
        if ((cmd === 'M' || cmd === 'L') && coords.length >= 2) {
            points.push([coords[0], coords[1]]);
        }
    }
    return points;
}

/**
 * 单调三次样条（Fritsch-Carlson）—— 保证曲线不超调
 */
function smoothLinePath(d) {
    const pts = extractPoints(d);
    const n = pts.length;
    if (n < 3) return null;

    // 计算每段的斜率 delta 和切线 m
    const dx = [], dy = [], delta = [];
    for (let i = 0; i < n - 1; i++) {
        dx[i] = pts[i + 1][0] - pts[i][0];
        dy[i] = pts[i + 1][1] - pts[i][1];
        delta[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
    }

    // 初始切线：三点中心差分
    const m = new Array(n);
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) {
        if (delta[i - 1] * delta[i] <= 0) {
            m[i] = 0; // 单调性改变，切线为 0
        } else {
            m[i] = (delta[i - 1] + delta[i]) / 2;
        }
    }

    // Fritsch-Carlson 修正：保证单调性
    for (let i = 0; i < n - 1; i++) {
        if (Math.abs(delta[i]) < 1e-12) {
            m[i] = 0;
            m[i + 1] = 0;
        } else {
            const alpha = m[i] / delta[i];
            const beta = m[i + 1] / delta[i];
            // 限制在圆内以保证单调
            const s = alpha * alpha + beta * beta;
            if (s > 9) {
                const t = 3 / Math.sqrt(s);
                m[i] = t * alpha * delta[i];
                m[i + 1] = t * beta * delta[i];
            }
        }
    }

    // 生成三次贝塞尔路径
    let result = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
        const seg = dx[i] / 3;
        const cp1x = pts[i][0] + seg;
        const cp1y = pts[i][1] + m[i] * seg;
        const cp2x = pts[i + 1][0] - seg;
        const cp2y = pts[i + 1][1] - m[i + 1] * seg;
        result += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${pts[i + 1][0]},${pts[i + 1][1]}`;
    }
    return result;
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
function parseChartValues(mermaidCode, type = 'bar') {
    if (!mermaidCode) return [];
    const re = new RegExp(type + '\\s*\\[([^\\]]+)\\]');
    const match = mermaidCode.match(re);
    return match ? match[1].split(',').map(v => v.trim()) : [];
}

function parseXLabels(mermaidCode) {
    if (!mermaidCode) return [];
    const match = mermaidCode.match(/x-axis\s*\[([^\]]+)\]/);
    return match ? match[1].split(',').map(v => v.trim().replace(/^["']|["']$/g, '')) : [];
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

// tooltip 生命周期兜底:anchor 被从 DOM 摘掉时(例如关闭 tab),
// 没有 mouseleave 触发,通过 MutationObserver 主动 hide。
let _tooltipAnchor = null;
let _tooltipObserver = null;

// 显示 tooltip
function showTooltip(value, event) {
    const tooltip = createTooltipElement();
    tooltip.textContent = value;
    tooltip.style.display = 'block';
    tooltip.style.left = event.clientX + 10 + 'px';
    tooltip.style.top = event.clientY + 10 + 'px';
    _tooltipAnchor = event?.currentTarget || event?.target || null;
    if (_tooltipAnchor && !_tooltipObserver) {
        _tooltipObserver = new MutationObserver(() => {
            if (!_tooltipAnchor || !_tooltipAnchor.isConnected) hideTooltip();
        });
        _tooltipObserver.observe(document.body, { childList: true, subtree: true });
    }
}

// 隐藏 tooltip
function hideTooltip() {
    const tooltip = document.getElementById('mermaid-chart-tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
    _tooltipAnchor = null;
    if (_tooltipObserver) {
        _tooltipObserver.disconnect();
        _tooltipObserver = null;
    }
}

// 为 mermaid 图表节点添加 hover tooltip
function addTooltipsToNodes(svgElement, mermaidCode) {
    if (!svgElement) return;
    // xychart 的 tooltip 由 polishXYChart 处理
    if (svgElement.querySelector('[class*="bar-plot"], [class*="line-plot"]')) return;

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
        const svgElement = element.querySelector('svg');
        if (svgElement) {
            stripSvgBackground(svgElement);
            polishFlowchart(svgElement);
            polishSequence(svgElement);
            thinAxisTicks(svgElement);
            const polished = polishXYChart(svgElement, code) || svgElement;
            addTooltipsToNodes(polished, code);
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
        // mermaid 某些图（quadrant/pie/xychart）输出的 SVG 含 width=""/height="" 空属性，
        // WebKit 校验 SVG 属性时会报 "Invalid value for <svg> attribute"，先剔除。
        const cleanedSvg = stripEmptyDimensionAttrs(svg);
        element.innerHTML = cleanedSvg;
        const svgElement = element.querySelector('svg');
        if (svgElement) {
            // 不再主动 remove width/height — mermaid 已经用 style="max-width" + viewBox
            // 控制响应式尺寸，多余的 attribute 操作反而会触发 WebKit 的属性校验告警。
            svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svgElement.style.overflow = 'visible';
            svgElement.style.display = 'block';
            svgElement.style.background = 'transparent';

            // 移除 mermaid 内部的背景矩形
            stripSvgBackground(svgElement);
            polishFlowchart(svgElement);
            polishSequence(svgElement);
            thinAxisTicks(svgElement);
            const polished = polishXYChart(svgElement, code) || svgElement;

            // 为节点添加 hover tooltip
            addTooltipsToNodes(polished, code);
        }
        element.setAttribute('data-processed', 'true');
        element.classList.add('mermaid--clickable');
        // 保留 minHeight，让内容自然撑起高度

        // 渲染完成后获取实际高度，存入缓存
        const height = element.offsetHeight;
        svgCache.set(cacheKey, { svg: cleanedSvg, height });
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
        if (processed !== 'true') {
            return true;
        }
        const hasSvg = element.querySelector('svg');
        const failed = element.classList.contains('mermaid--failed');
        if (!hasSvg || failed) {
            element.setAttribute('data-processed', 'false');
            return true;
        }
        return false;
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

    await Promise.all(targets.map(element => renderSingleMermaid(element)));
}

/**
 * 主题切换时调用：清缓存，下次编辑/加载文件时自动用新主题渲染
 */
export function invalidateMermaidTheme() {
    svgCache.clear();
}
