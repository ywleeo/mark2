import { Node } from '@tiptap/core';
import { parseCsvToSpreadsheetData, stringifyCSV } from '../utils/csvParser.js';
import { t } from '../i18n/index.js';

function parseCsv(text) {
    const data = parseCsvToSpreadsheetData(text || '');
    const rows = data.sheets[0]?.rows;
    return rows && rows.length > 0 ? rows : [['']];
}

function normalizeCols(rows) {
    const colCount = Math.max(...rows.map(r => r.length), 1);
    return rows.map(r => {
        const padded = [...r];
        while (padded.length < colCount) padded.push('');
        return padded;
    });
}

const MENU_ITEMS = [
    { action: 'addRowBefore', i18nKey: 'table.addRowBefore' },
    { action: 'addRowAfter',  i18nKey: 'table.addRowAfter' },
    { action: 'addColBefore', i18nKey: 'table.addColumnBefore' },
    { action: 'addColAfter',  i18nKey: 'table.addColumnAfter' },
    { separator: true },
    { action: 'deleteRow', i18nKey: 'table.deleteRow', danger: true },
    { action: 'deleteCol', i18nKey: 'table.deleteColumn', danger: true },
];

class CsvContextMenu {
    constructor(onAction) {
        this._onAction = onAction;
        this._el = null;
        this._closeHandler = (e) => {
            if (this._el && !this._el.contains(e.target)) this.hide();
        };
        this._keyHandler = (e) => {
            if (e.key === 'Escape') this.hide();
        };
    }

    show(x, y) {
        this.hide();

        const menu = document.createElement('div');
        menu.className = 'csv-context-menu';

        MENU_ITEMS.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'csv-context-menu__separator';
                menu.appendChild(sep);
                return;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'csv-context-menu__item' + (item.danger ? ' csv-context-menu__item--danger' : '');
            btn.textContent = t(item.i18nKey);
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                this.hide();
                this._onAction(item.action);
            });
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        this._el = menu;

        // 定位，防止超出视口
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const rect = menu.getBoundingClientRect();
        menu.style.left = Math.min(x, vw - rect.width - 8) + 'px';
        menu.style.top  = Math.min(y, vh - rect.height - 8) + 'px';

        setTimeout(() => {
            document.addEventListener('mousedown', this._closeHandler, true);
            document.addEventListener('keydown', this._keyHandler, true);
        }, 0);
    }

    hide() {
        if (this._el) {
            this._el.remove();
            this._el = null;
        }
        document.removeEventListener('mousedown', this._closeHandler, true);
        document.removeEventListener('keydown', this._keyHandler, true);
    }

    destroy() {
        this.hide();
    }
}

class CsvTableView {
    constructor(node, view, getPos) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this._focusedCell = { row: 0, col: 0 };

        this.dom = document.createElement('div');
        this.dom.className = 'csv-table-node';
        this.dom.setAttribute('contenteditable', 'false');

        this._tableWrapper = document.createElement('div');
        this._tableWrapper.className = 'csv-table-scroll';
        this.dom.appendChild(this._tableWrapper);

        this._contextMenu = new CsvContextMenu(action => this._handleAction(action));

