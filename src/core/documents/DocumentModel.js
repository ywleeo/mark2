/**
 * DocumentModel —— 文档内容与保存状态的唯一真源。
 *
 * 编辑器只负责展示和产生内容快照；dirty、saving、error 以及保存期间继续编辑的
 * 判定全部由本模型依据 revision 状态机完成。
 */

const DIRTY_CAPABLE_VIEW_MODES = new Set(['markdown', 'code']);

export const DOCUMENT_SAVE_STATE = Object.freeze({
    CLEAN: 'clean',
    DIRTY: 'dirty',
    SAVING: 'saving',
    ERROR: 'error',
});

export class DocumentModel {
    /**
     * @param {Object} init - 文档初始化参数
     * @param {string} init.uri - 文档唯一路径
     * @param {string} init.viewMode - 文档视图模式
     * @param {string} [init.content] - 初始磁盘内容
     * @param {number} [init.modifiedTime] - 磁盘修改时间
     * @param {string} [init.tabId] - 关联 tab id
     */
    constructor({ uri, viewMode, content = '', modifiedTime = 0, tabId = null }) {
        if (!uri) throw new Error('DocumentModel 需要 uri');
        if (!viewMode) throw new Error('DocumentModel 需要 viewMode');

        this.uri = uri;
        this.viewMode = viewMode;
        this.tabId = tabId || uri;
        this._content = typeof content === 'string' ? content : '';
        this._originalContent = this._content;
        this._modifiedTime = modifiedTime;
        this._revision = 0;
        this._persistedRevision = 0;
        this._saveState = DOCUMENT_SAVE_STATE.CLEAN;
        this._activeSave = null;
        this._saveCounter = 0;
        this._lastError = null;
        this._listeners = new Set();
        this._refCount = 0;
    }

    /** @returns {string} 当前编辑内容。 */
    getContent() {
        return this._content;
    }

    /** @returns {string} 最近一次成功写盘的精确内容。 */
    getOriginalContent() {
        return this._originalContent;
    }

    /** @returns {number} 当前编辑版本。 */
    getRevision() {
        return this._revision;
    }

    /** @returns {number} 最近成功写盘的版本。 */
    getPersistedRevision() {
        return this._persistedRevision;
    }

    /** @returns {string} 当前保存状态。 */
    getSaveState() {
        return this._saveState;
    }

    /** @returns {Error|null} 最近一次保存错误。 */
    getLastError() {
        return this._lastError;
    }

    /** @returns {number} 磁盘修改时间。 */
    getModifiedTime() {
        return this._modifiedTime;
    }

    /** 仅刷新磁盘元信息，不改变内容 revision。 */
    updateModifiedTime(modifiedTime) {
        if (typeof modifiedTime === 'number' && modifiedTime > 0) {
            this._modifiedTime = modifiedTime;
        }
    }

    /** dirty 只由 revision 差异派生。 */
    get dirty() {
        if (!DIRTY_CAPABLE_VIEW_MODES.has(this.viewMode)) return false;
        return this._revision !== this._persistedRevision;
    }

    /**
     * 接收编辑器产生的新内容快照并推进 revision。
     * @param {string} next - 编辑器当前内容
     * @param {Object} [options] - 更新元数据
     * @returns {number} 更新后的 revision
     */
    applyEditorChange(next, options = {}) {
        const value = typeof next === 'string' ? next : '';
        if (value === this._content) return this._revision;

        const previousDirty = this.dirty;
        this._content = value;
        this._revision += 1;
        if (this._saveState !== DOCUMENT_SAVE_STATE.SAVING) {
            // 内容撤销回最近一次写盘快照时，本 revision 与磁盘在语义上重新一致。
            // revision 仍保持单调递增，避免保存令牌和异步回调出现倒退版本。
            if (value === this._originalContent) {
                this._persistedRevision = this._revision;
                this._setSaveState(DOCUMENT_SAVE_STATE.CLEAN);
            } else {
                this._setSaveState(DOCUMENT_SAVE_STATE.DIRTY);
            }
        }
        this._emit({
            type: 'content',
            source: options.source || 'editor',
            revision: this._revision,
        });
        this._emitDirtyChange(previousDirty);
        return this._revision;
    }

    /**
     * 同步编辑器缓存。dirty=false 不能清除一个已经 dirty 的模型。
     * @param {Object} snapshot - 编辑器快照
     */
    applyEditorSnapshot({ content, originalContent, dirty }) {
        const value = typeof content === 'string' ? content : this._content;
        if (dirty) {
            if (typeof originalContent === 'string' && !this.dirty) {
                this._originalContent = originalContent;
            }
            if (value !== this._content || !this.dirty) {
                this.applyEditorChange(value, { source: 'editor-snapshot' });
            }
            return;
        }

        if (!this.dirty) {
            this._content = value;
            if (typeof originalContent === 'string') {
                this._originalContent = originalContent;
            }
        }
    }

    /**
     * 兼容受控内容更新；编辑器来源会推进 revision，外部 reload 应使用 reloadFromDisk。
     * @param {string} next - 新内容
     * @param {Object} [options] - 更新元数据
     */
    setContent(next, options = {}) {
        this.applyEditorChange(next, options);
    }

