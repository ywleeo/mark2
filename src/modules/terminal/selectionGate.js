/**
 * 在 xterm 容器外层装一个"拖拽闸门":捕获阶段拦截左键 mousedown,
 * 只有真实拖拽(位移 > 阈值)才合成一个原始位置的 mousedown 放行给 xterm,
 * 单纯点击永远不让 xterm 看到,彻底避免触控板轻点产生微选中。
 * 保留双击选词、shift 扩展选中、右键等其他交互。
 */

const DRAG_THRESHOLD_PX = 4;

export function installSelectionGate(containerEl, onFocus) {
    let pending = null; // { x, y, target } —— 已拦截但未放行的 down
    let dragging = false; // 已放行,进入真正的拖拽阶段

    const reset = () => { pending = null; dragging = false; };

    const onMouseDown = (e) => {
        if (e.button !== 0 || e.shiftKey || e.detail >= 2) {
            reset();
            return;
        }
        pending = { x: e.clientX, y: e.clientY, target: e.target };
        dragging = false;
        e.stopImmediatePropagation();
        e.preventDefault();
        // preventDefault 会吞掉原生 focus,这里手动补一次,保证点击后光标/键盘输入正常
        if (typeof onFocus === 'function') onFocus();
    };

    const onMouseMove = (e) => {
        if (!pending) return;
        if (dragging) return;
        const dx = e.clientX - pending.x;
        const dy = e.clientY - pending.y;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
            e.stopImmediatePropagation();
            return;
        }
        // 越过阈值 —— 合成原位置 mousedown 让 xterm 把 anchor 定在起点
        dragging = true;
        const synth = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            buttons: 1,
            clientX: pending.x,
            clientY: pending.y,
        });
        pending.target.dispatchEvent(synth);
    };

    const onMouseUp = (e) => {
        if (!pending) return;
        if (!dragging) {
            e.stopImmediatePropagation();
        }
        reset();
    };

    const onLeave = () => reset();

    containerEl.addEventListener('mousedown', onMouseDown, true);
    containerEl.addEventListener('mousemove', onMouseMove, true);
    containerEl.addEventListener('mouseup', onMouseUp, true);
    containerEl.addEventListener('mouseleave', onLeave, true);
    window.addEventListener('blur', onLeave);
}
