/**
 * DocumentModel —— 单一真源文档模型。
 *
 * 职责：
 *   - 持有一份权威内容（_content）与磁盘基线（_originalContent）。
 *   - dirty 由 `_content !== _originalContent` 派生，不允许外部写 dirty。
 *   - 通过订阅通知视图层：内容变更、保存、reload、rename。
 *   - 通过 acquire/release 做引用计数，为多视图共享同一文档做准备。
 *
 * 设计要点：
 *   - 二进制/不可编辑的 viewMode（image/pdf/media/docx/pptx/spreadsheet）始终 dirty = false。
 *   - TipTap 序列化非幂等：未修改时严禁把 editor.getMarkdown() 回写为 _content；
 *     本类保证只在调用方显式 setContent(next, { source: 'editor' }) 时才更新 _content。
 *   - 不做磁盘 I/O，只管内存中的真源。实际读写由 fileService / SaveManager 负责。
 */

const DIRTY_CAPABLE_VIEW_MODES = new Set(['markdown', 'code']);

export class DocumentModel {
    /**
     * @param {Object} init
     * @param {string} init.uri            文档唯一标识（磁盘路径或 untitled://...）
     * @param {string} init.viewMode       视图模式（markdown/code/image/pdf/...）
     * @param {string} [init.content]      初始内容（磁盘加载得到）
     * @param {number} [init.modifiedTime] 磁盘 mtime（毫秒）
     * @param {string} [init.tabId]        关联 tab id（若与 uri 不同）
     */
    constructor({ uri, viewMode, content = '', modifiedTime = 0, tabId = null }) {
        if (!uri) throw new Error('DocumentModel 需要 uri');
        if (!viewMode) throw new Error('DocumentModel 需要 viewMode');

        this.uri = uri;
        this.viewMode = viewMode;
        this.tabId = tabId || uri;

        this._content = content;
        this._originalContent = content;
        this._modifiedTime = modifiedTime;
        this._listeners = new Set();
        this._refCount = 0;
        // 显式 dirty 覆盖:当编辑器序列化非幂等(TipTap)时,
        // _content===_originalContent 并不可靠,允许调用方直接告知 dirty 真值。
        // null 表示无覆盖,使用 _content vs _originalContent 比较。
        this._explicitDirty = null;
    }

    /**
     * 当前内容。调用方可自由读取，修改必须走 setContent。
     */
    getContent() {
        return this._content;
    }

    /**
     * 磁盘基线。用于 TipTap 等非幂等序列化场景：未 dirty 时直接返回原文避免回环腐蚀。
     */
    getOriginalContent() {
        return this._originalContent;
    }

    /**
     * 磁盘 mtime（毫秒）。外部变更检测用。
     */
    getModifiedTime() {
        return this._modifiedTime;
    }

    /**
     * 派生 dirty。binary/不可编辑类视图永远返回 false。
     * 若调用方设置了显式 dirty 覆盖(editor 场景),以覆盖值为准。
     */
    get dirty() {
        if (!DIRTY_CAPABLE_VIEW_MODES.has(this.viewMode)) return false;
        if (this._explicitDirty !== null) return this._explicitDirty;
        return this._content !== this._originalContent;
    }

    /**
     * 编辑器侧批量同步内容与 dirty(tab 切换/保存前)。
     * 避免 TipTap 序列化非幂等带来的 dirty 误判。
     * @param {Object} snapshot
     * @param {string} snapshot.content
     * @param {string} [snapshot.originalContent]
     * @param {boolean} snapshot.dirty
     */
    applyEditorSnapshot({ content, originalContent, dirty }) {
        if (typeof content === 'string') this._content = content;
        if (typeof originalContent === 'string') this._originalContent = originalContent;
        const prevDirty = this.dirty;
        this._explicitDirty = Boolean(dirty);
        if (this.dirty !== prevDirty) {
            this._emit({ type: 'dirty', dirty: this.dirty });
        }
    }

    /**
     * 更新内容。
     * @param {string} next - 新内容
     * @param {Object} [opts]
     * @param {string} [opts.source] - 来源标识（editor / cache / external）
     */
    setContent(next, opts = {}) {
        const value = typeof next === 'string' ? next : '';
        if (value === this._content) return;
        const prevDirty = this.dirty;
        this._content = value;
        this._emit({ type: 'content', source: opts.source || 'unknown' });
        if (this.dirty !== prevDirty) {
            this._emit({ type: 'dirty', dirty: this.dirty });
        }
    }

    /**
     * 保存后调用：把当前内容作为新基线，并刷新 mtime。
     * @param {number} modifiedTime - 新 mtime（毫秒）
     */
    markSaved(modifiedTime) {
        const prevDirty = this.dirty;
        this._originalContent = this._content;
        this._explicitDirty = false;
        if (typeof modifiedTime === 'number' && modifiedTime > 0) {
            this._modifiedTime = modifiedTime;
        }
        this._emit({ type: 'saved', modifiedTime: this._modifiedTime });
        if (this.dirty !== prevDirty) {
            this._emit({ type: 'dirty', dirty: this.dirty });
        }
    }

    /**
     * 外部文件被改动后 reload：重写内容与基线。
     * @param {string} content
     * @param {number} [modifiedTime]
     */
    reloadFromDisk(content, modifiedTime) {
        const prevDirty = this.dirty;
        this._content = typeof content === 'string' ? content : '';
        this._originalContent = this._content;
        this._explicitDirty = null;
        if (typeof modifiedTime === 'number' && modifiedTime > 0) {
            this._modifiedTime = modifiedTime;
        }
        this._emit({ type: 'reload', modifiedTime: this._modifiedTime });
        if (this.dirty !== prevDirty) {
            this._emit({ type: 'dirty', dirty: this.dirty });
        }
    }

    /**
     * 重命名文档：更新 uri。
     * @param {string} nextUri
     */
    rename(nextUri) {
        if (!nextUri || nextUri === this.uri) return;
        const oldUri = this.uri;
        this.uri = nextUri;
        this.tabId = nextUri;
        this._emit({ type: 'rename', oldUri, newUri: nextUri });
    }

    /**
     * 订阅文档事件。
     * @param {(event: Object) => void} listener
     * @returns {() => void} 退订函数
     */
    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    acquire() {
        this._refCount += 1;
        return this._refCount;
    }

    release() {
        if (this._refCount > 0) this._refCount -= 1;
        return this._refCount;
    }

    getRefCount() {
        return this._refCount;
    }

    _emit(event) {
        for (const listener of this._listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[DocumentModel] listener 异常:', error);
            }
        }
    }
}
