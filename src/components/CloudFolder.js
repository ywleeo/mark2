/**
 * 侧边栏「云文件夹」区块。
 *
 * 登录后显示;列出 mark2 cloud 上的文件(服务端存储是扁平的,无目录层级)。
 * MVP 能力:
 *   - 列表 + 刷新
 *   - 点击 → 取原文开成本地 untitled tab(跟分享 deeplink 打开一致)
 *   - 上传:头部按钮 → 系统文件选择器 → 上传
 *   - 右键:下载到本地(保存对话框)/ 删除
 * 拖拽(本地↔云双向)留作下一轮,需要改本地树的 FileMover。
 */

import { addClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';
import { getFileIconSvg } from '../utils/fileIcons.js';
import { t } from '../i18n/index.js';
import { subscribe, getState } from '../modules/cloud-account/accountState.js';
import { api, ServerError } from '../modules/cloud-account/serverApi.js';
import { eventBus } from '../core/EventBus.js';

const REFRESH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>`;
const UPLOAD_ICON  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/></svg>`;
const CLOUD_ICON   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5-1.5A4 4 0 0 0 6 19z"/></svg>`;
const CHEVRON_ICON = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>`;
// 未下载(预取未完成)状态:云 + 下箭头
const PENDING_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 17a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5-1.5A4 4 0 0 0 5.5 17"/><path d="M12 11v8"/><path d="m8.5 15.5 3.5 3.5 3.5-3.5"/></svg>`;
// 上传中(存回云端)状态:云 + 上箭头
const SYNC_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5-1.5A4 4 0 0 0 6 19"/><path d="M12 19v-8"/><path d="m8.5 14.5 3.5-3.5 3.5 3.5"/></svg>`;

export class CloudFolder {
    /**
     * @param {HTMLElement} container
     * @param {Object} deps
     * @param {(args:{content:string, filename:string})=>Promise<void>} deps.openAsUntitled
     * @param {(path:string, content:string)=>Promise<any>} deps.writeTextFile
     * @param {()=>Promise<string[]>|string[]} deps.pickUploadFiles  打开系统文件选择器,返回选中的本地路径
     * @param {(localPath:string)=>Promise<string>} deps.readLocalText  读本地文件文本
     * @param {(defaultName:string)=>Promise<string|null>} deps.pickSaveTarget  保存对话框,返回目标路径
     * @param {(msg:string, opts?:Object)=>Promise<boolean>} [deps.confirm]
     */
    constructor(container, deps = {}) {
        this.container = container;
        this.deps = deps;
        this.files = [];
        this.loading = false;
        this.error = null;
        this.expanded = true;
        this._loadedOnce = false;
        this._cleanups = [];
        this._menuEl = null;
        this._openedPaths = new Map();  // fileId → 已打开的 untitled 路径(去重聚焦用)
        this._opening = new Set();      // 正在打开的 fileId(in-flight 并发守卫)
        this._contentCache = new Map(); // fileId → content(后台预取,点击秒开)
        this._syncing = new Set();      // 正在存回云端的 fileId(重渲染后仍要保持状态)

        this._unsub = subscribe((state) => this._onState(state));
        // 文档存回云端期间,在对应行显示「上传中」状态(由 cloudDocSync 广播)
        this._busUnsubs = [
            eventBus.on('cloud:doc-sync-start', ({ fileId } = {}) => this._setRowSyncing(fileId, true)),
            eventBus.on('cloud:doc-sync-end', ({ fileId } = {}) => this._setRowSyncing(fileId, false)),
        ];
    }

    _onState(state) {
        const loggedIn = state.status === 'logged-in' && !!state.token;
        this.container.style.display = loggedIn ? '' : 'none';
        if (loggedIn) {
            if (!this._loadedOnce) {
                this._loadedOnce = true;
                void this.refresh();
                return; // refresh 内部会 render
            }
        } else {
            this._loadedOnce = false;
            this.files = [];
            this._contentCache.clear();
            this._openedPaths.clear();
        }
        this.render();
    }

    async refresh() {
        const { token } = getState();
        if (!token) return;
        this.loading = true;
        this.error = null;
        this.render();
        try {
            const resp = await api.listFiles({ token });
            this.files = Array.isArray(resp?.files) ? resp.files : [];
        } catch (e) {
            this.error = (e instanceof ServerError ? e.message : null) || t('cloudFolder.loadFailed');
        } finally {
            this.loading = false;
            this.render();
            this._prefetchAll();  // 列表回来后后台预取内容,点击秒开
        }
    }

    /**
     * 后台并发预取所有还没缓存的文件内容(markdown 都很小)。
     * fire-and-forget;失败的留给点击时按需取兜底。content 按 fileId 不可变,缓存可长留。
     */
    _prefetchAll() {
        const { token } = getState();
        if (!token) return;
        const targets = this.files.filter((f) => f && !this._contentCache.has(f.id));
        if (targets.length === 0) return;

        const CONCURRENCY = 4;
        let cursor = 0;
        const worker = async () => {
            while (cursor < targets.length) {
                const file = targets[cursor++];
                if (this._contentCache.has(file.id)) continue;
                try {
                    const resp = await api.fileContent({ file_id: file.id, token });
                    if (resp && typeof resp.content === 'string') {
                        this._contentCache.set(file.id, resp.content);
                        this._markRowDownloaded(file.id);
                    }
                } catch (_) { /* 忽略,点击时再取 */ }
            }
        };
        for (let i = 0; i < CONCURRENCY; i += 1) void worker();
    }

    render() {
        if (!this.container) return;
        this._teardownRows();
        this.container.innerHTML = '';

        // ── header:复用文件树的 .section-header,保证 padding/标题/高度与 open-files 一致 ──
        const header = document.createElement('div');
        header.className = 'section-header' + (this.expanded ? '' : ' collapsed');

        const cloudIcon = document.createElement('span');
        cloudIcon.className = 'cloud-files-icon';
        cloudIcon.innerHTML = CLOUD_ICON;
        header.appendChild(cloudIcon);

        const title = document.createElement('span');
        title.className = 'section-title';
        title.textContent = t('cloudFolder.title');
        header.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'section-header-actions';

        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'section-action-btn';
        uploadBtn.title = t('cloudFolder.upload');
        uploadBtn.innerHTML = UPLOAD_ICON;
        this._push(addClickHandler(uploadBtn, () => this._uploadFlow()));
        actions.appendChild(uploadBtn);

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'section-action-btn';
        refreshBtn.title = t('cloudFolder.refresh');
        refreshBtn.innerHTML = REFRESH_ICON;
        if (this.loading) refreshBtn.classList.add('is-spinning');
        this._push(addClickHandler(refreshBtn, () => this.refresh()));
        actions.appendChild(refreshBtn);

        const caret = document.createElement('span');
        caret.className = 'section-collapse-indicator';
        caret.innerHTML = CHEVRON_ICON;
        actions.appendChild(caret);

        header.appendChild(actions);

        // 点 header(非 actions 区)折叠/展开
        this._push(addClickHandler(header, (e) => {
            if (e?.target?.closest?.('.section-header-actions')) return;
            this.expanded = !this.expanded;
            this.render();
        }));
        this.container.appendChild(header);

        // ── content:复用 .section-content,overlay 滚动条不占宽,行距/宽度与 open-files 一致 ──
        const content = document.createElement('div');
        content.className = 'section-content';
        if (!this.expanded) content.style.display = 'none';

        if (this.loading && this.files.length === 0) {
            content.innerHTML = `<div class="cloud-folder__hint">${t('cloudFolder.loading')}</div>`;
        } else if (this.error) {
            const h = document.createElement('div');
            h.className = 'cloud-folder__hint cloud-folder__hint--error';
            h.textContent = this.error;
            content.appendChild(h);
        } else if (this.files.length === 0) {
            content.innerHTML = `<div class="cloud-folder__hint">${t('cloudFolder.empty')}</div>`;
        } else {
            this.files.forEach((file) => content.appendChild(this._renderRow(file)));
        }

        this.container.appendChild(content);
    }

    _renderRow(file) {
        const name = file.filename || `file-${file.id}`;
        // 同时挂 open-file-item:直接吃 open-files 的行布局/宽度/行距;cloud-file-item 只加云端专属(spinner/状态)
        const item = document.createElement('div');
        item.className = 'open-file-item cloud-file-item';
        item.dataset.id = String(file.id);
        item.title = name;
        item.innerHTML = getFileIconSvg(name, { className: 'open-file-icon', size: 14 });
        const nameEl = document.createElement('span');
        nameEl.className = 'open-file-name';
        nameEl.textContent = name;   // 普通文本;.open-file-name 已 overflow:hidden,这里靠 CSS 省略号
        item.appendChild(nameEl);
        const spinner = document.createElement('span');
        spinner.className = 'cloud-file-spinner';
        item.appendChild(spinner);
        // 未下载(预取未完成)→ 行尾显示 pending 图标,下完移除
        if (!this._contentCache.has(file.id)) {
            const status = document.createElement('span');
            status.className = 'cloud-file-status';
            status.title = t('cloudFolder.notDownloaded');
            status.innerHTML = PENDING_ICON;
            item.appendChild(status);
        }
        // 打开中(并发 / refresh 重渲染期间)保持 loading 态
        if (this._opening.has(file.id)) item.classList.add('is-loading');
        // 存回云端中(重渲染期间)保持「上传中」态
        if (this._syncing.has(file.id)) {
            item.classList.add('is-syncing');
            const sync = document.createElement('span');
            sync.className = 'cloud-file-sync';
            sync.title = t('cloudFolder.saveToCloud.syncing');
            sync.innerHTML = SYNC_ICON;
            item.appendChild(sync);
        }

        this._push(addClickHandler(item, () => this._openFile(file)));

        const onContext = (e) => {
            e.preventDefault();
            this._showContextMenu(e.clientX, e.clientY, file);
        };
        item.addEventListener('contextmenu', onContext);
        this._push(() => item.removeEventListener('contextmenu', onContext));

        return item;
    }

    // ── 操作 ──

    async _openFile(file) {
        const { token } = getState();
        if (!token) return;

        // 1) 已经为这个云文件开过 tab 且还在 → 聚焦它,不再开新的
        const known = this._openedPaths.get(file.id);
        if (known && this.deps.focusDocumentIfOpen?.(known)) {
            return;
        }

        const filename = file.filename || `file-${file.id}.md`;

        // 2) 命中预取缓存 → 秒开,无需网络、无需 spinner
        if (this._contentCache.has(file.id)) {
            const path = await this.deps.openAsUntitled?.({ content: this._contentCache.get(file.id), filename, cloudFileId: file.id });
            if (typeof path === 'string' && path) this._openedPaths.set(file.id, path);
            return;
        }

        // 3) 未缓存(预取还没轮到 / 失败)→ 按需取,带 in-flight 守卫 + loading 反馈
        if (this._opening.has(file.id)) return;
        this._opening.add(file.id);
        this._setRowLoading(file.id, true);
        try {
            const resp = await api.fileContent({ file_id: file.id, token });
            const content = (resp && typeof resp.content === 'string') ? resp.content : '';
            this._contentCache.set(file.id, content);
            this._markRowDownloaded(file.id);
            const path = await this.deps.openAsUntitled?.({ content, filename, cloudFileId: file.id });
            if (typeof path === 'string' && path) this._openedPaths.set(file.id, path);
        } catch (e) {
            console.error('[cloudFolder] open failed:', e);
        } finally {
            this._opening.delete(file.id);
            this._setRowLoading(file.id, false);
        }
    }

    // 直接 toggle 行的 loading 态(不整块重渲染,避免闪)
    _setRowLoading(fileId, loading) {
        const row = this._rowEl(fileId);
        if (row) row.classList.toggle('is-loading', loading);
    }

    // 预取/按需取完成后移除该行的"未下载"图标
    _markRowDownloaded(fileId) {
        this._rowEl(fileId)?.querySelector('.cloud-file-status')?.remove();
    }

    // 文档存回云端期间在对应行显示「上传中」云朵,完成后移除
    _setRowSyncing(fileId, syncing) {
        if (fileId == null) return;
        if (syncing) this._syncing.add(fileId); else this._syncing.delete(fileId);
        const row = this._rowEl(fileId);
        if (!row) return;
        row.classList.toggle('is-syncing', syncing);
        let badge = row.querySelector('.cloud-file-sync');
        if (syncing && !badge) {
            badge = document.createElement('span');
            badge.className = 'cloud-file-sync';
            badge.title = t('cloudFolder.saveToCloud.syncing');
            badge.innerHTML = SYNC_ICON;
            row.appendChild(badge);
        } else if (!syncing && badge) {
            badge.remove();
        }
    }

    _rowEl(fileId) {
        return this.container?.querySelector(
            `.cloud-file-item[data-id="${CSS.escape(String(fileId))}"]`
        ) || null;
    }

    async _uploadFlow() {
        try {
            const paths = await this.deps.pickUploadFiles?.();
            if (!Array.isArray(paths) || paths.length === 0) return;
            const { token } = getState();
            if (!token) return;
            for (const p of paths) {
                const text = await this.deps.readLocalText?.(p);
                if (typeof text !== 'string') continue;
                const blob = new Blob([text], { type: 'text/plain' });
                await api.uploadFile({ blob, filename: basename(p) || 'upload.txt', token });
            }
            await this.refresh();
        } catch (e) {
            console.error('[cloudFolder] upload failed:', e);
        }
    }

    async _downloadFile(file) {
        const { token } = getState();
        if (!token) return;
        try {
            const target = await this.deps.pickSaveTarget?.(file.filename || `file-${file.id}`);
            if (!target) return;
            const resp = await api.fileContent({ file_id: file.id, token });
            const content = (resp && typeof resp.content === 'string') ? resp.content : '';
            await this.deps.writeTextFile?.(target, content);
        } catch (e) {
            console.error('[cloudFolder] download failed:', e);
        }
    }

    async _deleteFile(file) {
        const ok = this.deps.confirm
            ? await this.deps.confirm(t('cloudFolder.confirmDelete', { name: file.filename || '' }))
            : true;
        if (!ok) return;
        const { token } = getState();
        if (!token) return;
        try {
            await api.deleteFile({ file_id: file.id, token });
            await this.refresh();
        } catch (e) {
            console.error('[cloudFolder] delete failed:', e);
        }
    }

    // ── 右键菜单 ──

    _showContextMenu(x, y, file) {
        this._closeContextMenu();
        const menu = document.createElement('div');
        menu.className = 'cloud-folder__menu';
        const items = [
            { label: t('cloudFolder.download'), fn: () => this._downloadFile(file) },
            { label: t('cloudFolder.delete'),   fn: () => this._deleteFile(file), danger: true },
        ];
        items.forEach(({ label, fn, danger }) => {
            const it = document.createElement('button');
            it.type = 'button';
            it.className = 'cloud-folder__menu-item' + (danger ? ' is-danger' : '');
            it.textContent = label;
            addClickHandler(it, () => { this._closeContextMenu(); fn(); });
            menu.appendChild(it);
        });
        document.body.appendChild(menu);
        // 防越界
        const vw = window.innerWidth, vh = window.innerHeight;
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.min(x, vw - rect.width - 8)}px`;
        menu.style.top  = `${Math.min(y, vh - rect.height - 8)}px`;

        const onDocDown = (e) => { if (!menu.contains(e.target)) this._closeContextMenu(); };
        setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
        this._menuCleanup = () => document.removeEventListener('mousedown', onDocDown, true);
        this._menuEl = menu;
    }

    _closeContextMenu() {
        if (this._menuCleanup) { this._menuCleanup(); this._menuCleanup = null; }
        if (this._menuEl) { this._menuEl.remove(); this._menuEl = null; }
    }

    // ── 生命周期 ──

    _push(fn) { if (typeof fn === 'function') this._cleanups.push(fn); }

    _teardownRows() {
        this._cleanups.forEach((fn) => { try { fn(); } catch (_) {} });
        this._cleanups = [];
    }

    destroy() {
        this._closeContextMenu();
        this._teardownRows();
        this._unsub?.();
        this._busUnsubs?.forEach((fn) => { try { fn(); } catch (_) {} });
        this._busUnsubs = [];
        if (this.container) this.container.innerHTML = '';
    }
}
