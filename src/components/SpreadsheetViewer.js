import * as XLSX from 'xlsx';

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
        this.filenameElement = null;
        this.emptyStateElement = null;
        this.init();
    }

    init() {
        this.container.classList.add('spreadsheet-viewer');
        this.container.innerHTML = `
            <div class="spreadsheet-viewer__toolbar">
                <div class="spreadsheet-viewer__filename"></div>
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
        this.filenameElement = this.container.querySelector('.spreadsheet-viewer__filename');
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
        if (this.sheetTabsElement) {
            this.sheetTabsElement.innerHTML = '';
        }
        if (this.tableWrapperElement) {
            this.tableWrapperElement.innerHTML = '';
        }
        if (this.filenameElement) {
            this.filenameElement.textContent = '';
        }
        if (this.emptyStateElement) {
            this.emptyStateElement.classList.remove('is-hidden');
        }
        this.hide();
    }

    async loadWorkbook(filePath, workbookData) {
        this.currentFile = filePath;
        this.sheets = Array.isArray(workbookData?.sheets) ? workbookData.sheets : [];
        this.activeSheetIndex = 0;
        this.renderFilename();
        this.renderSheetTabs();
        this.renderActiveSheet();
        this.show();
    }

    renderFilename() {
        if (!this.filenameElement) {
            return;
        }
        const fileName = this.currentFile?.split('/').pop() || this.currentFile || '';
        this.filenameElement.textContent = fileName;
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
            button.addEventListener('click', () => {
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
            this.emptyStateElement.classList.remove('is-hidden');
            return;
        }

        this.emptyStateElement.classList.add('is-hidden');
        const normalizedRows = normalizeRows(activeSheet.rows);
        const worksheet = XLSX.utils.aoa_to_sheet(normalizedRows);
        const html = XLSX.utils.sheet_to_html(worksheet, {
            editable: false,
            header: '',
            footer: '',
        });

        const temp = document.createElement('div');
        temp.innerHTML = html;
        const table = temp.querySelector('table');
        this.tableWrapperElement.innerHTML = '';
        if (table) {
            table.classList.add('spreadsheet-viewer__table');
            this.tableWrapperElement.appendChild(table);
        } else {
            this.emptyStateElement.classList.remove('is-hidden');
        }
    }
}
