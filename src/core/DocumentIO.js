function normalizeNewlines(value) {
    return (value ?? '').replace(/\r\n/g, '\n');
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function clamp(value, min, max) {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, value));
}

function buildLineIndex(text) {
    const normalized = normalizeNewlines(text);
    if (!normalized) {
        return {
            text: normalized,
            totalLines: 0,
            offsets: [],
        };
    }

    const offsets = [0];
    for (let index = 0; index < normalized.length; index += 1) {
        if (normalized[index] === '\n') {
            offsets.push(index + 1);
        }
    }

    return {
        text: normalized,
        totalLines: offsets.length,
        offsets,
    };
}

function resolveRange(range = {}, totalLines) {
    if (totalLines === 0) {
        return {
            startLine: 0,
            endLine: 0,
            isValid: false,
        };
    }

    const startLine = clamp(Number(range.startLine || 1), 1, totalLines);
    const endLineCandidate = range.endLine != null ? Number(range.endLine) : startLine;
    const endLine = clamp(Number.isFinite(endLineCandidate) ? endLineCandidate : startLine, startLine, totalLines);

    return {
        startLine,
        endLine,
        isValid: true,
    };
}

function computeOffsets(index, resolvedRange) {
    const { offsets, text } = index;
    const { startLine, endLine } = resolvedRange;

    if (startLine === 0 && endLine === 0) {
        return {
            startOffset: 0,
            endOffset: 0,
        };
    }

    const totalLines = index.totalLines;
    const safeStart = clamp(startLine, 1, totalLines);
    const safeEnd = clamp(endLine, safeStart, totalLines);

    const startOffset = offsets[safeStart - 1];
    const endOffset = safeEnd >= totalLines ? text.length : offsets[safeEnd];

    return {
        startOffset,
        endOffset,
    };
}

function applyInsertAfter({ baseText, index, resolvedRange, insertText }) {
    if (!isNonEmptyString(insertText)) {
        throw new Error('插入内容不能为空');
    }

    if (index.totalLines === 0 || !resolvedRange.isValid) {
        const normalizedInsert = insertText;
        const nextContent = normalizedInsert;
        return {
            nextContent,
            appliedRange: {
                startLine: 1,
                endLine: Math.max(1, normalizedInsert.split('\n').length),
            },
        };
    }

    const { offsets } = index;
    const { endLine } = resolvedRange;
    const insertionOffset = endLine >= index.totalLines ? baseText.length : offsets[endLine];
    const before = baseText.slice(0, insertionOffset);
    const after = baseText.slice(insertionOffset);

    const needsLeadingBreak = before.length > 0 && !before.endsWith('\n');
    const needsTrailingBreak = after.length > 0 && !insertText.endsWith('\n') && !after.startsWith('\n');

    const leading = needsLeadingBreak ? '\n' : '';
    const trailing = needsTrailingBreak ? '\n' : '';
    const nextContent = `${before}${leading}${insertText}${trailing}${after}`;

    const insertedLineCount = insertText.split('\n').length;
    const appliedRange = {
        startLine: endLine + (needsLeadingBreak ? 1 : 0) + 1,
        endLine: endLine + (needsLeadingBreak ? 1 : 0) + insertedLineCount,
    };

    return {
        nextContent,
        appliedRange,
    };
}

function applyReplaceRange({ baseText, index, resolvedRange, insertText }) {
    if (!resolvedRange.isValid) {
        throw new Error('替换范围无效');
    }

    const { startOffset, endOffset } = computeOffsets(index, resolvedRange);
    const before = baseText.slice(0, startOffset);
    const after = baseText.slice(endOffset);

    const nextContent = `${before}${insertText}${after}`;
    const insertedLineCount = insertText ? insertText.split('\n').length : 0;
    const appliedRange = {
        startLine: resolvedRange.startLine,
        endLine: resolvedRange.startLine + Math.max(0, insertedLineCount - 1),
    };

    return {
        nextContent,
        appliedRange,
    };
}

