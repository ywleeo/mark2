import { addClickHandler } from '../utils/PointerHelper.js';

export function createStatusBarController({
    statusBarElement,
    statusBarFilePathElement,
    statusBarWordCountElement,
    statusBarLastModifiedElement,
    statusBarProgressElement,
    statusBarProgressTextElement,
    statusBarZoomElement = null,
    statusBarZoomValueElement = null,
    statusBarZoomInButton = null,
    statusBarZoomOutButton = null,
    statusBarPageInfoElement = null,
    normalizeFsPath,
    revealInFileManager,
    getFileMetadata,
    onVisibilityChange,
}) {
    if (!statusBarElement
        || !statusBarFilePathElement
        || !statusBarWordCountElement
        || !statusBarLastModifiedElement
        || !statusBarProgressElement) {
        throw new Error('缺少状态栏元素，无法初始化状态栏控制器');
    }

    let isStatusBarHidden = false;
    let statusBarPathCleanup = null;
    let progressHideTimer = null;
    let zoomControlsCleanup = null;

    function setStatusBarVisibility(hidden) {
        const body = document.body;
        if (!body) {
            return;
        }

        const nextHidden = Boolean(hidden);

        if (nextHidden) {
            body.classList.add('is-status-bar-hidden');
            statusBarElement.setAttribute('aria-hidden', 'true');
        } else {
            body.classList.remove('is-status-bar-hidden');
            statusBarElement.removeAttribute('aria-hidden');
        }

        const visibilityChanged = nextHidden !== isStatusBarHidden;
        isStatusBarHidden = nextHidden;

        if (visibilityChanged && typeof onVisibilityChange === 'function') {
            onVisibilityChange({ hidden: nextHidden });
        }
    }

    function showProgress(message = '正在处理...', { state } = {}) {
        if (!statusBarProgressElement) {
            return;
        }

        window.clearTimeout(progressHideTimer);
        progressHideTimer = null;

        statusBarProgressElement.classList.add('is-active');
        statusBarProgressElement.classList.remove('is-success', 'is-error');
        if (state === 'success') {
            statusBarProgressElement.classList.add('is-success');
        }
        if (state === 'error') {
            statusBarProgressElement.classList.add('is-error');
        }
        statusBarProgressElement.removeAttribute('aria-hidden');

        if (statusBarProgressTextElement) {
            statusBarProgressTextElement.textContent = message;
        } else {
            statusBarProgressElement.textContent = message;
        }
    }

    function hideProgress({ delay = 0 } = {}) {
        if (!statusBarProgressElement) {
            return;
        }

        const clearState = () => {
            statusBarProgressElement.classList.remove('is-active', 'is-success', 'is-error');
            statusBarProgressElement.setAttribute('aria-hidden', 'true');
            if (statusBarProgressTextElement) {
                statusBarProgressTextElement.textContent = '';
            } else {
                statusBarProgressElement.textContent = '';
            }
        };

        if (delay && delay > 0) {
            window.clearTimeout(progressHideTimer);
            progressHideTimer = window.setTimeout(() => {
                clearState();
                progressHideTimer = null;
            }, delay);
        } else {
            window.clearTimeout(progressHideTimer);
            progressHideTimer = null;
            clearState();
        }
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

        let pointerDownWithMetaKey = false;

        const resetPointerMetaState = () => {
            pointerDownWithMetaKey = false;
        };

        const handlePointerDown = (event) => {
            pointerDownWithMetaKey = Boolean(event.metaKey || event.ctrlKey);
        };

        statusBarFilePathElement.addEventListener('pointerdown', handlePointerDown);
        statusBarFilePathElement.addEventListener('pointercancel', resetPointerMetaState);

        const cleanupClickHandler = addClickHandler(
            statusBarFilePathElement,
            () => handleStatusBarPathActivate(getCurrentFile),
            {
                shouldHandle: (event) => {
                    const hasFile = Boolean(getCurrentFile());
                    const hasMetaKey = Boolean(event.metaKey || event.ctrlKey);
                    const shouldHandleEvent = hasFile && hasMetaKey && pointerDownWithMetaKey;
                    if (event.type === 'pointerup' || event.type === 'click') {
                        resetPointerMetaState();
                    }
                    return shouldHandleEvent;
                },
                preventDefault: true,
            }
        );

        statusBarPathCleanup = () => {
            cleanupClickHandler?.();
            statusBarFilePathElement.removeEventListener('pointerdown', handlePointerDown);
            statusBarFilePathElement.removeEventListener('pointercancel', resetPointerMetaState);
        };
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

    function setupZoomControls({ onZoomIn, onZoomOut } = {}) {
        if (zoomControlsCleanup) {
            zoomControlsCleanup();
            zoomControlsCleanup = null;
        }
        if (!statusBarZoomInButton || !statusBarZoomOutButton) {
            return;
        }
        const handleZoomIn = (event) => {
            event.preventDefault();
            onZoomIn?.();
        };
        const handleZoomOut = (event) => {
            event.preventDefault();
            onZoomOut?.();
        };

        statusBarZoomInButton.addEventListener('click', handleZoomIn);
        statusBarZoomOutButton.addEventListener('click', handleZoomOut);

        zoomControlsCleanup = () => {
            statusBarZoomInButton.removeEventListener('click', handleZoomIn);
            statusBarZoomOutButton.removeEventListener('click', handleZoomOut);
        };
    }

    function updateZoomDisplay({ zoomValue = 1, canZoomIn = true, canZoomOut = true } = {}) {
        if (statusBarZoomValueElement) {
            const percent = Math.round((Number(zoomValue) || 1) * 100);
            statusBarZoomValueElement.textContent = `${percent}%`;
        }
        if (statusBarZoomInButton) {
            statusBarZoomInButton.disabled = !canZoomIn;
        }
        if (statusBarZoomOutButton) {
            statusBarZoomOutButton.disabled = !canZoomOut;
        }
    }

    function setPageInfo(text = '') {
        if (!statusBarPageInfoElement) {
            return;
        }
        if (text && text.length > 0) {
            statusBarPageInfoElement.textContent = text;
            statusBarPageInfoElement.style.display = '';
        } else {
            statusBarPageInfoElement.textContent = '';
            statusBarPageInfoElement.style.display = 'none';
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

    function teardownProgress() {
        if (!statusBarProgressElement) {
            return;
        }
        window.clearTimeout(progressHideTimer);
        progressHideTimer = null;
        hideProgress();
    }

    function teardown() {
        if (statusBarPathCleanup) {
            statusBarPathCleanup();
            statusBarPathCleanup = null;
        }
        if (zoomControlsCleanup) {
            zoomControlsCleanup();
            zoomControlsCleanup = null;
        }
        teardownProgress();
    }

    return {
        setStatusBarVisibility,
        toggleStatusBarVisibility,
        updateStatusBar,
        setupStatusBarPathInteraction,
        setupZoomControls,
        updateZoomDisplay,
        setPageInfo,
        calculateWordCount,
        getLastModifiedTime,
        teardown,
        showProgress,
        hideProgress,
        isHidden: () => isStatusBarHidden,
    };
}
