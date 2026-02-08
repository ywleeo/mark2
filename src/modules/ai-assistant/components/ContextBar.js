/**
 * Context Bar 组件
 * 显示当前处理文件，管理参考文件列表
 */

import { addClickHandler } from '../../../utils/PointerHelper.js';
import { listDirectory, readFile } from '../../../api/filesystem.js';

const TEXT_EXTENSIONS = new Set([
    'md', 'markdown', 'mdx', 'txt', 'json', 'yaml', 'yml', 'toml',
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less',
    'html', 'htm', 'vue', 'svelte', 'xml', 'py', 'go', 'rs', 'java',
    'kt', 'swift', 'rb', 'php', 'cs', 'cpp', 'c', 'h', 'sql',
    'sh', 'bash', 'zsh', 'log', 'csv', 'ini', 'conf', 'env',
]);

const MAX_REFERENCE_SIZE = 100 * 1024; // 100KB

function getFileName(filePath) {
    if (!filePath) return '';
    const idx = filePath.lastIndexOf('/');
    return idx >= 0 ? filePath.substring(idx + 1) : filePath;
}

function getFolderPath(filePath) {
    if (!filePath) return '';
    const idx = filePath.lastIndexOf('/');
    return idx >= 0 ? filePath.substring(0, idx) : '';
}

function getExtension(filePath) {
    const name = getFileName(filePath);
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.substring(dot + 1).toLowerCase() : '';
}

export class ContextBar {
    constructor() {
        this.element = null;
        this.referenceFiles = []; // [{ path, name }]

        // DOM refs
        this.fileNameEl = null;
        this.addBtn = null;
        this.referencesEl = null;
        this.dropdownEl = null;

        // cleanup
        this.addBtnCleanup = null;
        this.chipCleanups = [];
        this.dropdownCleanups = [];
        this.outsideClickHandler = null;
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'ai-context-bar';
        this.element.innerHTML = `
            <div class="ai-context-current-file">
                <span class="ai-context-file-icon">📄</span>
                <span class="ai-context-file-name is-empty">未打开文件</span>
                <button class="ai-context-add-btn" title="添加参考文件" disabled>+</button>
            </div>
            <div class="ai-context-references" style="display:none"></div>
            <div class="ai-context-dropdown" style="display:none"></div>
        `;

        this.fileNameEl = this.element.querySelector('.ai-context-file-name');
        this.addBtn = this.element.querySelector('.ai-context-add-btn');
        this.referencesEl = this.element.querySelector('.ai-context-references');
        this.dropdownEl = this.element.querySelector('.ai-context-dropdown');

        this.addBtnCleanup = addClickHandler(this.addBtn, () => this.toggleFilePicker());

        this.updateCurrentFile();
        return this.element;
    }

    updateCurrentFile() {
        const filePath = window.currentFile;
        if (filePath) {
            this.fileNameEl.textContent = getFileName(filePath);
            this.fileNameEl.classList.remove('is-empty');
            this.addBtn.disabled = false;
        } else {
            this.fileNameEl.textContent = '未打开文件';
            this.fileNameEl.classList.add('is-empty');
            this.addBtn.disabled = true;
        }
    }

    // ---- 下拉菜单 ----

    toggleFilePicker() {
        if (this.dropdownEl.style.display !== 'none') {
            this.hideFilePicker();
        } else {
            this.showFilePicker();
        }
    }

