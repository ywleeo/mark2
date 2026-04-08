/**
 * 跨组件拖拽状态（替代 window.__IS_INTERNAL_DRAG__）
 */
let internalDrag = false;

export function setInternalDrag(value) {
    internalDrag = !!value;
}

export function isInternalDrag() {
    return internalDrag;
}
