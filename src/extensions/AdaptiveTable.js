import { Table as BaseTable } from '@tiptap/extension-table';
import { tableEditingKey } from '@tiptap/pm/tables';

/** 普通表格可保持合理列宽的最大列数。 */
export const RESPONSIVE_TABLE_MAX_COLUMNS = 6;

/**
 * 统计 ProseMirror 表格的实际网格列数，兼容 colspan。
 *
 * @param {import('@tiptap/pm/model').Node|null|undefined} tableNode - 表格节点。
 * @returns {number} 表格的最大列数。
 */
export function getTableColumnCount(tableNode) {
    if (!tableNode || !Number.isInteger(tableNode.childCount)) return 0;

    let maxColumns = 0;
    for (let rowIndex = 0; rowIndex < tableNode.childCount; rowIndex += 1) {
        const row = tableNode.child(rowIndex);
        let columns = 0;
        for (let cellIndex = 0; cellIndex < row.childCount; cellIndex += 1) {
            const colspan = Number(row.child(cellIndex)?.attrs?.colspan);
            columns += Number.isFinite(colspan) && colspan > 0 ? colspan : 1;
        }
        maxColumns = Math.max(maxColumns, columns);
    }
    return maxColumns;
}

/**
 * 判断表格使用自适应布局还是保留横向滚动。
 * 显式声明宽度的 HTML 表格尊重作者布局，不强制压缩列宽。
 *
 * @param {import('@tiptap/pm/model').Node|null|undefined} tableNode - 表格节点。
 * @param {number} maxResponsiveColumns - 自适应布局允许的最大列数。
 * @returns {'responsive'|'scrollable'} 表格布局模式。
 */
export function resolveTableLayoutMode(
    tableNode,
    maxResponsiveColumns = RESPONSIVE_TABLE_MAX_COLUMNS,
) {
    const explicitWidth = String(tableNode?.attrs?.style || '');
    if (/\b(?:min-)?width\s*:/i.test(explicitWidth)) return 'scrollable';

    const columnCount = getTableColumnCount(tableNode);
    return columnCount > 0 && columnCount <= maxResponsiveColumns
        ? 'responsive'
        : 'scrollable';
}

/**
 * 给 TipTap 的表格 DOM spec 添加布局标识，避免把显示状态写入 Markdown 文档。
 *
 * @param {import('@tiptap/pm/model').DOMOutputSpec} spec - TipTap 原始 DOM spec。
 * @param {'responsive'|'scrollable'} mode - 表格布局模式。
 * @returns {import('@tiptap/pm/model').DOMOutputSpec} 带布局标识的新 DOM spec。
 */
export function decorateTableDomSpec(spec, mode) {
    if (!Array.isArray(spec) || typeof spec[0] !== 'string') return spec;

    const hasAttributes = spec[1] != null
        && typeof spec[1] === 'object'
        && !Array.isArray(spec[1]);
    const attributes = hasAttributes ? spec[1] : {};
    const layoutClass = `tableWrapper--${mode}`;
    const className = [attributes.class, layoutClass].filter(Boolean).join(' ');
    const children = spec.slice(hasAttributes ? 2 : 1);

    return [
        spec[0],
        {
            ...attributes,
            class: className,
            'data-table-layout': mode,
        },
        ...children,
    ];
}

/**
 * 自适应 Markdown 表格扩展。
 * 普通表格不创建嵌套滚动层；超宽表格保留横向滚动，并继续使用现有表格编辑能力。
 */
export const AdaptiveTable = BaseTable.extend({
    addProseMirrorPlugins() {
        const plugins = this.parent?.() ?? [];
        return plugins.map((plugin) => {
            if (plugin.key === tableEditingKey.key && plugin.props?.handleDOMEvents?.mousedown) {
                // 默认无阈值 cell-selection 会把触控板轻点误识别为多格拖选。
                delete plugin.props.handleDOMEvents.mousedown;
            }
            return plugin;
        });
    },

    renderHTML({ node, HTMLAttributes }) {
        const spec = this.parent?.({ node, HTMLAttributes });
        return decorateTableDomSpec(spec, resolveTableLayoutMode(node));
    },
});