    async showFilePicker() {
        const currentFile = window.currentFile;
        if (!currentFile) return;

        const folder = getFolderPath(currentFile);
        if (!folder) return;

        let entries;
        try {
            entries = await listDirectory(folder);
        } catch (e) {
            console.warn('[ContextBar] 无法读取目录:', e);
            return;
        }

        // 过滤：文本文件、排除当前文件和已添加文件
        const addedPaths = new Set(this.referenceFiles.map(r => r.path));
        const filtered = entries
            .filter(p => {
                if (p === currentFile) return false;
                if (addedPaths.has(p)) return false;
                const ext = getExtension(p);
                return ext && TEXT_EXTENSIONS.has(ext);
            })
            .sort((a, b) => getFileName(a).localeCompare(getFileName(b)));

        // 清理旧的下拉项事件
        this.cleanupDropdownItems();

        if (filtered.length === 0) {
            this.dropdownEl.innerHTML = '<div class="ai-context-dropdown-empty">没有可用的文本文件</div>';
        } else {
            this.dropdownEl.innerHTML = '';
            for (const filePath of filtered) {
                const item = document.createElement('div');
                item.className = 'ai-context-dropdown-item';
                item.textContent = getFileName(filePath);
                item.dataset.path = filePath;
                const cleanup = addClickHandler(item, () => {
                    this.addReference(filePath);
                    this.hideFilePicker();
                });
                this.dropdownCleanups.push(cleanup);
                this.dropdownEl.appendChild(item);
            }
        }

        this.dropdownEl.style.display = '';

        // 外部点击关闭
        requestAnimationFrame(() => {
            this.outsideClickHandler = (e) => {
                if (!this.dropdownEl.contains(e.target) && !this.addBtn.contains(e.target)) {
                    this.hideFilePicker();
                }
            };
            document.addEventListener('pointerdown', this.outsideClickHandler, true);
        });
    }

    hideFilePicker() {
        this.dropdownEl.style.display = 'none';
        if (this.outsideClickHandler) {
            document.removeEventListener('pointerdown', this.outsideClickHandler, true);
            this.outsideClickHandler = null;
        }
    }

    // ---- 参考文件管理 ----

    addReference(filePath) {
        if (this.referenceFiles.some(r => r.path === filePath)) return;
        this.referenceFiles.push({ path: filePath, name: getFileName(filePath) });
        this.renderChips();
    }

    removeReference(filePath) {
        this.referenceFiles = this.referenceFiles.filter(r => r.path !== filePath);
        this.renderChips();
    }

    clearReferences() {
        this.referenceFiles = [];
        this.renderChips();
    }

    renderChips() {
        // 清理旧事件
        this.chipCleanups.forEach(fn => fn());
        this.chipCleanups = [];

        if (this.referenceFiles.length === 0) {
            this.referencesEl.style.display = 'none';
            this.referencesEl.innerHTML = '';
            return;
        }

        this.referencesEl.style.display = '';
        this.referencesEl.innerHTML = '';

        for (const ref of this.referenceFiles) {
            const chip = document.createElement('span');
            chip.className = 'ai-context-chip';
            chip.innerHTML = `
                <span class="ai-context-chip-name">📎 ${this.escapeHtml(ref.name)}</span>
                <button class="ai-context-chip-remove" title="移除">✕</button>
            `;
            const removeBtn = chip.querySelector('.ai-context-chip-remove');
            const cleanup = addClickHandler(removeBtn, () => this.removeReference(ref.path));
            this.chipCleanups.push(cleanup);
            this.referencesEl.appendChild(chip);
        }
    }

    /**
     * 读取所有参考文件内容
     * @returns {Promise<Array<{name: string, path: string, content: string}>>}
     */
    async getReferences() {
        if (this.referenceFiles.length === 0) return [];

        const results = [];
        let totalSize = 0;

        for (const ref of this.referenceFiles) {
            try {
                const content = await readFile(ref.path);
                totalSize += content.length;
                if (totalSize > MAX_REFERENCE_SIZE) {
                    const remaining = MAX_REFERENCE_SIZE - (totalSize - content.length);
                    if (remaining > 0) {
                        results.push({ name: ref.name, path: ref.path, content: content.substring(0, remaining) + '\n...(内容过长已截断)' });
                    }
                    console.warn('[ContextBar] 参考文件总大小超过限制，后续文件已跳过');
                    break;
                }
                results.push({ name: ref.name, path: ref.path, content });
            } catch (e) {
                console.warn(`[ContextBar] 读取参考文件失败: ${ref.path}`, e);
            }
        }

        return results;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ---- 清理 ----

    cleanupDropdownItems() {
        this.dropdownCleanups.forEach(fn => fn());
        this.dropdownCleanups = [];
    }

    destroy() {
        this.hideFilePicker();
        this.cleanupDropdownItems();
        this.chipCleanups.forEach(fn => fn());
        this.chipCleanups = [];
        if (this.addBtnCleanup) {
            this.addBtnCleanup();
            this.addBtnCleanup = null;
        }
        this.element = null;
    }
}
