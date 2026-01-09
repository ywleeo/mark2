export function setupKeyboardShortcuts({
    onOpen,
    onSave,
    onCloseTab,
    onFind,
    onSelectSearchMatches,
    onDeleteFile,
    // onToggleSidebar 由 Tauri 菜单统一处理
    onToggleMarkdownCodeView,
    onToggleSvgCodeView,
    onToggleCsvTableView,
}) {
    const handler = async (event) => {
        const isMeta = event.metaKey || event.ctrlKey;
        const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';

        if (isMeta && key === 'o') {
            event.preventDefault();
            if (onOpen) {
                await onOpen();
            }
            return;
        }

        if (isMeta && event.shiftKey && key === 'l') {
            event.preventDefault();
            if (onSelectSearchMatches) {
                await onSelectSearchMatches();
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

        // cmd+k 由 Tauri 菜单统一处理，这里不再监听
        // 避免与原生菜单快捷键冲突

        if (isMeta && key === 'e') {
            event.preventDefault();
            // 根据文件类型决定调用哪个切换函数
            // 优先级：SVG -> CSV -> Markdown
            if (onToggleSvgCodeView) {
                const svgResult = await onToggleSvgCodeView();
                if (svgResult) {
                    return; // SVG 切换成功，直接返回
                }
            }
            if (onToggleCsvTableView) {
                const csvResult = await onToggleCsvTableView();
                if (csvResult) {
                    return; // CSV 切换成功，直接返回
                }
            }
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

        if (isMeta && (key === 'delete' || key === 'backspace')) {
            event.preventDefault();
            if (onDeleteFile) {
                await onDeleteFile();
            }
            return;
        }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}
