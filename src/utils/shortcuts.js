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
            if (onToggleSvgCodeView && onToggleMarkdownCodeView) {
                // 如果两个函数都存在，让它们内部自己检查文件类型
                // 先尝试 SVG 切换
                const svgResult = await onToggleSvgCodeView();
                // 如果 SVG 切换没有生效（不是 SVG 文件），再尝试 Markdown 切换
                if (!svgResult) {
                    // svgResult 为 undefined，说明 SVG 切换没有生效，尝试 Markdown 切换
                    await onToggleMarkdownCodeView();
                }
                // 如果 svgResult 有值（不管 changed 是 true 还是 false），说明 SVG 函数已经处理了
            } else if (onToggleSvgCodeView) {
                await onToggleSvgCodeView();
            } else if (onToggleMarkdownCodeView) {
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
