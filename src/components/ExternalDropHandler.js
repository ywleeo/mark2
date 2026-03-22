import { dirname } from '../utils/pathUtils.js';

export class ExternalDropHandler {
    constructor(options = {}) {
        const {
            container,
            readDirectory,
            addRootFolder,
            refreshFolder,
            ensureSecurityScope,
        } = options;

        this.container = container;
        this.readDirectory = readDirectory;
        this.addRootFolder = addRootFolder;
        this.refreshFolder = refreshFolder;
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

        // 如果是目录，尝试加入根文件夹；如果是文件，尝试刷新所在目录
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

            try {
                const entries = await this.readDirectory?.(path);
                if (Array.isArray(entries)) {
                    await this.addRootFolder?.(path, { entries });
                    continue;
                }
            } catch (err) {
                // 读取失败可能是文件，忽略异常
            }

            const parent = dirname(path);
            if (parent) {
                await this.refreshFolder?.(parent);
            }
        }
    }
}