        this._render(node.attrs.csv);
    }

    _render(csvText) {
        const rows = normalizeCols(parseCsv(csvText));
        this._rows = rows;

        const table = document.createElement('table');
        table.className = 'csv-table';

        rows.forEach((row, ri) => {
            const tr = document.createElement('tr');
            row.forEach((cell, ci) => {
                const isHeader = ri === 0;
                const el = document.createElement(isHeader ? 'th' : 'td');
                el.contentEditable = 'true';
                el.spellcheck = false;
                el.textContent = cell;
                el.dataset.row = ri;
                el.dataset.col = ci;
                el.addEventListener('mousedown', e => e.stopPropagation());
                el.addEventListener('click', () => el.focus());
                el.addEventListener('focus', () => {
                    this._focusedCell = { row: ri, col: ci };
                });
                el.addEventListener('blur', () => this._onCellBlur());
                el.addEventListener('keydown', e => this._onKeydown(e, ri, ci));
                el.addEventListener('contextmenu', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._focusedCell = { row: ri, col: ci };
                    this._contextMenu.show(e.clientX, e.clientY);
                });
                tr.appendChild(el);
            });
            table.appendChild(tr);
        });

        this._tableWrapper.innerHTML = '';
        this._tableWrapper.appendChild(table);
        this._table = table;
    }

    _onCellBlur() {
        requestAnimationFrame(() => {
            if (!this.dom.contains(document.activeElement)) {
                this._commit();
            }
        });
    }

    _onKeydown(e, ri, ci) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const cells = this._getAllCells();
            const idx = cells.findIndex(c => +c.dataset.row === ri && +c.dataset.col === ci);
            if (e.shiftKey) {
                if (idx > 0) cells[idx - 1].focus();
            } else if (idx < cells.length - 1) {
                cells[idx + 1].focus();
            } else {
                this._handleAction('addRowAfter');
                requestAnimationFrame(() => {
                    const newCells = this._getAllCells();
                    const firstOfNewRow = newCells.find(c => +c.dataset.row === ri + 1 && +c.dataset.col === 0);
                    firstOfNewRow?.focus();
                });
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this._commit();
            this.view.dom.focus();
        }
    }

    _getAllCells() {
        return Array.from(this._table?.querySelectorAll('th, td') || []);
    }

    _getCsvFromDom() {
        if (!this._table) return '';
        const rows = [];
        this._table.querySelectorAll('tr').forEach(tr => {
            const row = [];
            tr.querySelectorAll('th, td').forEach(cell => row.push(cell.textContent));
            rows.push(row);
        });
        return stringifyCSV(rows);
    }

    _commit() {
        const csv = this._getCsvFromDom();
        if (csv === this.node.attrs.csv) return;
        const pos = this.getPos();
        if (typeof pos !== 'number') return;
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { csv }));
    }

    _handleAction(action) {
        const { row: fr, col: fc } = this._focusedCell;
        const rows = this._rows.map(r => [...r]);
        const colCount = rows[0]?.length || 1;

        switch (action) {
            case 'addRowBefore': rows.splice(fr, 0, Array(colCount).fill('')); break;
            case 'addRowAfter':  rows.splice(fr + 1, 0, Array(colCount).fill('')); break;
            case 'addColBefore': rows.forEach(r => r.splice(fc, 0, '')); break;
            case 'addColAfter':  rows.forEach(r => r.splice(fc + 1, 0, '')); break;
            case 'deleteRow':    if (rows.length > 1) rows.splice(fr, 1); break;
            case 'deleteCol':    if (colCount > 1) rows.forEach(r => r.splice(fc, 1)); break;
        }

        const csv = stringifyCSV(rows);
        const pos = this.getPos();
        if (typeof pos === 'number') {
            this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { csv }));
        }
    }

    update(node) {
        if (node.type !== this.node.type) return false;
        const prev = this.node.attrs.csv;
        this.node = node;
        if (node.attrs.csv !== prev) {
            const focused = this._focusedCell;
            this._render(node.attrs.csv);
            requestAnimationFrame(() => {
                const cell = this._getAllCells().find(
                    c => +c.dataset.row === focused.row && +c.dataset.col === focused.col
                );
                cell?.focus();
            });
        }
        return true;
    }

    stopEvent() { return true; }
    ignoreMutation() { return true; }

    destroy() {
        this._commit();
        this._contextMenu.destroy();
    }
}

export const CsvTableNode = Node.create({
    name: 'csvBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    priority: 51,

    addAttributes() {
        return {
            csv: { default: '' },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-csv-table]',
                getAttrs: el => ({ csv: el.getAttribute('data-csv') || '' }),
            },
        ];
    },

    renderHTML({ node }) {
        return ['div', { 'data-csv-table': 'true', 'data-csv': node.attrs.csv }];
    },

    addNodeView() {
        return ({ node, view, getPos }) => new CsvTableView(node, view, getPos);
    },
});
