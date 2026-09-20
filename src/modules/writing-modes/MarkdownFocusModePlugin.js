/**
 * Markdown 专注模式 ProseMirror 插件。
 * 使用节点装饰标记当前顶层内容块，避免直接修改编辑器托管的 DOM 后被重绘覆盖。
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const markdownFocusModePluginKey = new PluginKey('markdownFocusMode');

/**
 * 根据当前选区创建顶层内容块装饰。
 * @param {object} state - ProseMirror 编辑器状态。
 * @returns {DecorationSet} 当前块节点装饰。
 */
function createActiveBlockDecoration(state) {
    const resolved = state.selection.$head || state.selection.$from;
    const from = resolved?.depth > 0 ? resolved.before(1) : state.selection.from;
    const node = state.doc.nodeAt(from);
    if (!node || node.isText || from + node.nodeSize > state.doc.content.size) {
        return DecorationSet.empty;
    }

    return DecorationSet.create(state.doc, [
        Decoration.node(from, from + node.nodeSize, {
            class: 'writing-focus-block',
        }),
    ]);
}

/**
 * 创建可由 transaction meta 开关的专注模式插件。
 * @returns {Plugin} ProseMirror 插件实例。
 */
export function createMarkdownFocusModePlugin() {
    return new Plugin({
        key: markdownFocusModePluginKey,
        state: {
            /** 初始化为关闭，真实状态由控制器在注册后同步。 */
            init() {
                return false;
            },
            /** 仅处理显式模式变更，其余事务保留开关状态。 */
            apply(transaction, enabled) {
                const meta = transaction.getMeta(markdownFocusModePluginKey);
                return typeof meta?.enabled === 'boolean' ? meta.enabled : enabled;
            },
        },
        props: {
            /** 每次选区变化都从最新 state 派生活动块，避免维护易失 DOM 引用。 */
            decorations(state) {
                if (markdownFocusModePluginKey.getState(state) !== true) {
                    return DecorationSet.empty;
                }
                return createActiveBlockDecoration(state);
            },
        },
    });
}
