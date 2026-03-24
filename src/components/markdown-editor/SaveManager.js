import { getAppServices } from '../../services/appServices.js';
import { normalizeFsPath } from '../../utils/pathUtils.js';
import { DEFAULT_AUTO_SAVE_DELAY, MIN_AUTO_SAVE_DELAY } from './constants.js';

/**
 * 管理编辑器的自动保存和手动保存逻辑。
 *
 * 依赖注入（全部通过 getter 函数，避免状态快照）：
 *   getMarkdown()           — 获取当前序列化后的 Markdown 字符串
 *   getCurrentFile()        — 获取当前文件路径
 *   getCurrentSessionId()   — 获取当前会话 ID
 *   isSessionActive(id)     — 判断某会话是否仍然有效
 *   isLoadingFile()         — 是否正在加载文件（加载期间推迟自动保存）
 *   isContentChanged()      — 内容是否已变更
 *   setContentChanged(v)    — 更新 contentChanged 标记
 *   getOriginalMarkdown()   — 获取上次保存的原始 Markdown
 *   setOriginalMarkdown(v)  — 更新原始 Markdown
 *   documentSessions        — 文档会话对象（可选）
 *   callbacks               — { onContentChange, onAutoSaveSuccess, onAutoSaveError }
 *   autoSaveDelayMs         — 自动保存延迟（毫秒）
 */
export class SaveManager {
    constructor({
        getMarkdown,
        getCurrentFile,
        getCurrentSessionId,
        isSessionActive,
        isLoadingFile,
        isContentChanged,
        setContentChanged,
        getOriginalMarkdown,
        setOriginalMarkdown,
        documentSessions = null,
        callbacks = {},
        autoSaveDelayMs = DEFAULT_AUTO_SAVE_DELAY,
    }) {
        this.getMarkdown = getMarkdown;
        this.getCurrentFile = getCurrentFile;
        this.getCurrentSessionId = getCurrentSessionId;
        this.isSessionActive = isSessionActive;
        this.isLoadingFile = isLoadingFile;
        this.isContentChanged = isContentChanged;
        this.setContentChanged = setContentChanged;
        this.getOriginalMarkdown = getOriginalMarkdown;
        this.setOriginalMarkdown = setOriginalMarkdown;
        this.documentSessions = documentSessions;
        this.callbacks = callbacks;
        this.autoSaveDelayMs = Number.isFinite(autoSaveDelayMs)
            ? Math.max(MIN_AUTO_SAVE_DELAY, autoSaveDelayMs)
            : DEFAULT_AUTO_SAVE_DELAY;

        this.autoSaveTimer = null;
        this.autoSavePlannedSessionId = null;
        this.isSaving = false;
        this.activeSavePromise = null;
        this.lastSaveError = null;
    }

    clearAutoSaveTimer() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        this.autoSavePlannedSessionId = null;
    }

    scheduleAutoSave() {
        if (!this.autoSaveDelayMs || this.autoSaveDelayMs < 0) return;
        this.clearAutoSaveTimer();
        const plannedSessionId = this.getCurrentSessionId();
        this.autoSavePlannedSessionId = plannedSessionId;
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            const sessionId = this.autoSavePlannedSessionId ?? plannedSessionId;
            this.autoSavePlannedSessionId = null;
            void this.handleAutoSaveTrigger(sessionId);
        }, this.autoSaveDelayMs);
    }

    async handleAutoSaveTrigger(targetSessionId = null) {
        const sessionId = typeof targetSessionId === 'number'
            ? targetSessionId
            : this.getCurrentSessionId();
        if (sessionId && !this.isSessionActive(sessionId)) return;
        if (sessionId && sessionId !== this.getCurrentSessionId()) return;
        if (this.isLoadingFile()) {
            this.scheduleAutoSave();
            return;
        }
        if (!this.isContentChanged() || !this.getCurrentFile()) return;
        if (this.isSaving) {
            this.scheduleAutoSave();
            return;
        }
        const result = await this.save({ reason: 'auto', sessionId });
        if (!result && this.isContentChanged()) {
            this.scheduleAutoSave();
        }
    }

    async save(options = {}) {
        const { force = false, reason = 'manual', sessionId: explicitSessionId = null } = options;
        const targetSessionId = explicitSessionId ?? this.getCurrentSessionId() ?? null;
        const targetFile = this.getCurrentFile();

        if (!targetFile) return false;

        // untitled 文件不自动保存
        if (targetFile.startsWith('untitled://')) {
            if (reason === 'auto') return true;
            return false;
        }

        if (targetSessionId && !this.isSessionActive(targetSessionId)) return false;

        let pendingMarkdown = null;
        if (this.isContentChanged()) {
            pendingMarkdown = this.getMarkdown();
            if (!force && pendingMarkdown === this.getOriginalMarkdown()) {
                this.setContentChanged(false);
                this.callbacks.onContentChange?.();
                if (reason === 'auto') {
                    Promise.resolve(this.callbacks.onAutoSaveSuccess?.({ skipped: true })).catch(error => {
                        console.warn('[SaveManager] 自动保存回调失败', error);
                    });
                }
                return true;
            }
        }

        if (!force && !this.isContentChanged()) {
            if (reason === 'auto') {
                Promise.resolve(this.callbacks.onAutoSaveSuccess?.({ skipped: true })).catch(error => {
                    console.warn('[SaveManager] 自动保存回调失败', error);
                });
            }
            return true;
        }

        if (this.isSaving) {
            return this.activeSavePromise ?? false;
        }

        this.clearAutoSaveTimer();
        this.isSaving = true;
        this.lastSaveError = null;

        const localWriteKey = normalizeFsPath(targetFile) || targetFile;
        const savePromise = (async () => {
            try {
                const markdown = pendingMarkdown ?? this.getMarkdown();
                const services = getAppServices();
                if (localWriteKey && this.documentSessions?.markLocalWrite) {
                    this.documentSessions.markLocalWrite(localWriteKey);
                }
                await services.file.writeText(targetFile, markdown);
                if (!targetSessionId || targetSessionId === this.getCurrentSessionId()) {
                    this.setOriginalMarkdown(markdown);
                    this.setContentChanged(false);
                    this.callbacks.onContentChange?.();
                }
                return true;
            } catch (error) {
                if (localWriteKey && this.documentSessions?.clearLocalWriteSuppression) {
                    this.documentSessions.clearLocalWriteSuppression(localWriteKey);
                }
                this.lastSaveError = error;
                console.error('保存失败:', error);
                return false;
            } finally {
                this.isSaving = false;
                this.activeSavePromise = null;
            }
        })();

        this.activeSavePromise = savePromise;
        const result = await savePromise;

        if (reason === 'auto') {
            if (result) {
                Promise.resolve(
                    this.callbacks.onAutoSaveSuccess?.({ skipped: false, filePath: targetFile })
                ).catch(error => {
                    console.warn('[SaveManager] 自动保存回调失败', error);
                });
            } else {
                Promise.resolve(this.callbacks.onAutoSaveError?.(this.lastSaveError)).catch(error => {
                    console.warn('[SaveManager] 自动保存错误回调失败', error);
                });
            }
        }

        return result;
    }

    destroy() {
        this.clearAutoSaveTimer();
    }
}
