/**
 * 表格气泡工具栏
 * 负责表格的行列操作工具栏以及 IME 空单元格补全逻辑
 */
export class TableBubbleToolbar {
    constructor(editor, viewElement) {
        this._editor = editor;
        this._viewElement = viewElement;
        this._dom = null;
        this._scrollHandler = null;
    }

    setup() {
        this._dom = document.createElement('div');
        this._dom.className = 'table-bubble-toolbar';
        this._dom.innerHTML = `
            <button class="table-bubble-toolbar__btn" data-action="addRowBefore">上插行</button>
            <button class="table-bubble-toolbar__btn" data-action="addRowAfter">下插行</button>
            <button class="table-bubble-toolbar__btn table-bubble-toolbar__btn--danger" data-action="deleteRow">删行</button>
            <span class="table-bubble-toolbar__sep"></span>
            <button class="table-bubble-toolbar__btn" data-action="addColumnBefore">左插列</button>
            <button class="table-bubble-toolbar__btn" data-action="addColumnAfter">右插列</button>
            <button class="table-bubble-toolbar__btn table-bubble-toolbar__btn--danger" data-action="deleteColumn">删列</button>
            <span class="table-bubble-toolbar__sep"></span>
            <button class="table-bubble-toolbar__btn table-bubble-toolbar__btn--danger" data-action="deleteTable">删表格</button>
        `;
        document.body.appendChild(this._dom);

        this._dom.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            this._executeAction(btn.dataset.action);
        });

        this._editor.on('selectionUpdate', () => {
            this._fillEmptyTableCellAtCursor();
            this._updatePosition();
        });

        this._editor.on('blur', () => {
            setTimeout(() => {
                if (!this._dom?.matches(':hover')) {
                    this._hide();
                }
            }, 100);
        });

        this._scrollHandler = () => this._hide();
        this._viewElement?.addEventListener('scroll', this._scrollHandler, { passive: true });
    }

    destroy() {
        if (this._scrollHandler && this._viewElement) {
            this._viewElement.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        this._dom?.remove();
        this._dom = null;
    }

    // ─── 内部方法 ────────────────────────────────────────────────────────────

    _executeAction(action) {
        if (!this._editor) return;
        const commands = {
            addRowBefore:    () => this._editor.chain().focus().addRowBefore().run(),
            addRowAfter:     () => this._editor.chain().focus().addRowAfter().run(),
            deleteRow:       () => this._editor.chain().focus().deleteRow().run(),
            addColumnBefore: () => this._editor.chain().focus().addColumnBefore().run(),
            addColumnAfter:  () => this._editor.chain().focus().addColumnAfter().run(),
            deleteColumn:    () => this._editor.chain().focus().deleteColumn().run(),
            deleteTable:     () => this._editor.chain().focus().deleteTable().run(),
        };
        commands[action]?.();
        setTimeout(() => {
            this._fillEmptyTableCells();
            this._updatePosition();
        }, 10);
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

    _updatePosition() {
        if (!this._editor || !this._dom) return;

        const { $from } = this._editor.state.selection;
        let tableNode = null;
        for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === 'table') {
                tableNode = this._editor.view.nodeDOM($from.before(d));
                break;
            }
        }

        if (!tableNode) {
            this._hide();
            return;
        }

        this._dom.style.visibility = 'hidden';
        this._dom.classList.add('is-visible');

        const cellDOM = this._editor.view.domAtPos($from.pos).node;
        const cellElement = cellDOM?.nodeType === 1
            ? cellDOM.closest('td, th')
            : cellDOM?.parentElement?.closest('td, th');
        const anchorRect = cellElement
            ? cellElement.getBoundingClientRect()
            : tableNode.getBoundingClientRect();
        const toolbarRect = this._dom.getBoundingClientRect();

        let left = anchorRect.left + (anchorRect.width - toolbarRect.width) / 2;
        let top = anchorRect.top - toolbarRect.height - 8;

        left = Math.max(8, Math.min(left, window.innerWidth - toolbarRect.width - 8));
        top = Math.max(8, top);

        this._dom.style.left = `${left}px`;
        this._dom.style.top = `${top}px`;
        this._dom.style.visibility = 'visible';
    }

    _hide() {
        this._dom?.classList.remove('is-visible');
    }
}
