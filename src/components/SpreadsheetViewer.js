import { addClickHandler } from '../utils/PointerHelper.js';
import {
    hasTextSelectionWithin,
    isCellContentTruncated,
    writeCellValueToCopyEvent,
} from './spreadsheet-viewer/cellInteraction.js';
import {
    calculateGridExtent,
    calculateMergedRegionRect,
    findMergedRegionAtColumn,
    getMergedRegionsForRow,
    getMergedRegionsInWindow,
    normalizeMergedRegions,
} from './spreadsheet-viewer/mergeLayout.js';

const MIN_ZOOM_SCALE = 0.6;
const MAX_ZOOM_SCALE = 2.4;
const BASE_ROW_HEIGHT = 32;
const ROW_BUFFER = 6;
const ROW_INDEX_COLUMN_WIDTH = 60;

function normalizeRows(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows.map((row) => {
        if (!Array.isArray(row)) {
            return [];
        }
        return row.map((cell) => {
            if (cell === null || typeof cell === 'undefined') {
                return '';
            }
            return String(cell);
        });
    });
}

export class SpreadsheetViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentFile = null;
        this.sheets = [];
        this.activeSheetIndex = 0;
        this.sheetTabsElement = null;
        this.bodyElement = null;
        this.tableWrapperElement = null;
        this.emptyStateElement = null;
        this.cellTooltipElement = null;
        this.gridElement = null;
        this.headerWrapperElement = null;
        this.headerElement = null;
        this.viewportElement = null;
        this.visibleRowsElement = null;
        this.spacerElement = null;
        this.virtualState = null;
        this.scrollAnimationFrame = null;
        this.handleViewportScroll = this.handleViewportScroll.bind(this);
        this.handleCellActivation = this.handleCellActivation.bind(this);
        this.handleCellPointerOver = this.handleCellPointerOver.bind(this);
        this.handleCellPointerOut = this.handleCellPointerOut.bind(this);
        this.handleTooltipPointerEnter = this.handleTooltipPointerEnter.bind(this);
        this.handleTooltipPointerLeave = this.handleTooltipPointerLeave.bind(this);
        this.handleViewportCopy = this.handleViewportCopy.bind(this);
        this.viewportResizeObserver = null;
        this.selectedCell = null;
        this.selectedCellElement = null;
        this.hoveredCellElement = null;
        this.tooltipHideTimer = null;
        this.copyFeedbackTimer = null;
        this.zoomScale = 1;
        this.init();
        this.applyZoom();
    }

    init() {
        this.container.classList.add('spreadsheet-viewer');
        this.container.innerHTML = `
            <div class="spreadsheet-viewer__body">
                <div class="spreadsheet-viewer__table-wrapper" tabindex="0"></div>
                <div class="spreadsheet-viewer__cell-tooltip" role="tooltip" aria-hidden="true"></div>
                <div class="spreadsheet-viewer__empty-state" aria-hidden="true">
                    暂无可显示的数据
                </div>
                <div class="spreadsheet-viewer__sheet-bar">
                    <div class="spreadsheet-viewer__tabs" role="tablist" aria-label="工作表"></div>
                </div>
            </div>
        `;

        this.sheetTabsElement = this.container.querySelector('.spreadsheet-viewer__tabs');
        this.bodyElement = this.container.querySelector('.spreadsheet-viewer__body');
        this.tableWrapperElement = this.container.querySelector('.spreadsheet-viewer__table-wrapper');
        this.cellTooltipElement = this.container.querySelector('.spreadsheet-viewer__cell-tooltip');
        this.emptyStateElement = this.container.querySelector('.spreadsheet-viewer__empty-state');
        addClickHandler(this.tableWrapperElement, this.handleCellActivation);
        this.tableWrapperElement.addEventListener('pointerover', this.handleCellPointerOver);
        this.tableWrapperElement.addEventListener('pointerout', this.handleCellPointerOut);
        this.tableWrapperElement.addEventListener('copy', this.handleViewportCopy);
        this.cellTooltipElement.addEventListener('pointerenter', this.handleTooltipPointerEnter);
        this.cellTooltipElement.addEventListener('pointerleave', this.handleTooltipPointerLeave);
    }

    hide() {
        this.container.style.display = 'none';
    }

    show() {
        this.container.style.display = 'flex';
    }

    clear() {
        this.clearCellSelection();
        this.hideCellTooltip();
        this.currentFile = null;
        this.sheets = [];
        this.activeSheetIndex = 0;
        this.disposeViewportObserver();
        if (this.viewportElement) {
            this.viewportElement.removeEventListener('scroll', this.handleViewportScroll);
        }
        if (this.scrollAnimationFrame) {
            window.cancelAnimationFrame(this.scrollAnimationFrame);
            this.scrollAnimationFrame = null;
        }
        this.gridElement = null;
        this.headerWrapperElement = null;
        this.headerElement = null;
        this.viewportElement = null;
        this.visibleRowsElement = null;
        this.spacerElement = null;
        this.virtualState = null;
        if (this.sheetTabsElement) {
            this.sheetTabsElement.innerHTML = '';
        }
        if (this.tableWrapperElement) {
            this.tableWrapperElement.innerHTML = '';
        }
        if (this.emptyStateElement) {
            this.emptyStateElement.classList.remove('is-hidden');
        }
        this.hide();
    }

    async loadWorkbook(filePath, workbookData, options = {}) {
        const { forceReload = false } = options;
        if (!forceReload && this.currentFile === filePath && this.sheets.length > 0) {
            this.show();
            return;
        }
        this.currentFile = filePath;
        this.sheets = Array.isArray(workbookData?.sheets) ? workbookData.sheets : [];
        this.activeSheetIndex = 0;
        this.renderSheetTabs();
        this.renderActiveSheet();
        this.show();
    }

    renderSheetTabs() {
        if (!this.sheetTabsElement) {
            return;
        }

        this.sheetTabsElement.innerHTML = '';

        if (!this.sheets.length) {
            const placeholder = document.createElement('span');
            placeholder.className = 'spreadsheet-viewer__tabs-placeholder';
            placeholder.textContent = '无可用工作表';
            this.sheetTabsElement.appendChild(placeholder);
            return;
        }

        this.sheets.forEach((sheet, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'spreadsheet-viewer__tab';
            if (index === this.activeSheetIndex) {
                button.classList.add('is-active');
            }
            button.textContent = sheet?.name || `Sheet ${index + 1}`;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', index === this.activeSheetIndex ? 'true' : 'false');
            addClickHandler(button, () => {
                if (this.activeSheetIndex !== index) {
                    this.activeSheetIndex = index;
                    this.renderSheetTabs();
                    this.renderActiveSheet();
                }
            });
            this.sheetTabsElement.appendChild(button);
        });
    }

    renderActiveSheet() {
        if (!this.tableWrapperElement || !this.emptyStateElement) {
            return;
        }

        this.clearCellSelection();
        this.hideCellTooltip();

        const activeSheet = this.sheets[this.activeSheetIndex];
        const hasRows = Array.isArray(activeSheet?.rows) && activeSheet.rows.length > 0;
        const hasMerges = Array.isArray(activeSheet?.merges) && activeSheet.merges.length > 0;
        if (!activeSheet || (!hasRows && !hasMerges)) {
            this.tableWrapperElement.innerHTML = '';
            this.disposeViewportObserver();
            if (this.viewportElement) {
                this.viewportElement.removeEventListener('scroll', this.handleViewportScroll);
            }
            if (this.scrollAnimationFrame) {
                window.cancelAnimationFrame(this.scrollAnimationFrame);
                this.scrollAnimationFrame = null;
            }
            this.gridElement = null;
            this.headerWrapperElement = null;
            this.headerElement = null;
            this.viewportElement = null;
            this.visibleRowsElement = null;
            this.spacerElement = null;
            this.virtualState = null;
            this.emptyStateElement.classList.remove('is-hidden');
            return;
        }

        this.emptyStateElement.classList.add('is-hidden');
        const normalizedRows = normalizeRows(activeSheet.rows);
        this.setupGridStructure();
        this.virtualState = this.buildVirtualState(normalizedRows, activeSheet.merges);
        this.renderGridHeader();
        this.updateSpacerHeight();
        this.resetViewportScroll();
        this.renderVisibleRows(true);
    }

    clampZoomScale(value) {
        if (!Number.isFinite(value)) {
            return 1;
        }
        return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, value));
    }

    applyZoom() {
        if (!this.container) {
            return;
        }
        this.container.style.setProperty('--spreadsheet-zoom', this.zoomScale.toString());
        if (this.virtualState) {
            this.updateSpacerHeight();
            this.renderVisibleRows(true);
        }
    }

    setZoomScale(scale) {
        const clamped = this.clampZoomScale(scale);
        if (Math.abs(clamped - this.zoomScale) < 0.01) {
            return;
        }
        this.zoomScale = clamped;
        this.applyZoom();
    }

    setupGridStructure() {
        if (!this.tableWrapperElement) {
            return;
        }
        this.disposeViewportObserver();
        this.hideCellTooltip();
        if (this.viewportElement) {
            this.viewportElement.removeEventListener('scroll', this.handleViewportScroll);
        }
        this.tableWrapperElement.innerHTML = `
            <div class="spreadsheet-grid__header-wrapper">
                <div class="spreadsheet-grid__header"></div>
            </div>
            <div class="spreadsheet-grid__spacer"></div>
            <div class="spreadsheet-grid__visible"></div>
        `;
        this.headerWrapperElement = this.tableWrapperElement.querySelector('.spreadsheet-grid__header-wrapper');
        this.headerElement = this.tableWrapperElement.querySelector('.spreadsheet-grid__header');
        if (this.headerElement) {
            this.headerElement.style.transform = 'translateX(0)';
        }
        this.viewportElement = this.tableWrapperElement;
        this.spacerElement = this.tableWrapperElement.querySelector('.spreadsheet-grid__spacer');
        this.visibleRowsElement = this.tableWrapperElement.querySelector('.spreadsheet-grid__visible');
        this.visibleRowsElement.innerHTML = '';
        this.visibleRowsElement.style.transform = 'translateY(0)';
        this.viewportElement.addEventListener('scroll', this.handleViewportScroll, { passive: true });
        if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
            this.viewportResizeObserver = new window.ResizeObserver(() => {
                this.renderVisibleRows(true);
            });
            this.viewportResizeObserver.observe(this.viewportElement);
        }
    }

    disposeViewportObserver() {
        if (this.viewportResizeObserver) {
            this.viewportResizeObserver.disconnect();
            this.viewportResizeObserver = null;
        }
    }

    /**
     * 建立当前 Sheet 的虚拟滚动状态，并让合并区域参与表格边界计算。
     * @param {Array<Array<string>>} rows - 归一化后的单元格数据。
     * @param {Array<Object>} rawMerges - 后端返回的合并区域。
     * @returns {Object} 虚拟表格状态。
     */
    buildVirtualState(rows, rawMerges = []) {
        const merges = normalizeMergedRegions(rawMerges);
        const { rowCount, columnCount } = calculateGridExtent(rows, merges);
        const columnWidths = new Array(columnCount).fill(120);
        rows.forEach((row) => {
            row.forEach((cell, columnIndex) => {
                const length = cell?.length || 0;
                const approx = Math.min(320, Math.max(80, 16 + (length * 7)));
                columnWidths[columnIndex] = Math.max(columnWidths[columnIndex], approx);
            });
        });
        return {
            rows,
            merges,
            rowCount,
            columnCount,
            columnWidths,
            renderedRange: { start: -1, end: -1 },
        };
    }

    renderGridHeader() {
        if (!this.headerElement || !this.virtualState) {
            return;
        }
        const { columnCount, columnWidths } = this.virtualState;
        const fragments = [];
        fragments.push(this.createHeaderCell('#', { isIndex: true }));
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const label = this.getColumnLabel(columnIndex);
            fragments.push(this.createHeaderCell(label, { width: columnWidths[columnIndex] }));
        }
        this.headerElement.innerHTML = '';
        fragments.forEach(cell => this.headerElement.appendChild(cell));
    }

    createHeaderCell(text, options = {}) {
        const { width = null, isIndex = false } = options;
        const cell = document.createElement('div');
        cell.className = 'spreadsheet-grid__cell spreadsheet-grid__cell--header';
        if (isIndex) {
            cell.classList.add('spreadsheet-grid__cell--index');
            cell.style.setProperty('--col-width', `${ROW_INDEX_COLUMN_WIDTH}px`);
        } else {
            cell.style.setProperty('--col-width', `${Number.isFinite(width) ? width : 120}px`);
        }
        cell.textContent = text;
        return cell;
    }

    getColumnLabel(index) {
        const letters = [];
        let current = index;
        do {
            letters.unshift(String.fromCharCode(65 + (current % 26)));
            current = Math.floor(current / 26) - 1;
        } while (current >= 0);
        return letters.join('');
    }

    getRowHeight() {
        return Math.max(24, Math.round(BASE_ROW_HEIGHT * this.zoomScale));
    }

    updateSpacerHeight() {
        if (!this.spacerElement || !this.virtualState) {
            return;
        }
        const { rowCount, columnWidths } = this.virtualState;
        const headerHeight = this.headerWrapperElement ? this.headerWrapperElement.offsetHeight : 0;
        const totalHeight = headerHeight + rowCount * this.getRowHeight();
        const totalWidth = ROW_INDEX_COLUMN_WIDTH + columnWidths.reduce((sum, w) => sum + w, 0);
        this.spacerElement.style.height = `${totalHeight}px`;
        this.spacerElement.style.width = `${totalWidth * this.zoomScale}px`;
    }

    resetViewportScroll() {
        if (this.viewportElement) {
            this.viewportElement.scrollTop = 0;
            this.viewportElement.scrollLeft = 0;
        }
        if (this.headerElement) {
            this.headerElement.style.transform = 'translateX(0)';
        }
    }

    handleViewportScroll() {
        this.hideCellTooltip();
        if (this.scrollAnimationFrame) {
            window.cancelAnimationFrame(this.scrollAnimationFrame);
        }
        if (this.headerElement && this.viewportElement) {
            const scrollLeft = this.viewportElement.scrollLeft || 0;
            this.headerElement.style.transform = `translateX(${-scrollLeft}px)`;
        }
        this.scrollAnimationFrame = window.requestAnimationFrame(() => {
            this.renderVisibleRows();
        });
    }

    renderVisibleRows(force = false) {
        if (!this.virtualState || !this.viewportElement || !this.visibleRowsElement) {
            return;
        }
        const {
            rows,
            rowCount,
            columnCount,
            columnWidths,
            renderedRange,
        } = this.virtualState;
        if (!rowCount) {
            this.visibleRowsElement.innerHTML = '';
            return;
        }
        const rowHeight = this.getRowHeight();
        const headerHeight = this.headerWrapperElement ? this.headerWrapperElement.offsetHeight : 0;
        const rawScrollTop = this.viewportElement.scrollTop || 0;
        const scrollTop = Math.max(0, rawScrollTop - headerHeight);
        const viewportHeight = this.viewportElement.clientHeight || 0;
        const start = Math.max(0, Math.floor(scrollTop / rowHeight) - ROW_BUFFER);
        const end = Math.min(rowCount, start + Math.ceil(viewportHeight / rowHeight) + (ROW_BUFFER * 2));

        if (!force && renderedRange.start === start && renderedRange.end === end) {
            return;
        }

        const fragment = document.createDocumentFragment();
        this.selectedCellElement = null;
        for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
            fragment.appendChild(this.renderRow(rowIndex, rows[rowIndex], columnCount, columnWidths));
        }
        fragment.appendChild(this.renderMergedCells(start, end, columnWidths, rowHeight));
        this.visibleRowsElement.innerHTML = '';
        this.visibleRowsElement.appendChild(fragment);
        this.visibleRowsElement.style.transform = `translateY(${headerHeight + start * rowHeight}px)`;
        this.virtualState.renderedRange = { start, end };
    }

    renderRow(rowIndex, rowData, columnCount, columnWidths) {
        const rowElement = document.createElement('div');
        rowElement.className = 'spreadsheet-grid__row';
        rowElement.setAttribute('role', 'row');
        rowElement.style.height = `${this.getRowHeight()}px`;
        const indexCell = document.createElement('div');
        indexCell.className = 'spreadsheet-grid__cell spreadsheet-grid__cell--index';
        indexCell.setAttribute('role', 'rowheader');
        indexCell.textContent = (rowIndex + 1).toString();
        indexCell.style.setProperty('--col-width', `${ROW_INDEX_COLUMN_WIDTH}px`);
        rowElement.appendChild(indexCell);

        const rowMerges = getMergedRegionsForRow(this.virtualState?.merges || [], rowIndex);
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const cell = document.createElement('div');
            cell.className = 'spreadsheet-grid__cell';
            cell.setAttribute('role', 'gridcell');
            cell.setAttribute('aria-selected', 'false');
            cell.tabIndex = -1;
            cell.dataset.rowIndex = rowIndex.toString();
            cell.dataset.columnIndex = columnIndex.toString();
            cell.style.setProperty('--col-width', `${columnWidths[columnIndex] || 120}px`);
            const value = rowData?.[columnIndex] ?? '';
            cell.textContent = value;
            const mergedRegion = findMergedRegionAtColumn(rowMerges, columnIndex);
            if (mergedRegion) {
                cell.classList.add('spreadsheet-grid__cell--merge-placeholder');
                cell.setAttribute('aria-hidden', 'true');
            } else if (this.selectedCell?.rowIndex === rowIndex
                && this.selectedCell?.columnIndex === columnIndex) {
                cell.classList.add('is-selected');
                cell.setAttribute('aria-selected', 'true');
                this.selectedCellElement = cell;
            }
            rowElement.appendChild(cell);
        }
        return rowElement;
    }

    /**
     * 为当前虚拟窗口创建独立的合并单元格覆盖层，支持跨窗口的纵向合并。
     * @param {number} startRow - 当前渲染起始行（包含）。
     * @param {number} endRow - 当前渲染结束行（不包含）。
     * @param {Array<number>} columnWidths - 未缩放的列宽。
     * @param {number} rowHeight - 已缩放的固定行高。
     * @returns {HTMLElement} 合并单元格覆盖层。
     */
    renderMergedCells(startRow, endRow, columnWidths, rowHeight) {
        const layer = document.createElement('div');
        layer.className = 'spreadsheet-grid__merge-layer';
        const merges = getMergedRegionsInWindow(
            this.virtualState?.merges || [],
            startRow,
            endRow,
        );

        merges.forEach((region) => {
            layer.appendChild(this.createMergedCell(region, startRow, columnWidths, rowHeight));
        });
        return layer;
    }

    /**
     * 创建一个可选择、可复制并带无障碍跨度信息的合并单元格。
     * @param {Object} region - 已归一化的合并区域。
     * @param {number} renderedStartRow - 当前虚拟窗口起始行。
     * @param {Array<number>} columnWidths - 未缩放的列宽。
     * @param {number} rowHeight - 已缩放的固定行高。
     * @returns {HTMLElement} 合并单元格元素。
     */
    createMergedCell(region, renderedStartRow, columnWidths, rowHeight) {
        const cell = document.createElement('div');
        const rect = calculateMergedRegionRect(
            region,
            columnWidths,
            rowHeight,
            this.zoomScale,
            renderedStartRow,
            ROW_INDEX_COLUMN_WIDTH,
        );
        cell.className = 'spreadsheet-grid__cell spreadsheet-grid__cell--merged';
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-colspan', String(region.endColumn - region.startColumn + 1));
        cell.setAttribute('aria-rowspan', String(region.endRow - region.startRow + 1));
        cell.setAttribute('aria-selected', 'false');
        cell.tabIndex = -1;
        cell.dataset.rowIndex = String(region.startRow);
        cell.dataset.columnIndex = String(region.startColumn);
        cell.style.left = `${rect.left}px`;
        cell.style.top = `${rect.top}px`;
        cell.style.width = `${rect.width}px`;
        cell.style.height = `${rect.height}px`;
        cell.textContent = this.virtualState?.rows?.[region.startRow]?.[region.startColumn] ?? '';

        if (this.selectedCell?.rowIndex === region.startRow
            && this.selectedCell?.columnIndex === region.startColumn) {
            cell.classList.add('is-selected');
            cell.setAttribute('aria-selected', 'true');
            this.selectedCellElement = cell;
        }
        return cell;
    }

    /**
     * 从事件目标解析可选择的数据单元格，排除列标和行号。
     * @param {EventTarget|null} target - 指针事件目标。
     * @returns {HTMLElement|null} 命中的数据单元格。
     */
    getDataCellFromTarget(target) {
        const cell = target?.closest?.('.spreadsheet-grid__cell');
        if (!cell || cell.classList.contains('spreadsheet-grid__cell--header')
            || cell.classList.contains('spreadsheet-grid__cell--index')) {
            return null;
        }
        return cell;
    }

    /**
     * 处理单击选中；若用户正在拖选或双击选词，则保留原生文本选择。
     * @param {PointerEvent|MouseEvent} event - 单元格激活事件。
     */
    handleCellActivation(event) {
        const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
        if (hasTextSelectionWithin(this.viewportElement, selection)) {
            return;
        }

        const cell = this.getDataCellFromTarget(event.target);
        if (!cell) {
            this.clearCellSelection();
            return;
        }

        this.selectCell(cell);
        cell.focus?.({ preventScroll: true });
    }

    /**
     * 将一个数据单元格设为当前选中项。
     * @param {HTMLElement} cell - 需要选中的数据单元格。
     */
    selectCell(cell) {
        if (this.selectedCellElement && this.selectedCellElement !== cell) {
            this.selectedCellElement.classList.remove('is-selected', 'is-copied');
            this.selectedCellElement.setAttribute('aria-selected', 'false');
        }

        const rowIndex = Number.parseInt(cell.dataset.rowIndex, 10);
        const columnIndex = Number.parseInt(cell.dataset.columnIndex, 10);
        if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) {
            return;
        }

        this.selectedCell = {
            rowIndex,
            columnIndex,
            value: this.virtualState?.rows?.[rowIndex]?.[columnIndex] ?? cell.textContent ?? '',
        };
        this.selectedCellElement = cell;
        cell.classList.add('is-selected');
        cell.setAttribute('aria-selected', 'true');
    }

    /**
     * 清除当前单元格选择以及复制反馈状态。
     */
    clearCellSelection() {
        if (this.copyFeedbackTimer) {
            window.clearTimeout(this.copyFeedbackTimer);
            this.copyFeedbackTimer = null;
        }
        if (this.selectedCellElement) {
            this.selectedCellElement.classList.remove('is-selected', 'is-copied');
            this.selectedCellElement.setAttribute('aria-selected', 'false');
        }
        this.selectedCell = null;
        this.selectedCellElement = null;
    }

    /**
     * 在单元格内容被截断时显示完整值浮层。
     * @param {PointerEvent} event - 指针进入事件。
     */
    handleCellPointerOver(event) {
        const cell = this.getDataCellFromTarget(event.target);
        if (!cell || cell === this.hoveredCellElement) {
            return;
        }
        this.hoveredCellElement = cell;
        if (!isCellContentTruncated(cell)) {
            this.hideCellTooltip();
            return;
        }
        this.showCellTooltip(cell);
    }

    /**
     * 在指针真正离开当前单元格时关闭完整内容浮层。
     * @param {PointerEvent} event - 指针离开事件。
     */
    handleCellPointerOut(event) {
        const cell = this.getDataCellFromTarget(event.target);
        if (!cell || cell.contains(event.relatedTarget)) {
            return;
        }
        this.scheduleCellTooltipHide();
    }

    /**
     * 根据单元格位置展示不会撑开虚拟行高的完整内容浮层。
     * @param {HTMLElement} cell - 内容发生截断的单元格。
     */
    showCellTooltip(cell) {
        if (!this.cellTooltipElement || !this.bodyElement) {
            return;
        }

        if (this.tooltipHideTimer) {
            window.clearTimeout(this.tooltipHideTimer);
            this.tooltipHideTimer = null;
        }
        const tooltip = this.cellTooltipElement;
        const bodyRect = this.bodyElement.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const edgeGap = 8;
        const cellGap = 6;
        tooltip.textContent = cell.textContent ?? '';
        tooltip.style.maxWidth = `${Math.max(160, Math.min(520, bodyRect.width - (edgeGap * 2)))}px`;
        tooltip.style.left = `${edgeGap}px`;
        tooltip.style.top = `${edgeGap}px`;
        tooltip.classList.add('is-visible');
        tooltip.setAttribute('aria-hidden', 'false');

        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;
        const preferredLeft = cellRect.left - bodyRect.left;
        const maxLeft = Math.max(edgeGap, bodyRect.width - tooltipWidth - edgeGap);
        const left = Math.min(Math.max(edgeGap, preferredLeft), maxLeft);
        const belowTop = cellRect.bottom - bodyRect.top + cellGap;
        const aboveTop = cellRect.top - bodyRect.top - tooltipHeight - cellGap;
        const maxTop = Math.max(edgeGap, bodyRect.height - tooltipHeight - edgeGap);
        const top = belowTop + tooltipHeight <= bodyRect.height - edgeGap ? belowTop : Math.max(edgeGap, aboveTop);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.min(top, maxTop)}px`;
    }

    /**
     * 隐藏完整内容浮层并释放当前 Hover 引用。
     */
    hideCellTooltip() {
        if (this.tooltipHideTimer) {
            window.clearTimeout(this.tooltipHideTimer);
            this.tooltipHideTimer = null;
        }
        this.hoveredCellElement = null;
        if (!this.cellTooltipElement) {
            return;
        }
        this.cellTooltipElement.classList.remove('is-visible');
        this.cellTooltipElement.setAttribute('aria-hidden', 'true');
        this.cellTooltipElement.textContent = '';
    }

    /**
     * 短暂延迟关闭浮层，让指针可以从单元格跨过间隙进入浮层。
     */
    scheduleCellTooltipHide() {
        if (this.tooltipHideTimer) {
            window.clearTimeout(this.tooltipHideTimer);
        }
        this.tooltipHideTimer = window.setTimeout(() => {
            this.tooltipHideTimer = null;
            this.hideCellTooltip();
        }, 100);
    }

    /**
     * 指针进入浮层时保持其显示，允许滚动或选择完整内容。
     */
    handleTooltipPointerEnter() {
        if (this.tooltipHideTimer) {
            window.clearTimeout(this.tooltipHideTimer);
            this.tooltipHideTimer = null;
        }
    }

    /**
     * 指针离开浮层后立即关闭完整内容提示。
     */
    handleTooltipPointerLeave() {
        this.hideCellTooltip();
    }

    /**
     * 复制选中单元格的完整原始值，同时尊重用户主动选中的局部文本。
     * @param {ClipboardEvent} event - 表格视口触发的复制事件。
     */
    handleViewportCopy(event) {
        if (!this.selectedCell) {
            return;
        }
        const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
        if (hasTextSelectionWithin(this.viewportElement, selection)) {
            return;
        }
        if (!writeCellValueToCopyEvent(event, this.selectedCell.value)) {
            return;
        }

        this.selectedCellElement?.classList.add('is-copied');
        if (this.copyFeedbackTimer) {
            window.clearTimeout(this.copyFeedbackTimer);
        }
        this.copyFeedbackTimer = window.setTimeout(() => {
            this.selectedCellElement?.classList.remove('is-copied');
            this.copyFeedbackTimer = null;
        }, 280);
    }
}
