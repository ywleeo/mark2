/**
 * 写作模式运行时状态中心。
 * 编辑器实例只订阅这里的轻量状态，不依赖全局 AppState，也不互相持有引用。
 */

const DEFAULT_WRITING_MODE_STATE = Object.freeze({
    focusMode: false,
    typewriterMode: false,
});

let currentState = DEFAULT_WRITING_MODE_STATE;
const listeners = new Set();

/**
 * 规范化外部传入的写作模式状态。
 * @param {object} candidate - 待规范化状态。
 * @returns {{focusMode:boolean,typewriterMode:boolean}} 稳定的布尔状态。
 */
export function normalizeWritingModeState(candidate = {}) {
    return {
        focusMode: candidate?.focusMode === true,
        typewriterMode: candidate?.typewriterMode === true,
    };
}

/**
 * 读取当前写作模式快照。
 * @returns {{focusMode:boolean,typewriterMode:boolean}} 不可变状态快照。
 */
export function getWritingModeState() {
    return currentState;
}

/**
 * 更新写作模式，并仅在状态真正变化时通知编辑器。
 * @param {object} candidate - 新状态。
 * @returns {{focusMode:boolean,typewriterMode:boolean}} 更新后的状态。
 */
export function setWritingModeState(candidate = {}) {
    const nextState = Object.freeze(normalizeWritingModeState(candidate));
    if (
        nextState.focusMode === currentState.focusMode
        && nextState.typewriterMode === currentState.typewriterMode
    ) {
        return currentState;
    }

    currentState = nextState;
    listeners.forEach(listener => {
        try {
            listener(currentState);
        } catch (error) {
            console.warn('[WritingModeState] 状态监听器执行失败', error);
        }
    });
    return currentState;
}

/**
 * 订阅写作模式；注册后立即收到一次当前快照，便于迟创建的副栏编辑器正确初始化。
 * @param {Function} listener - 状态监听器。
 * @returns {Function} 取消订阅函数。
 */
export function subscribeWritingModeState(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(currentState);
    return () => listeners.delete(listener);
}