    /**
     * 创建保存令牌，锁定本次实际写盘的 revision 和内容。
     * @param {string} [content] - 本次写盘内容
     * @returns {{id:number,revision:number,content:string}}
     */
    beginSave(content = this._content) {
        const snapshotContent = typeof content === 'string' ? content : '';
        // 序列化可能只在保存时完成；更新快照内容但不把同一次编辑重复计为新 revision。
        this._content = snapshotContent;
        const token = Object.freeze({
            id: ++this._saveCounter,
            revision: this._revision,
            content: snapshotContent,
        });
        this._activeSave = token;
        this._lastError = null;
        this._setSaveState(DOCUMENT_SAVE_STATE.SAVING, { token });
        return token;
    }

    /**
     * 提交成功写盘的保存令牌；若期间 revision 已推进，状态仍保持 dirty。
     * @param {{id:number,revision:number,content:string}} token - beginSave 返回的令牌
     * @param {number} [modifiedTime] - 新磁盘修改时间
     * @returns {boolean} 提交后是否仍有未保存内容
     */
    commitSave(token, modifiedTime) {
        if (!token || this._activeSave?.id !== token.id) {
            return this.dirty;
        }
        const previousDirty = this.dirty;
        this._originalContent = token.content;
        this._persistedRevision = token.revision;
        this._activeSave = null;
        this._lastError = null;
        if (typeof modifiedTime === 'number' && modifiedTime > 0) {
            this._modifiedTime = modifiedTime;
        }
        this._setSaveState(this.dirty ? DOCUMENT_SAVE_STATE.DIRTY : DOCUMENT_SAVE_STATE.CLEAN, { token });
        this._emit({
            type: 'saved',
            modifiedTime: this._modifiedTime,
            revision: token.revision,
            pendingChanges: this.dirty,
        });
        this._emitDirtyChange(previousDirty);
        return this.dirty;
    }

    /**
     * 记录保存失败并保留当前 dirty。
     * @param {Object|null} token - 保存令牌
     * @param {unknown} error - 保存错误
     */
    failSave(token, error) {
        if (token && this._activeSave?.id !== token.id) return;
        this._activeSave = null;
        this._lastError = error instanceof Error ? error : new Error(String(error || '保存失败'));
        this._setSaveState(DOCUMENT_SAVE_STATE.ERROR, { error: this._lastError });
    }

    /**
     * 兼容旧调用：把当前 revision 作为保存版本提交。
     * @param {number} [modifiedTime] - 新磁盘修改时间
     */
    markSaved(modifiedTime) {
        const token = this.beginSave(this._content);
        this.commitSave(token, modifiedTime);
    }

    /** 将新建或导入内容标记为尚未落盘，不接受可能误清状态的布尔参数。 */
    markUnpersisted() {
        const previousDirty = this.dirty;
        if (!this.dirty) this._revision += 1;
        this._setSaveState(DOCUMENT_SAVE_STATE.DIRTY);
        this._emitDirtyChange(previousDirty);
    }

    /**
     * 从磁盘重新加载并重置 revision 状态机。
     * @param {string} content - 磁盘内容
     * @param {number} [modifiedTime] - 磁盘修改时间
     */
    reloadFromDisk(content, modifiedTime) {
        const previousDirty = this.dirty;
        this._content = typeof content === 'string' ? content : '';
        this._originalContent = this._content;
        this._revision += 1;
        this._persistedRevision = this._revision;
        this._activeSave = null;
        this._lastError = null;
        if (typeof modifiedTime === 'number' && modifiedTime > 0) {
            this._modifiedTime = modifiedTime;
        }
        this._setSaveState(DOCUMENT_SAVE_STATE.CLEAN);
        this._emit({ type: 'reload', modifiedTime: this._modifiedTime, revision: this._revision });
        this._emitDirtyChange(previousDirty);
    }

    /** @param {string} nextUri - 新文档路径。 */
    rename(nextUri) {
        if (!nextUri || nextUri === this.uri) return;
        const oldUri = this.uri;
        this.uri = nextUri;
        this.tabId = nextUri;
        this._emit({ type: 'rename', oldUri, newUri: nextUri });
    }

    /** @param {(event:Object)=>void} listener - 文档事件监听器。 */
    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    /** @returns {number} 增加后的引用数。 */
    acquire() {
        this._refCount += 1;
        return this._refCount;
    }

    /** @returns {number} 减少后的引用数。 */
    release() {
        if (this._refCount > 0) this._refCount -= 1;
        return this._refCount;
    }

    /** @returns {number} 当前引用数。 */
    getRefCount() {
        return this._refCount;
    }

    /** 更新保存状态并广播。 */
    _setSaveState(nextState, details = {}) {
        if (this._saveState === nextState) return;
        const previousState = this._saveState;
        this._saveState = nextState;
        this._emit({ type: 'save-state', previousState, state: nextState, ...details });
    }

    /** dirty 发生变化时广播派生状态。 */
    _emitDirtyChange(previousDirty) {
        if (this.dirty !== previousDirty) {
            this._emit({ type: 'dirty', dirty: this.dirty, revision: this._revision });
        }
    }

    /** 安全广播文档事件。 */
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
