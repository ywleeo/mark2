/**
 * 表格右键菜单
 * 负责表格的行列操作菜单以及 IME 空单元格补全逻辑
 */

const TABLE_MENU_ITEMS = [
    { action: 'addRowBefore',    label: '上方插入行' },
    { action: 'addRowAfter',     label: '下方插入行' },
    { action: 'addColumnBefore', label: '左侧插入列' },
    { action: 'addColumnAfter',  label: '右侧插入列' },
    { separator: true },
    { action: 'deleteRow',    label: '删除当前行',   danger: true },
    { action: 'deleteColumn', label: '删除当前列',   danger: true },
    { separator: true },
    { action: 'deleteTable',  label: '删除整个表格', danger: true },
];

export class TableBubbleToolbar {
    constructor(editor, viewElement) {
        this._editor = editor;
        this._viewElement = viewElement;
        this._menuEl = null;
        this._overlayEl = null;
        this._closeHandler = (e) => {
            if (this._menuEl && !this._menuEl.contains(e.target)) this._hide();
        };
        this._keyHandler = (e) => {
            if (e.key === 'Escape') this._hide();
        };
        this._contextMenuHandler = null;
        this._mousedownHandler = null;
    }

    setup() {
        // 阻止右键 mousedown 触发 ProseMirror table 的 cell 拖选
        this._mousedownHandler = (e) => {
            if (e.button !== 2) return;
            const cell = e.target.closest('td, th');
            if (!cell) return;
            if (!this._viewElement?.contains(cell)) return;
            if (cell.closest('.csv-table')) return;
            e.preventDefault();
            e.stopPropagation();
        };
        this._viewElement?.addEventListener('mousedown', this._mousedownHandler, true);

        this._contextMenuHandler = (e) => {
            const cell = e.target.closest('td, th');
            if (!cell) return;
            // 确认在编辑器内的原生表格（非 csv-table）
            if (!this._viewElement?.contains(cell)) return;
            if (cell.closest('.csv-table')) return;

            e.preventDefault();
            e.stopPropagation();

            // 把光标移到右键所在单元格
            const pos = this._editor.view.posAtDOM(cell, 0);
            if (pos != null) {
                this._editor.commands.setTextSelection(pos);
            }

            this._show(e.clientX, e.clientY);
        };

        this._viewElement?.addEventListener('contextmenu', this._contextMenuHandler);

        this._editor.on('selectionUpdate', () => {
            this._fillEmptyTableCellAtCursor();
        });
    }

    destroy() {
        this._hide();
        if (this._mousedownHandler && this._viewElement) {
            this._viewElement.removeEventListener('mousedown', this._mousedownHandler, true);
            this._mousedownHandler = null;
        }
        if (this._contextMenuHandler && this._viewElement) {
            this._viewElement.removeEventListener('contextmenu', this._contextMenuHandler);
            this._contextMenuHandler = null;
        }
    }

    // ─── 内部方法 ────────────────────────────────────────────────────────────

    _show(x, y) {
        this._hide();

        // 透明遮罩：覆盖 editor，阻止菜单显示期间鼠标移动触发 ProseMirror 拖选
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;';
        document.body.appendChild(overlay);
        this._overlayEl = overlay;

        const menu = document.createElement('div');
        menu.className = 'csv-context-menu';

        TABLE_MENU_ITEMS.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'csv-context-menu__separator';
                menu.appendChild(sep);
                return;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'csv-context-menu__item' + (item.danger ? ' csv-context-menu__item--danger' : '');
            btn.textContent = item.label;
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._hide();
                this._executeAction(item.action);
            });
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        this._menuEl = menu;

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

    _hide() {
        if (this._overlayEl) {
            this._overlayEl.remove();
            this._overlayEl = null;
        }
        if (this._menuEl) {
            this._menuEl.remove();
            this._menuEl = null;
        }
        document.removeEventListener('mousedown', this._closeHandler, true);
        document.removeEventListener('keydown', this._keyHandler, true);
    }

    _executeAction(action) {
        if (!this._editor) return;
        // prosemirror-tables 会拒绝把表格删到空，所以只剩一行/一列时直接删整表
        const deleteRowSafe = () => {
            const { rows, cols } = this._getCurrentTableShape();
            if (rows <= 1 || cols === 0) {
                this._editor.chain().focus().deleteTable().run();
            } else {
                this._editor.chain().focus().deleteRow().run();
            }
        };
        const deleteColumnSafe = () => {
            const { rows, cols } = this._getCurrentTableShape();
            if (cols <= 1 || rows === 0) {
                this._editor.chain().focus().deleteTable().run();
            } else {
                this._editor.chain().focus().deleteColumn().run();
            }
        };
        const commands = {
            addRowBefore:    () => this._editor.chain().focus().addRowBefore().run(),
            addRowAfter:     () => this._editor.chain().focus().addRowAfter().run(),
            deleteRow:       deleteRowSafe,
            addColumnBefore: () => this._editor.chain().focus().addColumnBefore().run(),
            addColumnAfter:  () => this._editor.chain().focus().addColumnAfter().run(),
            deleteColumn:    deleteColumnSafe,
            deleteTable:     () => this._editor.chain().focus().deleteTable().run(),
        };
        commands[action]?.();
        setTimeout(() => this._fillEmptyTableCells(), 10);
    }

    /**
     * 取当前光标所在表格的行列数。找不到表格返回 { rows: 0, cols: 0 }。
     */
    _getCurrentTableShape() {
        const { state } = this._editor;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === 'table') {
                const rows = node.childCount;
                const firstRow = rows > 0 ? node.child(0) : null;
                const cols = firstRow ? firstRow.childCount : 0;
                return { rows, cols };
            }
        }
        return { rows: 0, cols: 0 };
    }

    /**
     * 用零宽空格填充所有空的表格单元格，避免 IME 异常
     */
    _fillEmptyTableCells() {
        if (!this._editor) return;
        const { state } = this._editor;
        const { doc, schema } = state;
        const cellTypes = new Set(['tableCell', 'tableHeader']);
        const positions = [];

        doc.descendants((node, pos) => {
            if (cellTypes.has(node.type.name)) {
                node.forEach((child, offset) => {
                    if (child.type.name === 'paragraph' && child.content.size === 0) {
                        positions.push(pos + 1 + offset + 1);
                    }
                });
            }
        });

        if (positions.length === 0) return;

        let tr = state.tr;
        for (let i = positions.length - 1; i >= 0; i--) {
            tr = tr.insert(positions[i], schema.text('\u200B'));
        }
        tr.setMeta('addToHistory', false);
        this._editor.view.dispatch(tr);
    }

    /**
     * 光标移入空单元格时，填充零宽空格
     */
    _fillEmptyTableCellAtCursor() {
        if (!this._editor) return;
        const { state } = this._editor;
        const { $from } = state.selection;
        const cellTypes = new Set(['tableCell', 'tableHeader']);

        for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (cellTypes.has(node.type.name)) {
                const cellPos = $from.before(d);
                node.forEach((child, offset) => {
                    if (child.type.name === 'paragraph' && child.content.size === 0) {
                        const insertPos = cellPos + 1 + offset + 1;
                        const tr = state.tr.insert(insertPos, state.schema.text('\u200B'));
                        tr.setMeta('addToHistory', false);
                        this._editor.view.dispatch(tr);
                    }
                });
                break;
            }
        }
    }
}
