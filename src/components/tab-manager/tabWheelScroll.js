/**
 * 计算纵向滚轮映射后的标签栏横向位置。
 * 返回 null 表示应交给浏览器处理，例如原生横向手势、无溢出或已到滚动边界。
 * @param {{ clientWidth: number, scrollWidth: number, scrollLeft: number }} tabList - 标签栏滚动尺寸
 * @param {{ deltaX: number, deltaY: number, deltaMode: number }} event - 滚轮增量
 * @returns {number|null} 下一横向位置，或无需接管时返回 null
 */
export function getTabWheelScrollLeft(tabList, event) {
    if (!tabList || !event) return null;

    const clientWidth = Number.isFinite(tabList.clientWidth) ? tabList.clientWidth : 0;
    const scrollWidth = Number.isFinite(tabList.scrollWidth) ? tabList.scrollWidth : 0;
    const currentScrollLeft = Number.isFinite(tabList.scrollLeft) ? tabList.scrollLeft : 0;
    const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
    if (maxScrollLeft <= 0) return null;

    const deltaX = Number.isFinite(event.deltaX) ? event.deltaX : 0;
    const deltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0;

    // 浏览器会原生处理触控板横向手势；这里只补齐普通鼠标的纵向滚轮。
    if (Math.abs(deltaX) >= Math.abs(deltaY) || deltaY === 0) return null;

    let horizontalDelta = deltaY;
    if (event.deltaMode === 1) {
        horizontalDelta *= 16;
    } else if (event.deltaMode === 2) {
        horizontalDelta *= clientWidth;
    }

    const nextScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, currentScrollLeft + horizontalDelta),
    );
    return Math.abs(nextScrollLeft - currentScrollLeft) < 0.5
        ? null
        : nextScrollLeft;
}
