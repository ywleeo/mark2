export class ExternalDropHandler {
    constructor(options = {}) {
        const {
            container,
            openPathsFromSelection,
            ensureSecurityScope,
        } = options;

        this.container = container;
        this.openPathsFromSelection = openPathsFromSelection;
        this.ensureSecurityScope = ensureSecurityScope;
    }

    handleDragOver(event) {
        if (!event?.dataTransfer) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
    }

    async handleDrop(event) {
        if (!event?.dataTransfer) return;
        event.preventDefault();
        event.stopPropagation();

        const files = Array.from(event.dataTransfer.files || []);
        if (!files.length) return;

        if (typeof this.openPathsFromSelection !== 'function') {
            console.warn('[ExternalDropHandler] 缺少 openPathsFromSelection，无法处理外部拖拽');
            return;
        }

        const rawPaths = [];

        for (const file of files) {
            const path = file?.path || file?.webkitRelativePath;
            if (!path) continue;

            if (typeof this.ensureSecurityScope === 'function') {
                try {
                    await this.ensureSecurityScope(path);
                } catch (scopeError) {
                    console.warn('[ExternalDropHandler] 捕获拖拽路径权限失败', scopeError);
                }
            }

            rawPaths.push(path);
        }

        console.debug('[drop-debug][dom-file-tree] drop', {
            fileCount: files.length,
            rawPaths: [...rawPaths],
            hasDataTransferItems: Array.isArray(event.dataTransfer.items)
                ? event.dataTransfer.items.length > 0
                : typeof event.dataTransfer.items?.length === 'number',
        });

        if (!rawPaths.length) {
            return;
        }

        try {
            await this.openPathsFromSelection(rawPaths, { source: 'external-drop' });
        } catch (error) {
            console.error('[ExternalDropHandler] 处理外部拖拽路径失败', error);
        }
    }
}
