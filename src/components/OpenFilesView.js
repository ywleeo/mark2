import { addClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';
import { createCompactFileNameElement, scheduleCompactFileNameRefresh } from '../utils/fileNameDisplay.js';
import { getFileIconSvg } from '../utils/fileIcons.js';

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

            const fileName = basename(normalized);
            const item = document.createElement('div');
            item.className = 'open-file-item';
            item.dataset.path = normalized;
            item.tabIndex = '0';
            item.title = fileName;

            if (this.normalizePath?.(currentFile) === normalized) {
                item.classList.add('selected');
            }

            item.innerHTML = getFileIconSvg(normalized, { className: 'open-file-icon', size: 14 });
            item.appendChild(createCompactFileNameElement('open-file-name', fileName));

            const closeButton = document.createElement('button');
            closeButton.className = 'close-file-btn';
            closeButton.dataset.path = normalized;
            closeButton.type = 'button';
            closeButton.textContent = '×';
            item.appendChild(closeButton);

            const cleanupSelect = addClickHandler(item, (event) => {
                if (event.target.closest('.close-file-btn')) {
                    return;
                }
                this.onSelect?.(normalized);
            }, { shouldHandle: () => !this.shouldBlockInteraction?.() });
            this.cleanups.push(cleanupSelect);

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

        scheduleCompactFileNameRefresh(contentDiv);
    }

    dispose() {
        this.cleanups.forEach(fn => typeof fn === 'function' && fn());
        this.cleanups = [];
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
