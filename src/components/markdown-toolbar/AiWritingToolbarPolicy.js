/**
 * AI 工具栏动作定义。
 * 这里仅描述能力与前置条件，避免菜单 UI 和命令执行层各自维护一份规则。
 */
export const AI_WRITING_TOOLBAR_ACTIONS = [
    {
        action: 'continue',
        labelKey: 'aiWriting.continue',
        descriptionKey: 'aiWriting.continueDescription',
        icon: 'pen-nib',
        scene: 'completion',
    },
    {
        action: 'polish',
        labelKey: 'aiWriting.polish',
        descriptionKey: 'aiWriting.polishDescription',
        icon: 'magic-wand',
        scene: 'completion',
        requiresSelection: true,
    },
    {
        action: 'shorten',
        labelKey: 'aiWriting.shorten',
        descriptionKey: 'aiWriting.shortenDescription',
        icon: 'compress-alt',
        scene: 'completion',
        requiresSelection: true,
    },
    {
        action: 'expand',
        labelKey: 'aiWriting.expand',
        descriptionKey: 'aiWriting.expandDescription',
        icon: 'expand-arrows',
        scene: 'completion',
        requiresSelection: true,
    },
    {
        action: 'inspiration',
        labelKey: 'aiWriting.inspiration',
        descriptionKey: 'aiWriting.inspirationDescription',
        icon: 'lightbulb-on',
        scene: 'completion',
    },
    {
        action: 'beautifyDocument',
        labelKey: 'aiWriting.beautifyDocument',
        descriptionKey: 'aiWriting.beautifyDocumentDescription',
        icon: 'align-justify',
        scene: 'beautify',
        separatorBefore: true,
    },
];

/**
 * 根据模型配置与当前选区计算菜单项状态。
 * @param {{editorAvailable?:boolean,completionConfigured?:boolean,beautifyConfigured?:boolean,selectionRange?:object|null}} state - AI 与选区状态。
 * @returns {Array<object>} 带 enabled/reasonKey 的菜单项。
 */
export function resolveAiWritingToolbarActions(state = {}) {
    const hasSelection = Number.isFinite(state.selectionRange?.from)
        && Number.isFinite(state.selectionRange?.to)
        && state.selectionRange.to > state.selectionRange.from;

    return AI_WRITING_TOOLBAR_ACTIONS.map((definition) => {
        const sceneConfigured = definition.scene === 'beautify'
            ? Boolean(state.beautifyConfigured)
            : Boolean(state.completionConfigured);
        const selectionReady = !definition.requiresSelection || hasSelection;
        const editorAvailable = state.editorAvailable !== false;
        return {
            ...definition,
            enabled: editorAvailable && sceneConfigured && selectionReady,
            reasonKey: !editorAvailable
                ? 'aiWriting.richViewOnly'
                : (!sceneConfigured
                ? 'aiWriting.modelNotConfigured'
                : (!selectionReady ? 'aiWriting.selectTextHint' : '')),
        };
    });
}
