export function setupKeyboardShortcuts({
    onOpen,
    onSave,
    onCloseTab,
    onFind,
    onToggleSidebar,
    onToggleMarkdownCodeView,
}) {
    const handler = async (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'o') {
            event.preventDefault();
            if (onOpen) {
                await onOpen();
            }
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault();
            if (onSave) {
                await onSave();
            }
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
            event.preventDefault();
            if (onToggleSidebar) {
                await onToggleSidebar();
            }
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
            event.preventDefault();
            if (onToggleMarkdownCodeView) {
                await onToggleMarkdownCodeView();
            }
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
            event.preventDefault();
            if (onCloseTab) {
                await onCloseTab();
            }
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
            event.preventDefault();
            if (onFind) {
                await onFind();
            }
        }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}
