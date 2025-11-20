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

            const iconSvg = `
                <svg class="open-file-icon" width="14" height="14" viewBox="0 0 16 16">
                    <path d="M2 1.5v13c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5V4.5L10.5 1H2.5c-.28 0-.5.22-.5.5z"
                          fill="none" stroke="currentColor" stroke-width="1"/>
                    <path d="M10.5 1v3.5H14" fill="none" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;

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
