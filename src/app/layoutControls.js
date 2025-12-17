export function createLayoutControls({ getStatusBarController }) {
    let isSidebarHidden = false;

    function setSidebarVisibility(hidden) {
        const body = document.body;
        const sidebar = document.getElementById('sidebar');
        const resizer = document.getElementById('sidebarResizer');
        if (!body || !sidebar || !resizer) {
            return;
        }

        if (hidden && !isSidebarHidden) {
            const currentWidth = sidebar.style.width;
            sidebar.dataset.previousWidth = currentWidth ?? '';
        }

        if (hidden) {
            body.classList.add('is-sidebar-hidden');
            sidebar.setAttribute('aria-hidden', 'true');
            resizer.setAttribute('aria-hidden', 'true');
        } else {
            body.classList.remove('is-sidebar-hidden');
            sidebar.removeAttribute('aria-hidden');
            resizer.removeAttribute('aria-hidden');
            const previousWidth = sidebar.dataset.previousWidth;
            if (typeof previousWidth === 'string') {
                if (previousWidth.length > 0) {
                    sidebar.style.width = previousWidth;
                } else {
                    sidebar.style.removeProperty('width');
                }
            }
            delete sidebar.dataset.previousWidth;
        }

        isSidebarHidden = hidden;
    }

    function toggleSidebarVisibility() {
        setSidebarVisibility(!isSidebarHidden);
    }

    function toggleStatusBarVisibility() {
        getStatusBarController?.()?.toggleStatusBarVisibility?.();
    }

    return {
        setSidebarVisibility,
        toggleSidebarVisibility,
        toggleStatusBarVisibility,
    };
}