function applyAppend({ baseText, insertText }) {
    const normalized = insertText;
    if (!baseText) {
        const insertedLineCount = normalized ? normalized.split('\n').length : 0;
        return {
            nextContent: normalized,
            appliedRange: {
                startLine: 1,
                endLine: Math.max(1, insertedLineCount),
            },
        };
    }

    const needsSeparation = !baseText.endsWith('\n');
    const separator = needsSeparation ? '\n\n' : '\n';
    const nextContent = `${baseText}${separator}${normalized}`;
    const originalLines = baseText.split('\n').length;
    const insertedLineCount = normalized ? normalized.split('\n').length : 0;

    return {
        nextContent,
        appliedRange: {
            startLine: originalLines + 1,
            endLine: originalLines + Math.max(1, insertedLineCount),
        },
    };
}

/**
 * 创建文档 I/O 控制器，提供受限的读写能力。
 */
export function createDocumentIO(options = {}) {
    const {
        eventBus,
        getCurrentFile,
        getEditor,
        getCodeEditor,
        getActiveViewMode,
        setHasUnsavedChanges,
        saveCurrentEditorContentToCache,
        fileSession,
        updateWindowTitle,
        persistWorkspaceState,
    } = options;

    function ensureActiveFile() {
        const filePath = getCurrentFile?.();
        if (!filePath) {
            throw new Error('当前没有打开的文档');
        }
        return filePath;
    }

    function getDocumentSnapshot() {
        const filePath = ensureActiveFile();

        const editor = getEditor?.();
        const codeEditor = getCodeEditor?.();
        const activeViewMode = getActiveViewMode?.() || 'markdown';

        let content = '';

        if (activeViewMode === 'markdown' && editor?.getMarkdown) {
            content = editor.getMarkdown();
        } else if (activeViewMode === 'code' && codeEditor) {
            content = typeof codeEditor.getValueForSave === 'function'
                ? codeEditor.getValueForSave()
                : codeEditor.getValue?.();
        } else if (editor?.getMarkdown) {
            content = editor.getMarkdown();
        }

        if (!content && codeEditor) {
            content = typeof codeEditor.getValueForSave === 'function'
                ? codeEditor.getValueForSave()
                : codeEditor.getValue?.();
        }

        if (!content && fileSession?.getCachedEntry) {
            const cached = fileSession.getCachedEntry(filePath);
            if (cached?.content) {
                content = cached.content;
            }
        }

        const normalized = normalizeNewlines(content);
        const totalLines = normalized ? normalized.split('\n').length : 0;

        return {
            filePath,
            content: normalized,
            totalLines,
        };
    }

    function emitOperationLog(event, payload) {
        if (!eventBus) {
            return;
        }
        try {
            eventBus.emit(`document:io:${event}`, payload);
        } catch (error) {
            console.warn('[DocumentIO] 事件发送失败', { event, error });
        }
    }

    function applyContentToEditors(nextContent) {
        const editor = getEditor?.();
        if (editor?.editor && editor?.md) {
            try {
                const html = editor.md.render(nextContent);
                editor.suppressUpdateEvent = true;
                editor.editor.commands.setContent(html);
            } catch (error) {
                console.warn('[DocumentIO] 更新 Markdown 编辑器失败:', error);
            } finally {
                editor.suppressUpdateEvent = false;
            }
            editor.contentChanged = true;
            editor.callbacks?.onContentChange?.();
        }

        const codeEditor = getCodeEditor?.();
        if (codeEditor?.currentModel) {
            try {
                codeEditor.suppressChange = true;
                codeEditor.currentModel.setValue(nextContent);
            } catch (error) {
                console.warn('[DocumentIO] 更新代码编辑器失败:', error);
            } finally {
                codeEditor.suppressChange = false;
            }
            codeEditor.isDirty = true;
            codeEditor.callbacks?.onContentChange?.();
        }
    }

    async function commitDocumentChanges({ filePath, nextContent, metadata }) {
        const sanitized = normalizeNewlines(nextContent);
        applyContentToEditors(sanitized);

        setHasUnsavedChanges?.(true);

        saveCurrentEditorContentToCache?.({
            currentFile: filePath,
            activeViewMode: getActiveViewMode?.(),
            editor: getEditor?.(),
            codeEditor: getCodeEditor?.(),
        });

        await Promise.resolve(updateWindowTitle?.());
        persistWorkspaceState?.();

        emitOperationLog('applied', {
            filePath,
            ...metadata,
            timestamp: Date.now(),
        });
    }

    return {
        getCapabilities() {
            return ['read_document', 'read_range', 'append_to_document', 'insert_after_range', 'replace_range'];
        },

        readDocument() {
            const snapshot = getDocumentSnapshot();
            return {
                filePath: snapshot.filePath,
                content: snapshot.content,
                totalLines: snapshot.totalLines,
            };
        },

        readRange(payload = {}) {
            const snapshot = getDocumentSnapshot();
            const index = buildLineIndex(snapshot.content);
            const requestedRange = resolveRange(payload.range || {}, index.totalLines || 0);

            if (!requestedRange.isValid) {
                return {
                    filePath: snapshot.filePath,
                    content: '',
                    range: { startLine: 0, endLine: 0 },
                    totalLines: index.totalLines,
                    hasMoreBefore: false,
                    hasMoreAfter: false,
                };
            }

            const { startOffset, endOffset } = computeOffsets(index, requestedRange);
            const chunk = snapshot.content.slice(startOffset, endOffset);

            const hasMoreBefore = requestedRange.startLine > 1;
            const hasMoreAfter = requestedRange.endLine < index.totalLines;

            emitOperationLog('read', {
                filePath: snapshot.filePath,
                range: requestedRange,
            });

            return {
                filePath: snapshot.filePath,
                content: chunk,
                range: requestedRange,
                totalLines: index.totalLines,
                hasMoreBefore,
                hasMoreAfter,
            };
        },

        appendToDocument(payload = {}) {
            const snapshot = getDocumentSnapshot();
            const content = normalizeNewlines(payload.content || '');
            if (!isNonEmptyString(content)) {
                throw new Error('append_to_document 需要提供 content');
            }

            const { nextContent, appliedRange } = applyAppend({
                baseText: snapshot.content,
                insertText: content,
            });

            return commitDocumentChanges({
                filePath: snapshot.filePath,
                nextContent,
                metadata: {
                    action: 'append_to_document',
                    appliedRange,
                    justification: payload.justification,
                    preview: payload.preview,
                },
            }).then(() => ({
                appliedRange,
                totalLines: nextContent ? nextContent.split('\n').length : 0,
            }));
        },

        insertAfterRange(payload = {}) {
            const snapshot = getDocumentSnapshot();
            const content = normalizeNewlines(payload.content || '');
            if (!isNonEmptyString(content)) {
                throw new Error('insert_after_range 需要提供 content');
            }

            const index = buildLineIndex(snapshot.content);
            const defaultRange = index.totalLines > 0
                ? { startLine: index.totalLines, endLine: index.totalLines }
                : { startLine: 1, endLine: 1 };
            const resolvedRange = resolveRange(payload.range || defaultRange, index.totalLines || 0);
            const { nextContent, appliedRange } = applyInsertAfter({
                baseText: snapshot.content,
                index,
                resolvedRange,
                insertText: content,
            });

            return commitDocumentChanges({
                filePath: snapshot.filePath,
                nextContent,
                metadata: {
                    action: 'insert_after_range',
                    anchorRange: resolvedRange,
                    appliedRange,
                    justification: payload.justification,
                    preview: payload.preview || content.slice(0, 200),
                },
            }).then(() => ({
                appliedRange,
                totalLines: nextContent ? nextContent.split('\n').length : 0,
            }));
        },

        replaceRange(payload = {}) {
            const snapshot = getDocumentSnapshot();
            const content = normalizeNewlines(payload.content || '');
            const index = buildLineIndex(snapshot.content);
            const resolvedRange = resolveRange(payload.range || {}, index.totalLines || 0);
            if (!resolvedRange.isValid) {
                throw new Error('replace_range 需要有效的范围');
            }

            const { nextContent, appliedRange } = applyReplaceRange({
                baseText: snapshot.content,
                index,
                resolvedRange,
                insertText: content,
            });

            return commitDocumentChanges({
                filePath: snapshot.filePath,
                nextContent,
                metadata: {
                    action: 'replace_range',
                    targetRange: resolvedRange,
                    appliedRange,
                    justification: payload.justification,
                    preview: payload.preview || content.slice(0, 200),
                },
            }).then(() => ({
                appliedRange,
                totalLines: nextContent ? nextContent.split('\n').length : 0,
            }));
        },
    };
}
