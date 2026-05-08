export function setupSidebarResizer(options = {}) {
    const {
        sidebarId = 'sidebar',
        resizerId = 'sidebarResizer',
        minWidth = 180,
        maxSidebarWidth = 640,
        minContentWidth = 320,
    } = options;

    const sidebar = document.getElementById(sidebarId);
    const resizer = document.getElementById(resizerId);

    if (!sidebar || !resizer) return;

    const syncWidthVar = (width) => {
        document.documentElement.style.setProperty('--sidebar-current-width', `${width}px`);
    };

    // 初始同步：sidebar 在右侧布局时 padding-right 跟 resizer 位置都依赖这个 var
    syncWidthVar(sidebar.getBoundingClientRect().width);

    let startX = 0;
    let startWidth = 0;
    let activePointerId = null;

    const stopResizing = (event) => {
        if (activePointerId === null || event.pointerId !== activePointerId) return;

        if (resizer.hasPointerCapture(activePointerId)) {
            resizer.releasePointerCapture(activePointerId);
        }
        activePointerId = null;
        document.body.classList.remove('sidebar-resizing');
        document.body.style.userSelect = '';
    };

    const handlePointerDown = (event) => {
        if (activePointerId !== null) return;

        startX = event.clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        activePointerId = event.pointerId;
        resizer.setPointerCapture(activePointerId);
        document.body.classList.add('sidebar-resizing');
        document.body.style.userSelect = 'none';
        event.preventDefault();
    };

    const handlePointerMove = (event) => {
        if (activePointerId === null || event.pointerId !== activePointerId) return;

        const sign = document.body.classList.contains('sidebar-position-right') ? -1 : 1;
        const delta = (event.clientX - startX) * sign;
        const bodyWidth = document.body.getBoundingClientRect().width;
        const maxAvailable = bodyWidth - minContentWidth;
        const clampedMax = Math.max(minWidth, Math.min(maxSidebarWidth, maxAvailable));
        const nextWidth = Math.min(Math.max(minWidth, startWidth + delta), clampedMax);

        sidebar.style.width = `${nextWidth}px`;
        syncWidthVar(nextWidth);
    };

    resizer.addEventListener('pointerdown', handlePointerDown);
    resizer.addEventListener('pointermove', handlePointerMove);
    resizer.addEventListener('pointerup', stopResizing);
    resizer.addEventListener('pointercancel', stopResizing);

    return () => {
        resizer.removeEventListener('pointerdown', handlePointerDown);
        resizer.removeEventListener('pointermove', handlePointerMove);
        resizer.removeEventListener('pointerup', stopResizing);
        resizer.removeEventListener('pointercancel', stopResizing);
    };
}

