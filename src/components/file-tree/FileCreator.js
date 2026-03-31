export class FileCreator {
    constructor(options = {}) {
        const {
            normalizePath,
            getFileService,
            markLocalWrite,
            refreshFolder,
            selectFile,
            startRenaming,
        } = options;

        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.markLocalWrite = markLocalWrite;
        this.refreshFolder = refreshFolder;
        this.selectFile = selectFile;
        this.startRenaming = startRenaming;
    }

    async _findAvailableName(dirPath, baseName, ext) {
        const fileService = this.getFileService?.();
        const pathModule = await import('@tauri-apps/api/path');
        let attempts = 0;
        while (attempts < 1000) {
            const suffix = attempts === 0 ? '' : `-${attempts}`;
            const fileName = `${baseName}${suffix}${ext}`;
            const joined = await pathModule.join(dirPath, fileName);
            const normalized = this.normalizePath?.(joined);
            if (normalized && !(await fileService.exists(normalized))) {
                return normalized;
            }
            attempts += 1;
        }
        throw new Error('无法找到可用的文件名');
    }

    async createFile(folderPath) {
        const normalized = this.normalizePath?.(folderPath);
        if (!normalized) return;
        try {
            const fileService = this.getFileService?.();
            const candidatePath = await this._findAvailableName(normalized, 'untitled', '.md');
            this.markLocalWrite?.(candidatePath);
            this.markLocalWrite?.(normalized);
            await fileService.writeText(candidatePath, '');
            await this.refreshFolder?.(normalized);
            setTimeout(() => {
                this.selectFile?.(candidatePath, { autoFocus: false });
                this.startRenaming?.(candidatePath);
            }, 100);
        } catch (error) {
            console.error('创建文件失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`创建文件失败:\n${error.message || error}`, { title: '创建失败', kind: 'error' });
            } catch {}
        }
    }

    async createFolder(folderPath) {
        const normalized = this.normalizePath?.(folderPath);
        if (!normalized) return;
        try {
            const fileService = this.getFileService?.();
            const candidatePath = await this._findAvailableName(normalized, 'newfolder', '');
            this.markLocalWrite?.(candidatePath);
            this.markLocalWrite?.(normalized);
            await fileService.createDirectory(candidatePath);
            await this.refreshFolder?.(normalized);
            setTimeout(() => {
                this.startRenaming?.(candidatePath, { targetType: 'folder' });
            }, 100);
        } catch (error) {
            console.error('创建文件夹失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`创建文件夹失败:\n${error.message || error}`, { title: '创建失败', kind: 'error' });
            } catch {}
        }
    }
}
