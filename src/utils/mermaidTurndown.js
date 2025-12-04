// Mermaid 图表相关的 Turndown 转换规则

// 辅助函数：检查节点是否有指定 class
const hasClass = (node, className) => {
    if (!node) return false;
    if (node.classList && typeof node.classList.contains === 'function') {
        return node.classList.contains(className);
    }
    const classAttr = node.getAttribute ? node.getAttribute('class') : null;
    if (!classAttr) return false;
    return classAttr.split(/\s+/).includes(className);
};

// 判断是否为 Mermaid 节点
function isMermaidNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const tagName = (node.nodeName || '').toLowerCase();
    if (tagName !== 'div') return false;
    return hasClass(node, 'mermaid');
}

// 读取 Mermaid 代码
function readMermaidCode(node) {
    if (!node) return '';

    const codeAttr = node.getAttribute ? node.getAttribute('data-mermaid-code') : '';
    if (codeAttr) {
        try {
            return decodeURIComponent(codeAttr);
        } catch (_error) {
            return codeAttr;
        }
    }

    const source = node.querySelector ? node.querySelector('.mermaid-source') : null;
    if (source && typeof source.textContent === 'string') {
        return source.textContent;
    }

    return node.textContent || '';
}

// Mermaid 节点转换为 Markdown
function mermaidReplacement(node) {
    const text = readMermaidCode(node).trim();
    if (!text) return '';
    return `\n\`\`\`mermaid\n${text}\n\`\`\`\n`;
}

// 添加 Mermaid 转换规则到 TurndownService
export function addMermaidRules(turndownService) {
    turndownService.addRule('mermaidBlock', {
        filter: node => isMermaidNode(node),
        replacement: (_content, node) => mermaidReplacement(node),
    });
}

// 导出 Mermaid 相关函数供其他模块使用
export { isMermaidNode, mermaidReplacement };
