/**
 * 按结构化 JSON 渲染对齐的 ASCII 流程图。AI 只负责识别结构，几何由代码精确算。
 *
 * 输入 spec:
 * {
 *   direction: 'TD',
 *   nodes: [{ id, text: [行], boxed?: bool, side_note?: 字符串 }],
 *   edges: [{ from, to, label?: 字符串 }]
 * }
 */

import { Canvas } from './Canvas.js';
import { strDisplayWidth } from './charWidth.js';

const SIBLING_GAP = 3;
const PAD_X = 1;

function nodeRenderInfo(node) {
    const lines = (Array.isArray(node.text) ? node.text : [String(node.text ?? '')]).map(l => String(l ?? ''));
    const innerWidth = Math.max(...lines.map(strDisplayWidth), 1);
    const boxed = node.boxed !== false;
    if (boxed) {
        return {
            boxed: true,
            lines,
            innerWidth,
            width: innerWidth + 2 + PAD_X * 2,
            height: lines.length + 2,
        };
    }
    return {
        boxed: false,
        lines,
        innerWidth,
        width: innerWidth,
        height: lines.length,
    };
}

function layoutTree(nodeId, nodeMap, edgesFrom) {
    const node = nodeMap[nodeId];
    if (!node) throw new Error(`node "${nodeId}" not in nodes`);
    const ri = nodeRenderInfo(node);
    const childEdges = edgesFrom[nodeId] || [];

    if (childEdges.length === 0) {
        return {
            node, ri, childEdges,
            childLayouts: [], childOffsets: [],
            subtreeWidth: ri.width,
            nodeRelLeft: 0,
        };
    }

    const childLayouts = childEdges.map(e => layoutTree(e.to, nodeMap, edgesFrom));

    let cursor = 0;
    const childOffsets = [];
    for (const cl of childLayouts) {
        childOffsets.push(cursor);
        cursor += cl.subtreeWidth + SIBLING_GAP;
    }
    cursor -= SIBLING_GAP;
    const childrenSpan = cursor;

    const childCenters = childLayouts.map((cl, i) =>
        childOffsets[i] + cl.nodeRelLeft + Math.floor(cl.ri.width / 2)
    );
    let childrenCenter;
    const n = childCenters.length;
    if (n === 1) {
        childrenCenter = childCenters[0];
    } else if (n % 2 === 1) {
        // 奇数：父中心强制对齐中间子节点，避免 ┬ ┬ 紧挨
        childrenCenter = childCenters[(n - 1) / 2];
    } else {
        // 偶数：用两个中间子节点的中点
        childrenCenter = Math.floor((childCenters[n / 2 - 1] + childCenters[n / 2]) / 2);
    }

    let nodeRelLeft = childrenCenter - Math.floor(ri.width / 2);
    if (nodeRelLeft < 0) {
        const shift = -nodeRelLeft;
        for (let i = 0; i < childOffsets.length; i++) childOffsets[i] += shift;
        nodeRelLeft = 0;
    }
    const subtreeWidth = Math.max(nodeRelLeft + ri.width, childrenSpan + (nodeRelLeft > 0 ? 0 : 0));
    // 上面公式简化：childrenSpan 已是子节点占用宽度。如果父节点更靠右导致 right 更大就用父 right
    const rightEdge = Math.max(nodeRelLeft + ri.width, childOffsets[childOffsets.length - 1] + childLayouts[childLayouts.length - 1].subtreeWidth);

    return {
        node, ri, childEdges,
        childLayouts, childOffsets,
        subtreeWidth: rightEdge,
        nodeRelLeft,
    };
}

function paintNode(cv, x, y, ri) {
    if (!ri.boxed) {
        for (let i = 0; i < ri.lines.length; i++) {
            const line = ri.lines[i];
            const pad = ri.innerWidth - strDisplayWidth(line);
            const lp = Math.floor(pad / 2);
            cv.putText(y + i, x + lp, line);
        }
        return;
    }
    cv.set(y, x, '┌');
    for (let c = 1; c < ri.width - 1; c++) cv.set(y, x + c, '─');
    cv.set(y, x + ri.width - 1, '┐');
    for (let i = 0; i < ri.lines.length; i++) {
        const line = ri.lines[i];
        cv.set(y + 1 + i, x, '│');
        cv.set(y + 1 + i, x + ri.width - 1, '│');
        const pad = ri.innerWidth - strDisplayWidth(line);
        const lp = Math.floor(pad / 2);
        cv.putText(y + 1 + i, x + 1 + PAD_X + lp, line);
    }
    cv.set(y + ri.height - 1, x, '└');
    for (let c = 1; c < ri.width - 1; c++) cv.set(y + ri.height - 1, x + c, '─');
    cv.set(y + ri.height - 1, x + ri.width - 1, '┘');
}

