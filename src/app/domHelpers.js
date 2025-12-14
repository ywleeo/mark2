/**
 * DOM 辅助工具函数
 */

/**
 * 通过 ID 查找必需的 DOM 元素
 * @param {string} id - 元素 ID
 * @param {string} errorMessage - 错误信息
 * @returns {HTMLElement}
 * @throws {Error} 如果元素不存在
 */
export function requireElementById(id, errorMessage) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(errorMessage || `未找到元素 id=${id}`);
    }
    return element;
}

/**
 * 在容器中查找必需的 DOM 元素
 * @param {HTMLElement} container - 容器元素
 * @param {string} selector - CSS 选择器
 * @param {string} errorMessage - 错误信息
 * @returns {HTMLElement}
 * @throws {Error} 如果元素不存在
 */
export function requireElementWithin(container, selector, errorMessage) {
    const element = container.querySelector(selector);
    if (!element) {
        throw new Error(errorMessage || `未在容器中找到元素 ${selector}`);
    }
    return element;
}
