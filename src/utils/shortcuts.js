export function setupKeyboardShortcuts({ onOpen, onSave, onCloseTab, onFind }) {
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

