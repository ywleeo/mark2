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
 * @param {Boolean} options.preventDefault - 可选，是否阻止默认行为（默认 false）
 */
export function addClickHandler(element, handler, options = {}) {
    if (!element || typeof handler !== 'function') {
        return;
    }

    const state = { handled: false };
    const { shouldHandle, preventDefault = false } = options;

    // pointerup 事件处理
    const onPointerUp = (event) => {
        if (!isPrimaryPointerActivation(event)) {
            return;
        }

        if (typeof shouldHandle === 'function' && !shouldHandle(event)) {
            return;
        }

        if (preventDefault) {
            event.preventDefault();
            event.stopPropagation();
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
            if (preventDefault) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }

        if (typeof shouldHandle === 'function' && !shouldHandle(event)) {
            return;
        }

        if (preventDefault) {
            event.preventDefault();
            event.stopPropagation();
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

/**
 * 为元素添加防重复触发的鼠标中键处理。
 * 同时监听 pointerup 与 auxclick，以兼容 WebKit/WebView2 的事件差异。
 * @param {HTMLElement} element - 目标元素
 * @param {Function} handler - 中键回调
 * @param {Object} options - 配置选项
 * @param {Function} options.shouldHandle - 可选，判断是否应该处理事件
 * @param {Boolean} options.preventDefault - 可选，是否阻止默认行为（默认 true）
 * @returns {Function|undefined} 清理函数
 */
export function addMiddleClickHandler(element, handler, options = {}) {
    if (!element || typeof handler !== 'function') {
        return undefined;
    }

    const state = { handled: false };
    const { shouldHandle, preventDefault = true } = options;

    /** 判断并消费一次有效的鼠标中键事件。 */
    const handleEvent = (event) => {
        if (!event || event.button !== 1) return false;
        if (typeof shouldHandle === 'function' && !shouldHandle(event)) return false;
        if (preventDefault) {
            event.preventDefault();
            event.stopPropagation();
        }
        handler(event);
        return true;
    };

    /** 在按下阶段阻止浏览器进入中键自动滚动模式。 */
    const onPointerDown = (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 1) return;
        if (typeof shouldHandle === 'function' && !shouldHandle(event)) return;
        if (preventDefault) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    /** 优先在 pointerup 阶段处理，以获得与普通点击一致的即时反馈。 */
    const onPointerUp = (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 1) return;
        if (!handleEvent(event)) return;
        state.handled = true;
        setTimeout(() => {
            state.handled = false;
        }, 0);
    };

    /** auxclick 作为不派发 PointerEvent 的 WebView 兼容回退。 */
    const onAuxClick = (event) => {
        if (event.button !== 1) return;
        if (state.handled) {
            state.handled = false;
            if (preventDefault) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }
        handleEvent(event);
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('auxclick', onAuxClick);

    return () => {
        element.removeEventListener('pointerdown', onPointerDown);
        element.removeEventListener('pointerup', onPointerUp);
        element.removeEventListener('auxclick', onAuxClick);
    };
}
