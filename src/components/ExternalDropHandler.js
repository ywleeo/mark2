export class ExternalDropHandler {
    constructor(options = {}) {
        const {
            container,
            readDirectory,
            addRootFolder,
            refreshFolder,
        } = options;

        this.container = container;
        this.readDirectory = readDirectory;
        this.addRootFolder = addRootFolder;
        this.refreshFolder = refreshFolder;
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
            try {
                const entries = await this.readDirectory?.(path);
                if (Array.isArray(entries)) {
                    await this.addRootFolder?.(path, { entries });
                    continue;
                }
            } catch (err) {
                // 读取失败可能是文件，忽略异常
            }

            const parent = path.split('/').slice(0, -1).join('/');
            if (parent) {
                await this.refreshFolder?.(parent);
            }
        }
    }
}
