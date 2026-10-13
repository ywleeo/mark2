/** 关闭临时草稿时按目标文档读取内容，后台草稿不能读取当前编辑器。 */

/** 活动草稿使用实时编辑器快照；后台草稿优先使用模型，空内容也具有权威性。 */
export function getUntitledCloseContent({ path, isActive, getActiveContent, documentRegistry, untitledFileManager }) {
    if (isActive) return getActiveContent() || '';
    const content = documentRegistry?.getDocument?.(path)?.getContent?.();
    return typeof content === 'string' ? content : untitledFileManager?.getContent?.(path) || '';
}
