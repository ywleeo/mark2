import { isEmbedFilePath } from '../utils/fileTypeUtils.js';

/**
 * embed(渲染视图)↔ code 切换。结构与 svgCodeMode 一致:
 * - 渲染视图 → code:用真正的 CodeMirror(codeEditor.show)编辑源码,不另做编辑器。
 * - code → 渲染视图:有改动先写回磁盘,再重跑该文件的 embed renderer 重新渲染。
 *
 * 对 embed 类型保持通用:通过 renderer registry 取 handler 重渲染,不依赖具体类型(html 等)。
 */
export function createEmbedCodeMode({
    view,
    getRendererForPath,
    getFileContent,
    getEmbedHost,
}) {
    if (!view || typeof view.activate !== 'function') {
        throw new Error('createEmbedCodeMode 需要 view 协议');
    }

    async function toggle({ currentFile, activeViewMode, codeEditor, fileService }) {
        if (!currentFile || !codeEditor || !fileService) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }
        if (!isEmbedFilePath(currentFile)) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }

        // 渲染视图 → code:加载源码到 CodeMirror
        if (activeViewMode === 'embed') {
            view.activate('code');
            const content = await fileService.readText(currentFile);
            await codeEditor.show(currentFile, content, 'html', null, { tabId: currentFile });
            return { changed: true, nextViewMode: 'code', hasUnsavedChanges: false };
        }

        // code → 渲染视图:先存盘(若有改动),再重跑 embed renderer
        if (activeViewMode === 'code') {
            codeEditor?.saveViewStateForTab?.(currentFile);
            if (codeEditor.hasUnsavedChanges?.()) {
                try {
                    const content = typeof codeEditor.getValueForSave === 'function'
                        ? codeEditor.getValueForSave()
                        : codeEditor.getValue();
                    await fileService.writeText(currentFile, content);
                    codeEditor.markSaved?.();
                } catch (error) {
                    console.error('[embedCodeMode] 写回失败:', error);
                }
            }

            view.activate('embed');
            const renderer = getRendererForPath?.(currentFile);
            const fileData = (await getFileContent?.(currentFile)) || {};
            await renderer?.load?.({
                filePath: currentFile,
                fileData,
                embedHost: getEmbedHost?.(),
                view,
            });
            return { changed: true, nextViewMode: 'embed', hasUnsavedChanges: false };
        }

        return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
    }

    return { toggle };
}