function paint(cv, layout, x, y) {
    const { node, ri, childLayouts, childEdges, childOffsets, nodeRelLeft } = layout;
    const nodeX = x + nodeRelLeft;
    paintNode(cv, nodeX, y, ri);

    if (node.side_note) {
        const midY = y + Math.floor(ri.height / 2);
        cv.putText(midY, nodeX + ri.width + 1, ' ' + node.side_note);
    }

    if (childLayouts.length === 0) return;

    const parentBottom = y + ri.height - 1;
    const parentCenter = nodeX + Math.floor(ri.width / 2);

    if (childLayouts.length === 1) {
        const cl = childLayouts[0];
        const childAbsX = x + childOffsets[0];
        const childCenter = childAbsX + cl.nodeRelLeft + Math.floor(cl.ri.width / 2);
        const labelText = childEdges[0]?.label || '';
        // 父 → 子之间：1 行 │（带 label 写右侧），1 行 │，然后子节点。共 2 行 gap。
        const gap = labelText ? 2 : 2;
        const childY = parentBottom + 1 + gap;

        if (parentCenter === childCenter) {
            cv.drawVLine(parentCenter, parentBottom + 1, childY - 1);
        } else {
            const turnY = parentBottom + 1;
            cv.set(turnY, parentCenter, parentCenter < childCenter ? '└' : '┘');
            cv.drawHLine(turnY, parentCenter, childCenter);
            cv.set(turnY, childCenter, parentCenter < childCenter ? '┐' : '┌');
            cv.drawVLine(childCenter, parentBottom + 2, childY - 1);
        }

        if (labelText) {
            cv.putText(parentBottom + 1, parentCenter + 2, ' ' + labelText);
        }
        paint(cv, cl, childAbsX, childY);
        return;
    }

    // 多子
    const fanRow = parentBottom + 1; // │
    const busRow = parentBottom + 2; // 横向汇合
    const dropRow = parentBottom + 3; // │ 到各子（如有 label 在再下一行）

    const childCenters = childLayouts.map((cl, i) =>
        x + childOffsets[i] + cl.nodeRelLeft + Math.floor(cl.ri.width / 2)
    );
    const leftMost = Math.min(...childCenters, parentCenter);
    const rightMost = Math.max(...childCenters, parentCenter);

    cv.set(fanRow, parentCenter, '│');

    cv.drawHLine(busRow, leftMost, rightMost);
    cv.set(busRow, leftMost, '┌');
    cv.set(busRow, rightMost, '┐');
    if (parentCenter !== leftMost && parentCenter !== rightMost) {
        cv.set(busRow, parentCenter, '┬');
    } else if (parentCenter === leftMost) {
        cv.set(busRow, parentCenter, '┌');
    } else {
        cv.set(busRow, parentCenter, '┐');
    }
    for (const cc of childCenters) {
        if (cc === leftMost || cc === rightMost || cc === parentCenter) continue;
        cv.set(busRow, cc, '┬');
    }
    for (const cc of childCenters) cv.set(dropRow, cc, '│');

    const hasLabel = childEdges.some(e => e?.label);
    const labelRow = dropRow + 1;
    const childY = hasLabel ? dropRow + 2 : dropRow + 1;

    if (hasLabel) {
        for (let i = 0; i < childLayouts.length; i++) {
            const lbl = childEdges[i]?.label;
            if (!lbl) continue;
            const lblW = strDisplayWidth(lbl);
            const cc = childCenters[i];
            cv.putText(labelRow, cc - Math.floor(lblW / 2), lbl);
        }
    }

    for (let i = 0; i < childLayouts.length; i++) {
        paint(cv, childLayouts[i], x + childOffsets[i], childY);
    }
}

export function renderFlowchart(spec) {
    if (!spec || !Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) {
        throw new Error('invalid spec: need nodes[] and edges[]');
    }
    const nodeMap = {};
    for (const n of spec.nodes) nodeMap[n.id] = n;

    const edgesFrom = {};
    const incoming = {};
    for (const n of spec.nodes) incoming[n.id] = 0;
    for (const e of spec.edges) {
        if (!nodeMap[e.from] || !nodeMap[e.to]) continue;
        (edgesFrom[e.from] ||= []).push(e);
        incoming[e.to] = (incoming[e.to] || 0) + 1;
    }

    const roots = spec.nodes.filter(n => (incoming[n.id] || 0) === 0).map(n => n.id);
    if (roots.length === 0) throw new Error('no root node');
    const rootId = roots[0];

    const tree = layoutTree(rootId, nodeMap, edgesFrom);
    const cv = new Canvas();
    paint(cv, tree, 0, 0);
    return cv.toString();
}
