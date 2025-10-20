import { addClickHandler } from '../utils/PointerHelper.js';

export function createStatusBarController({
    statusBarElement,
    statusBarFilePathElement,
    statusBarWordCountElement,
    statusBarLastModifiedElement,
    normalizeFsPath,
    revealInFileManager,
    getFileMetadata,
}) {
    if (!statusBarElement
        || !statusBarFilePathElement
        || !statusBarWordCountElement
        || !statusBarLastModifiedElement) {
        throw new Error('缺少状态栏元素，无法初始化状态栏控制器');
    }

    let isStatusBarHidden = false;
    let statusBarPathCleanup = null;

    function setStatusBarVisibility(hidden) {
        const body = document.body;
        if (!body) {
            return;
        }

        if (hidden) {
            body.classList.add('is-status-bar-hidden');
            statusBarElement.setAttribute('aria-hidden', 'true');
        } else {
            body.classList.remove('is-status-bar-hidden');
            statusBarElement.removeAttribute('aria-hidden');
        }

        isStatusBarHidden = hidden;
    }

    function toggleStatusBarVisibility() {
        setStatusBarVisibility(!isStatusBarHidden);
    }

    function updateStatusBar({ filePath, wordCount, lastModified, isDirty } = {}) {
        if (filePath && typeof filePath === 'string') {
            statusBarFilePathElement.textContent = filePath;
            statusBarFilePathElement.title = filePath;
        } else {
            statusBarFilePathElement.textContent = '未打开文件';
            statusBarFilePathElement.removeAttribute('title');
        }

        let wordCountText = '';
        if (typeof wordCount === 'number' && !Number.isNaN(wordCount)) {
            wordCountText = `${wordCount} 字`;
        }
        if (isDirty) {
            wordCountText = wordCountText.length > 0 ? `${wordCountText}（已编辑）` : '已编辑';
        }
        statusBarWordCountElement.textContent = wordCountText;

        if (lastModified && typeof lastModified === 'string') {
            statusBarLastModifiedElement.textContent = lastModified;
        } else {
            statusBarLastModifiedElement.textContent = '';
        }
    }

    function setupStatusBarPathInteraction({ getCurrentFile }) {
        if (statusBarPathCleanup) {
            statusBarPathCleanup();
            statusBarPathCleanup = null;
        }

        statusBarPathCleanup = addClickHandler(
            statusBarFilePathElement,
            () => handleStatusBarPathActivate(getCurrentFile),
            {
                shouldHandle: (event) => Boolean(getCurrentFile()) && (event.metaKey || event.ctrlKey),
                preventDefault: true,
            }
        );
    }

    async function handleStatusBarPathActivate(getCurrentFile) {
        const currentFile = getCurrentFile();
        if (!currentFile) {
            return;
        }

        const normalizedPath = normalizeFsPath(currentFile);
        if (!normalizedPath) {
            return;
        }

        try {
            await revealInFileManager(normalizedPath);
        } catch (error) {
            const message = typeof error === 'string' ? error : error?.message;
            if (message === 'unsupported') {
                console.warn('当前平台暂不支持定位此文件:', normalizedPath);
                return;
            }
            console.error('在文件管理器中显示路径失败:', error);
        }
    }

    function calculateWordCount({ activeViewMode, editor, codeEditor }) {
        try {
            let content = '';

            if (activeViewMode === 'markdown' && editor) {
                content = editor.getMarkdown() || '';
            } else if (activeViewMode === 'code' && codeEditor) {
                content = codeEditor.getValue() || '';
            }

            if (!content) return 0;

            const cleaned = content
                .replace(/```[\s\S]*?```/g, '')
                .replace(/`[^`]+`/g, '')
                .replace(/!\[.*?\]\(.*?\)/g, '')
                .replace(/\[.*?\]\(.*?\)/g, '')
                .replace(/[#*_~\->`]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            const chineseChars = cleaned.match(/[\u4e00-\u9fa5]/g) || [];
            const englishWords = cleaned.match(/[a-zA-Z]+/g) || [];

            return chineseChars.length + englishWords.length;
        } catch (error) {
            console.error('计算字数失败:', error);
            return 0;
        }
    }

    async function getLastModifiedTime(filePath) {
        if (!filePath) {
            return null;
        }

        try {
            const metadata = await getFileMetadata(filePath);
            if (!metadata || !metadata.modified_time) return null;

            const date = new Date(metadata.modified_time * 1000);
            const now = new Date();

            if (date.toDateString() === now.toDateString()) {
                return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            }

            if (date.getFullYear() === now.getFullYear()) {
                return (
                    date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
                    date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                );
            }

            return date.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            });
        } catch (error) {
            console.error('获取文件修改时间失败:', error);
            return null;
        }
    }

    function teardown() {
        if (statusBarPathCleanup) {
            statusBarPathCleanup();
            statusBarPathCleanup = null;
        }
    }

    return {
        setStatusBarVisibility,
        toggleStatusBarVisibility,
        updateStatusBar,
        setupStatusBarPathInteraction,
        calculateWordCount,
        getLastModifiedTime,
        teardown,
        isHidden: () => isStatusBarHidden,
    };
}
