/**
 * 根据当前编辑视口创建 AI 写作入口的行边栏锚点。
 * 入口跟随所属编辑面板，而不是依赖 sidebar 的固定宽度。
 *
 * @param {DOMRect|object|null} viewportRect - 编辑视口矩形。
 * @param {DOMRect|object} lineCoords - 当前光标所在行的矩形。
 * @returns {{left:number,top:number,bottom:number}} 行边栏锚点。
 */
export function createLineGutterAnchor(viewportRect, lineCoords) {
    const viewportLeft = Number.isFinite(viewportRect?.left) ? viewportRect.left : 0;
    return {
        left: viewportLeft,
        top: lineCoords.top,
        bottom: lineCoords.bottom,
    };
}
