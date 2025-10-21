export function setupKeyboardShortcuts({
    onOpen,
    onSave,
    onCloseTab,
    onFind,
    onToggleSidebar,
    onToggleMarkdownCodeView,
    onToggleAiSidebar,
}) {
    const handler = async (event) => {
        const isMeta = event.metaKey || event.ctrlKey;
        const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';

        if (isMeta && event.shiftKey && key === 'a') {
            event.preventDefault();
            if (onToggleAiSidebar) {
                await onToggleAiSidebar();
            }
            return;
        }

        if (isMeta && key === 'o') {
            event.preventDefault();
            if (onOpen) {
                await onOpen();
            }
            return;
        }

        if (isMeta && key === 's') {
            event.preventDefault();
            if (onSave) {
                await onSave();
            }
            return;
        }

        if (isMeta && key === 'b') {
            event.preventDefault();
            if (onToggleSidebar) {
                await onToggleSidebar();
            }
            return;
        }

        if (isMeta && key === 'e') {
            event.preventDefault();
            if (onToggleMarkdownCodeView) {
                await onToggleMarkdownCodeView();
            }
            return;
        }

        if (isMeta && key === 'w') {
            event.preventDefault();
            if (onCloseTab) {
                await onCloseTab();
            }
            return;
        }

        if (isMeta && key === 'f') {
            event.preventDefault();
            if (onFind) {
                await onFind();
            }
        }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}
