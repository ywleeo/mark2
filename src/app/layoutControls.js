export function createLayoutControls({ getStatusBarController, getPluginManager }) {
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

    function showAiSidebar() {
        const aiApi = getPluginManager?.()?.getPluginApi?.('ai-assistant');
        aiApi?.showSidebar?.();
    }

    function hideAiSidebar() {
        const aiApi = getPluginManager?.()?.getPluginApi?.('ai-assistant');
        aiApi?.hideSidebar?.();
    }

    function toggleAiSidebarVisibility() {
        const aiApi = getPluginManager?.()?.getPluginApi?.('ai-assistant');
        aiApi?.toggleSidebar?.();
    }

    return {
        setSidebarVisibility,
        toggleSidebarVisibility,
        toggleStatusBarVisibility,
        showAiSidebar,
        hideAiSidebar,
        toggleAiSidebarVisibility,
    };
}
