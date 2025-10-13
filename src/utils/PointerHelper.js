/**
 * 触控板/触摸板点击处理工具
 * 统一解决 macOS 触控板轻点导致的 click 事件重复触发问题
 *
 * 原理：触控板轻点会同时触发 pointerup 和 click 事件，导致回调执行两次
 * 解决：通过状态标记确保只执行一次
 */

/**
 * 检查是否是有效的主指针激活事件
 */
export function isPrimaryPointerActivation(event) {
    if (!event || typeof event.pointerType !== 'string') {
        return false;
    }

    const type = event.pointerType.toLowerCase();

    if (type === 'mouse') {
        return event.button === 0; // 左键
    }

    if (type === 'touch' || type === 'pen') {
        return true;
    }

    return false;
}

/**
 * 为元素添加防重复触发的点击处理
 * @param {HTMLElement} element - 目标元素
 * @param {Function} handler - 点击处理函数
 * @param {Object} options - 配置选项
 * @param {Function} options.shouldHandle - 可选，判断是否应该处理事件（比如检查 target）
 */
export function addClickHandler(element, handler, options = {}) {
    if (!element || typeof handler !== 'function') {
        return;
    }

    const state = { handled: false };
    const { shouldHandle } = options;

    // pointerup 事件处理
    const onPointerUp = (event) => {
        if (!isPrimaryPointerActivation(event)) {
            return;
        }

        if (typeof shouldHandle === 'function' && !shouldHandle(event)) {
            return;
        }

        state.handled = true;
        handler(event);

        // 异步清除状态，防止阻止 click
        setTimeout(() => {
            state.handled = false;
        }, 0);
    };

    // click 事件处理（处理未被 pointerup 触发的情况，如键盘操作）
    const onClick = (event) => {
        if (state.handled) {
            state.handled = false;
            return;
        }

        if (typeof shouldHandle === 'function' && !shouldHandle(event)) {
            return;
        }

        handler(event);
    };

    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('click', onClick);

    // 返回清理函数
    return () => {
        element.removeEventListener('pointerup', onPointerUp);
        element.removeEventListener('click', onClick);
    };
}
