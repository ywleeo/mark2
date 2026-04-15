import { addClickHandler } from '../utils/PointerHelper.js';

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
        this.tableWrapperElement = null;
        this.emptyStateElement = null;
        this.gridElement = null;
        this.headerWrapperElement = null;
        this.headerElement = null;
        this.viewportElement = null;
        this.visibleRowsElement = null;
        this.spacerElement = null;
        this.virtualState = null;
        this.scrollAnimationFrame = null;
        this.handleViewportScroll = this.handleViewportScroll.bind(this);
        this.viewportResizeObserver = null;
        this.zoomScale = 1;
        this.init();
        this.applyZoom();
    }

    init() {
        this.container.classList.add('spreadsheet-viewer');
        this.container.innerHTML = `
            <div class="spreadsheet-viewer__toolbar">
                <div class="spreadsheet-viewer__tabs" role="tablist" aria-label="工作表"></div>
            </div>
            <div class="spreadsheet-viewer__body">
                <div class="spreadsheet-viewer__table-wrapper" tabindex="0"></div>
                <div class="spreadsheet-viewer__empty-state" aria-hidden="true">
                    暂无可显示的数据
                </div>
            </div>
        `;

        this.sheetTabsElement = this.container.querySelector('.spreadsheet-viewer__tabs');
        this.tableWrapperElement = this.container.querySelector('.spreadsheet-viewer__table-wrapper');
        this.emptyStateElement = this.container.querySelector('.spreadsheet-viewer__empty-state');
    }

    hide() {
        this.container.style.display = 'none';
    }

    show() {
        this.container.style.display = 'flex';
    }

    clear() {
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

        const activeSheet = this.sheets[this.activeSheetIndex];
        if (!activeSheet || !Array.isArray(activeSheet.rows) || activeSheet.rows.length === 0) {
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
        this.virtualState = this.buildVirtualState(normalizedRows);
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

    buildVirtualState(rows) {
        const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
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
        const { rows, columnWidths } = this.virtualState;
        const headerHeight = this.headerWrapperElement ? this.headerWrapperElement.offsetHeight : 0;
        const totalHeight = headerHeight + rows.length * this.getRowHeight();
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
        const { rows, columnCount, columnWidths, renderedRange } = this.virtualState;
        if (!rows.length) {
            this.visibleRowsElement.innerHTML = '';
            return;
        }
        const rowHeight = this.getRowHeight();
        const headerHeight = this.headerWrapperElement ? this.headerWrapperElement.offsetHeight : 0;
        const rawScrollTop = this.viewportElement.scrollTop || 0;
        const scrollTop = Math.max(0, rawScrollTop - headerHeight);
        const viewportHeight = this.viewportElement.clientHeight || 0;
        const start = Math.max(0, Math.floor(scrollTop / rowHeight) - ROW_BUFFER);
        const end = Math.min(rows.length, start + Math.ceil(viewportHeight / rowHeight) + (ROW_BUFFER * 2));

        if (!force && renderedRange.start === start && renderedRange.end === end) {
            return;
        }

        const fragment = document.createDocumentFragment();
        for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
            fragment.appendChild(this.renderRow(rowIndex, rows[rowIndex], columnCount, columnWidths));
        }
        this.visibleRowsElement.innerHTML = '';
        this.visibleRowsElement.appendChild(fragment);
        this.visibleRowsElement.style.transform = `translateY(${headerHeight + start * rowHeight}px)`;
        this.virtualState.renderedRange = { start, end };
    }

    renderRow(rowIndex, rowData, columnCount, columnWidths) {
        const rowElement = document.createElement('div');
        rowElement.className = 'spreadsheet-grid__row';
        rowElement.setAttribute('role', 'row');
        const indexCell = document.createElement('div');
        indexCell.className = 'spreadsheet-grid__cell spreadsheet-grid__cell--index';
        indexCell.textContent = (rowIndex + 1).toString();
        indexCell.style.setProperty('--col-width', `${ROW_INDEX_COLUMN_WIDTH}px`);
        rowElement.appendChild(indexCell);

        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const cell = document.createElement('div');
            cell.className = 'spreadsheet-grid__cell';
            cell.style.setProperty('--col-width', `${columnWidths[columnIndex] || 120}px`);
            const value = rowData?.[columnIndex] ?? '';
            cell.textContent = value;
            rowElement.appendChild(cell);
        }
        return rowElement;
    }
}
