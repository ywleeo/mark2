/**
 * 管理 untitled 虚拟文件
 * 使用 untitled://untitled-{n}.md 格式的路径标识
 */

const UNTITLED_PROTOCOL = 'untitled://';

/**
 * 创建 untitled 文件管理器
 */
export function createUntitledFileManager() {
    // 存储所有 untitled 文件的内容
    // key: untitled 路径, value: { content: string, hasChanges: boolean }
    const untitledFiles = new Map();
    let counter = 0;

    /**
     * 从 untitled 路径中解析序号
     */
    function extractUntitledIndex(path) {
        if (!isUntitledPath(path)) {
            return null;
        }
        const match = path.match(/^untitled:\/\/untitled-(\d+)\.\w+$/i);
        if (!match) {
            return null;
        }
        const parsed = Number.parseInt(match[1], 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    /**
     * 检查路径是否是 untitled 文件
     */
    function isUntitledPath(path) {
        return typeof path === 'string' && path.startsWith(UNTITLED_PROTOCOL);
    }

    /**
     * 生成新的 untitled 文件路径
     */
    function generateUntitledPath(ext = 'md') {
        counter += 1;
        return `${UNTITLED_PROTOCOL}untitled-${counter}.${ext}`;
    }

    /**
     * 创建新的 untitled 文件
     * @param {string} [ext='md'] - 文件扩展名
     * @returns {string} 新文件的路径
     */
    function createUntitledFile(ext = 'md') {
        const path = generateUntitledPath(ext);
        untitledFiles.set(path, {
            content: '',
            hasChanges: false,
        });
        return path;
    }

    /**
     * 获取 untitled 文件的内容
     */
    function getContent(path) {
        if (!isUntitledPath(path)) {
            return null;
        }
        const file = untitledFiles.get(path);
        return file ? file.content : '';
    }

    /**
     * 设置 untitled 文件的内容
     */
    function setContent(path, content) {
        if (!isUntitledPath(path)) {
            return false;
        }
        const file = untitledFiles.get(path);
        if (file) {
            file.content = content;
            file.hasChanges = true;
            return true;
        }
        // 如果文件不存在，创建它
        untitledFiles.set(path, {
            content,
            hasChanges: true,
        });
        return true;
    }

    /**
     * 检查 untitled 文件是否有未保存的更改
     */
    function hasUnsavedChanges(path) {
        if (!isUntitledPath(path)) {
            return false;
        }
        const file = untitledFiles.get(path);
        // 只要有内容就认为有更改（因为 untitled 文件从未保存过）
        return file ? (file.content.length > 0 || file.hasChanges) : false;
    }

    /**
     * 标记文件为无更改（保存后调用）
     */
    function markAsSaved(path) {
        if (!isUntitledPath(path)) {
            return;
        }
        const file = untitledFiles.get(path);
        if (file) {
            file.hasChanges = false;
        }
    }

    /**
     * 删除 untitled 文件
     */
    function removeUntitledFile(path) {
        if (!isUntitledPath(path)) {
            return false;
        }
        return untitledFiles.delete(path);
    }

    /**
     * 获取 untitled 文件的显示名称
     */
    function getDisplayName(path) {
        if (!isUntitledPath(path)) {
            return null;
        }
        // 从 untitled://untitled-1.md 提取 untitled-1.md
        return path.slice(UNTITLED_PROTOCOL.length);
    }

    /**
     * 为导入操作创建 untitled 文件，使用原文件名作为建议保存名
     */
    function createImportFile(suggestedName) {
        const name = suggestedName || 'untitled.md';
        let path = `${UNTITLED_PROTOCOL}${name}`;
        if (untitledFiles.has(path)) {
            const extMatch = name.match(/(\.[^.]+)$/);
            const ext = extMatch ? extMatch[1] : '.md';
            const base = extMatch ? name.slice(0, -ext.length) : name;
            let i = 2;
            while (untitledFiles.has(`${UNTITLED_PROTOCOL}${base}-${i}${ext}`)) i++;
            path = `${UNTITLED_PROTOCOL}${base}-${i}${ext}`;
        }
        untitledFiles.set(path, { content: '', hasChanges: false });
        return path;
    }

    /**
     * 清除所有 untitled 文件
     */
    function clearAll() {
        untitledFiles.clear();
        counter = 0;
    }

    /**
     * 获取可持久化的 untitled 快照
     */
    function getSnapshot() {
        return Array.from(untitledFiles.entries()).map(([path, value]) => ({
            path,
            content: typeof value?.content === 'string' ? value.content : '',
            hasChanges: Boolean(value?.hasChanges),
        }));
    }

    /**
     * 从快照恢复 untitled 文件
     */
    function restoreFromSnapshot(snapshot = []) {
        clearAll();

        if (!Array.isArray(snapshot) || snapshot.length === 0) {
            return;
        }

        let maxCounter = 0;
        snapshot.forEach((entry) => {
            const path = typeof entry?.path === 'string' ? entry.path : '';
            if (!isUntitledPath(path)) {
                return;
            }

            const content = typeof entry?.content === 'string' ? entry.content : '';
            const hasChanges = typeof entry?.hasChanges === 'boolean'
                ? entry.hasChanges
                : content.trim().length > 0;
            untitledFiles.set(path, { content, hasChanges });

            const index = extractUntitledIndex(path);
            if (Number.isFinite(index) && index > maxCounter) {
                maxCounter = index;
            }
        });

        counter = maxCounter;
    }

    return {
        isUntitledPath,
        createUntitledFile,
        createImportFile,
        getContent,
        setContent,
        hasUnsavedChanges,
        markAsSaved,
        removeUntitledFile,
        getDisplayName,
        clearAll,
        getSnapshot,
        restoreFromSnapshot,
        UNTITLED_PROTOCOL,
    };
}

// 导出单例实例
export const untitledFileManager = createUntitledFileManager();
