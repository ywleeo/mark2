/** 页宽手柄只处理按住主键的横向拖动，点击与双击不产生操作或文本选区。 */
import { addClickHandler } from '../../utils/PointerHelper.js';

const DRAG_THRESHOLD = 5;

/**
 * 绑定页宽拖动的完整指针生命周期，丢失释放事件时也不会继续跟随鼠标。
 * @param {HTMLElement} handle - 页宽手柄
 * @param {{onStart:Function,onActivate:Function,onMove:Function,onEnd:Function,eventTarget?:EventTarget,documentTarget?:Document}} options - 排版回调与事件宿主
 * @returns {Function} 清理函数，取消尚未完成的拖动
 */
export function setupPageWidthDrag(handle, {
    onStart, onActivate, onMove, onEnd,
    eventTarget = window, documentTarget = document,
}) {
    let gesture = null;

    /** 消费手柄上的点击/选区事件，不影响编辑器正文的交互。 */
    const preventSelection = event => {
        event.preventDefault();
        event.stopPropagation();
    };

    /** 先清理状态再释放捕获，避免 lostpointercapture 重入结束回调。 */
    const finish = event => {
        if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
        const { pointerId } = gesture;
        gesture = null;
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
        onEnd();
    };

    /** 按下只记录候选手势；超过横向距离阈值后才开始调整排版。 */
    const down = event => {
        if (gesture || event.button !== 0 || event.isPrimary === false || !(event.buttons & 1)) return;
        preventSelection(event);
        if (onStart(event) === false) return;
        gesture = { pointerId: event.pointerId, startX: event.clientX, active: false };
        handle.setPointerCapture?.(event.pointerId);
    };

    /** 松开主键后的鼠标移动只结束手势，绝不修改宽度。 */
    const move = event => {
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        if (!(event.buttons & 1)) {
            finish(event);
            return;
        }
        if (!gesture.active) {
            if (Math.abs(event.clientX - gesture.startX) < DRAG_THRESHOLD) return;
            gesture.active = true;
            onActivate();
        }
        event.preventDefault();
        onMove(event);
    };

    /** 窗口失焦或切入后台后，清除可能缺少 pointerup 的手势。 */
    const cancel = () => finish();
    const visibilityChange = () => { if (documentTarget.hidden) cancel(); };
    const clickCleanup = addClickHandler(handle, () => {}, { preventDefault: true });
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('mousedown', preventSelection);
    handle.addEventListener('dblclick', preventSelection);
    handle.addEventListener('selectstart', preventSelection);
    eventTarget.addEventListener('pointermove', move);
    // 捕获阶段收尾，避免手柄的点击拦截阻止 pointerup 冒泡。
    eventTarget.addEventListener('pointerup', finish, true);
    eventTarget.addEventListener('pointercancel', finish, true);
    eventTarget.addEventListener('blur', cancel);
    documentTarget.addEventListener('visibilitychange', visibilityChange);

    /** 卸载时结束手势，并成对移除所有监听。 */
    return () => {
        cancel();
        clickCleanup?.();
        handle.removeEventListener('pointerdown', down);
        handle.removeEventListener('lostpointercapture', finish);
        handle.removeEventListener('mousedown', preventSelection);
        handle.removeEventListener('dblclick', preventSelection);
        handle.removeEventListener('selectstart', preventSelection);
        eventTarget.removeEventListener('pointermove', move);
        eventTarget.removeEventListener('pointerup', finish, true);
        eventTarget.removeEventListener('pointercancel', finish, true);
        eventTarget.removeEventListener('blur', cancel);
        documentTarget.removeEventListener('visibilitychange', visibilityChange);
    };
}
