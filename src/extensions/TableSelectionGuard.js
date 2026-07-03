import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { CellSelection, cellAround, inSameTable, tableEditingKey } from '@tiptap/pm/tables';

const DRAG_THRESHOLD_PX = 8;

/**
 * 向上查找鼠标事件所在的表格单元格 DOM。
 * @param {import('@tiptap/pm/view').EditorView} view - ProseMirror 编辑器视图
 * @param {EventTarget|null} target - 鼠标事件目标
 * @returns {HTMLTableCellElement|null}
 */
function findTableCellDom(view, target) {
    for (let node = target; node && node !== view.dom; node = node.parentNode) {
        if (node.nodeName === 'TD' || node.nodeName === 'TH') {
            return node;
        }
    }
    return null;
}

/**
 * 根据鼠标坐标获取当前命中的表格单元格位置。
 * @param {import('@tiptap/pm/view').EditorView} view - ProseMirror 编辑器视图
 * @param {MouseEvent} event - 鼠标事件
 * @returns {import('@tiptap/pm/model').ResolvedPos|null}
 */
function cellUnderMouse(view, event) {
    const mousePos = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
    });
    return mousePos ? cellAround(view.state.doc.resolve(mousePos.pos)) : null;
}

/**
 * 判断鼠标移动是否已经超过表格 cell selection 的启动阈值。
 * @param {MouseEvent} startEvent - 鼠标按下事件
 * @param {MouseEvent} moveEvent - 鼠标移动事件
 * @returns {boolean}
 */
function exceedsDragThreshold(startEvent, moveEvent) {
    const dx = moveEvent.clientX - startEvent.clientX;
    const dy = moveEvent.clientY - startEvent.clientY;
    return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/**
 * 创建带移动阈值的表格 cell selection，避免触控板轻点后的微小漂移误触发多格选中。
 * @param {import('@tiptap/pm/view').EditorView} view - ProseMirror 编辑器视图
 * @param {MouseEvent} startEvent - 鼠标按下事件
 * @returns {boolean}
 */
function handleTableMouseDown(view, startEvent) {
    if (startEvent.button !== 0 || startEvent.ctrlKey || startEvent.metaKey) {
        return false;
    }

    if (!startEvent.shiftKey && (startEvent.buttons & 1) !== 1) {
        return false;
    }

    const startCellDom = findTableCellDom(view, startEvent.target);
    if (!startCellDom) {
        return false;
    }

    let anchorCell = null;
    let selectionStarted = false;

    if (startEvent.shiftKey && view.state.selection instanceof CellSelection) {
        anchorCell = view.state.selection.$anchorCell;
    } else if (startEvent.shiftKey) {
        anchorCell = cellAround(view.state.selection.$anchor);
    } else {
        anchorCell = cellUnderMouse(view, startEvent);
    }

    if (!anchorCell) {
        return true;
    }

    /**
     * 设置当前 cell selection，并标记 tableEditing 状态，确保 ProseMirror 正确绘制 selectedCell。
     * @param {import('@tiptap/pm/model').ResolvedPos} headCell - 当前选区头部单元格
     * @param {boolean} markStarted - 是否写入 tableEditing 进行中状态
     */
    function setCellSelection(headCell, markStarted = false) {
        if (!headCell || !inSameTable(anchorCell, headCell)) {
            return;
        }

        const selection = new CellSelection(anchorCell, headCell);
        if (view.state.selection.eq(selection)) {
            return;
        }

        const tr = view.state.tr.setSelection(selection);
        if (markStarted) {
            tr.setMeta(tableEditingKey, anchorCell.pos);
        }
        view.dispatch(tr);
    }

    /**
     * 结束自定义 cell selection 跟踪。
     */
    function stopTracking() {
        view.root.removeEventListener('mouseup', stopTracking);
        view.root.removeEventListener('dragstart', stopTracking);
        view.root.removeEventListener('mousemove', handleMove);
        if (selectionStarted && tableEditingKey.getState(view.state) != null) {
            view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
        }
    }

    /**
     * 鼠标跨 cell 移动超过阈值后才进入表格多格选择。
     * @param {MouseEvent} moveEvent - 鼠标移动事件
     */
    function handleMove(moveEvent) {
        if ((moveEvent.buttons & 1) !== 1) {
            stopTracking();
            return;
        }

        const headCell = cellUnderMouse(view, moveEvent);
        if (!headCell || !inSameTable(anchorCell, headCell) || headCell.pos === anchorCell.pos) {
            return;
        }

        if (!selectionStarted) {
            if (!exceedsDragThreshold(startEvent, moveEvent)) {
                return;
            }
            selectionStarted = true;
            setCellSelection(headCell, true);
            return;
        }

        setCellSelection(headCell);
    }

    view.root.addEventListener('mouseup', stopTracking);
    view.root.addEventListener('dragstart', stopTracking);
    view.root.addEventListener('mousemove', handleMove);

    if (startEvent.shiftKey) {
        const headCell = cellUnderMouse(view, startEvent);
        if (headCell && headCell.pos !== anchorCell.pos) {
            startEvent.preventDefault();
            selectionStarted = true;
            setCellSelection(headCell, true);
        }
    }

    return false;
}

/**
 * TipTap 扩展：替代 prosemirror-tables 默认无阈值的 cell selection 启动逻辑。
 */
export const TableSelectionGuard = Extension.create({
    name: 'tableSelectionGuard',
    priority: 1000,

    addProseMirrorPlugins() {
        return [
            new Plugin({
                view(view) {
                    /**
                     * 在 ProseMirror 冒泡处理前拦截表格内双击，避免触控板轻点被系统识别成双击后
                     * 触发 prosemirror-tables 的整格/多格选择链路。
                     * @param {MouseEvent} event - 鼠标按下事件
                     */
                    function preventTableDoubleClickMouseDown(event) {
                        if (event.button !== 0 || event.detail < 2) {
                            return;
                        }

                        if (!findTableCellDom(view, event.target)) {
                            return;
                        }

                        event.preventDefault();
                        event.stopImmediatePropagation();
                    }

                    /**
                     * 屏蔽表格内原生双击事件，避免浏览器选词和表格 cell selection 互相叠加。
                     * @param {MouseEvent} event - 双击事件
                     */
                    function preventTableDoubleClick(event) {
                        if (!findTableCellDom(view, event.target)) {
                            return;
                        }

                        event.preventDefault();
                        event.stopImmediatePropagation();
                    }

                    view.dom.addEventListener('mousedown', preventTableDoubleClickMouseDown, true);
                    view.dom.addEventListener('dblclick', preventTableDoubleClick, true);

                    return {
                        destroy() {
                            view.dom.removeEventListener('mousedown', preventTableDoubleClickMouseDown, true);
                            view.dom.removeEventListener('dblclick', preventTableDoubleClick, true);
                        },
                    };
                },
                props: {
                    handleDOMEvents: {
                        mousedown: handleTableMouseDown,
                    },
                },
            }),
        ];
    },
});
