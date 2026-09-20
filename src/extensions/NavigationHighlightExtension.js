import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** 工作区搜索等跨文档导航共用的临时高亮插件键。 */
export const navigationHighlightPluginKey = new PluginKey('navigationHighlight');

/**
 * 为外部导航目标提供一次性装饰，不复用文档内搜索状态。
 * 文档一旦编辑，高亮立即失效，避免旧位置被错误保留。
 */
export const NavigationHighlightExtension = Extension.create({
    name: 'navigationHighlight',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: navigationHighlightPluginKey,
                state: {
                    init() {
                        return null;
                    },
                    apply(transaction, value) {
                        const meta = transaction.getMeta(navigationHighlightPluginKey);
                        if (meta?.clear || transaction.docChanged) return null;
                        if (meta?.range) return meta.range;
                        return value;
                    },
                },
                props: {
                    decorations(state) {
                        const range = navigationHighlightPluginKey.getState(state);
                        if (!range || range.from < 0 || range.to > state.doc.content.size || range.from >= range.to) {
                            return DecorationSet.empty;
                        }
                        return DecorationSet.create(state.doc, [
                            Decoration.inline(range.from, range.to, {
                                class: 'workspace-search-document-match',
                            }),
                        ]);
                    },
                },
            }),
        ];
    },

    addCommands() {
        return {
            /** 设置新的导航高亮范围。 */
            setNavigationHighlight: ({ from, to }) => ({ state, dispatch }) => {
                const safeFrom = Math.max(0, Math.min(Number(from) || 0, state.doc.content.size));
                const safeTo = Math.max(safeFrom, Math.min(Number(to) || safeFrom, state.doc.content.size));
                if (safeFrom >= safeTo) return false;
                dispatch?.(state.tr.setMeta(navigationHighlightPluginKey, {
                    range: { from: safeFrom, to: safeTo },
                }));
                return true;
            },

            /** 主动清除导航高亮。 */
            clearNavigationHighlight: () => ({ state, dispatch }) => {
                dispatch?.(state.tr.setMeta(navigationHighlightPluginKey, { clear: true }));
                return true;
            },
        };
    },
});
