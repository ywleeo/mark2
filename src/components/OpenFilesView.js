import { addClickHandler } from '../utils/PointerHelper.js';

export class OpenFilesView {
    constructor(options = {}) {
        const {
            container,
            normalizePath,
            onSelect,
            onClose,
            onRenameRequest,
            shouldBlockInteraction,
            watchFile,
            isRenaming,
        } = options;

        this.container = container;
        this.normalizePath = normalizePath;
        this.onSelect = onSelect;
        this.onClose = onClose;
        this.onRenameRequest = onRenameRequest;
        this.shouldBlockInteraction = shouldBlockInteraction;
        this.watchFile = watchFile;
        this.isRenaming = isRenaming;
        this.cleanups = [];
    }

    render(openFiles = [], options = {}) {
        const {
            currentFile = null,
            skipWatch = false,
        } = options;

        const contentDiv = this.container;
        if (!contentDiv) return;

        // 清理旧事件
        this.cleanups.forEach(fn => typeof fn === 'function' && fn());
        this.cleanups = [];

        if (!Array.isArray(openFiles) || openFiles.length === 0) {
            contentDiv.innerHTML = '';
            return;
        }

        contentDiv.innerHTML = '';

        openFiles.forEach(path => {
            const normalized = this.normalizePath?.(path) ?? path;
            if (!skipWatch && typeof this.watchFile === 'function') {
                this.watchFile(normalized).catch?.(error => {
                    console.error('监听文件失败:', error);
                });
            }

            const fileName = normalized.split('/').pop();
            const item = document.createElement('div');
            item.className = 'open-file-item';
            item.dataset.path = normalized;
            item.tabIndex = '0';

            if (this.normalizePath?.(currentFile) === normalized) {
                item.classList.add('selected');
            }

            let iconSvg = `
                <svg class="open-file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V9l-7-7z"/>
                    <path d="M13 3v6h6"/>
                </svg>
            `;

            if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
                iconSvg = `
                    <svg class="open-file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                        <path d="M14 3v5h5M16 13H8M16 17H8M10 9H8"/>
                    </svg>
                `;
            }

            item.innerHTML = `
                ${iconSvg}
                <span class="open-file-name">${fileName}</span>
                <button class="close-file-btn" data-path="${normalized}">×</button>
            `;

            const cleanupSelect = addClickHandler(item, (event) => {
                if (event.target.closest('.close-file-btn')) {
                    return;
                }
                this.onSelect?.(normalized);
            }, { shouldHandle: () => !this.shouldBlockInteraction?.() });
            this.cleanups.push(cleanupSelect);

            const closeButton = item.querySelector('.close-file-btn');
            const cleanupClose = addClickHandler(closeButton, (event) => {
                event.stopPropagation();
                this.onClose?.(normalized);
            });
            this.cleanups.push(cleanupClose);

            const onKeyDown = (e) => {
                if (this.isRenaming?.()) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.onRenameRequest?.(normalized);
                }
            };
            item.addEventListener('keydown', onKeyDown);
            this.cleanups.push(() => item.removeEventListener('keydown', onKeyDown));

            contentDiv.appendChild(item);
        });
    }

    dispose() {
        this.cleanups.forEach(fn => typeof fn === 'function' && fn());
        this.cleanups = [];
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
