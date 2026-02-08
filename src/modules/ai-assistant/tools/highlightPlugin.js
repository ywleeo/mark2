/**
 * AI 编辑高亮插件
 * 用 ProseMirror Decoration 标记 AI 修改的区域，2s 后渐隐消失
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';

const HIGHLIGHT_DURATION = 2000;
const FADE_DURATION = 500;

const aiHighlightKey = new PluginKey('aiEditHighlight');

/**
 * 创建 TipTap Extension，内部维护高亮 decoration
 */
export const AiEditHighlight = Extension.create({
    name: 'aiEditHighlight',

    addProseMirrorPlugins() {
        const editorView = () => this.editor.view;

        return [
            new Plugin({
                key: aiHighlightKey,
                state: {
                    init() {
                        return { decorations: DecorationSet.empty, timers: [] };
                    },
                    apply(tr, prev, oldState, newState) {
                        const meta = tr.getMeta(aiHighlightKey);
                        if (meta?.type === 'add') {
                            // 添加新的高亮 decoration（id 放在 spec 第4参数）
                            const deco = Decoration.inline(
                                meta.from, meta.to,
                                { class: 'ai-edit-highlight' },
                                { highlightId: meta.id }
                            );
                            const decorations = prev.decorations.map(tr.mapping, tr.doc).add(tr.doc, [deco]);
                            return { decorations, timers: prev.timers };
                        }
                        if (meta?.type === 'fade') {
                            // 给指定高亮加上 fade class
                            const next = [];
                            prev.decorations.find(0, newState.doc.content.size).forEach(deco => {
                                if (deco.spec?.highlightId === meta.id) {
                                    next.push(Decoration.inline(
                                        deco.from, deco.to,
                                        { class: 'ai-edit-highlight ai-edit-highlight-fade' },
                                        { highlightId: meta.id }
                                    ));
                                } else {
                                    next.push(deco);
                                }
                            });
                            return { decorations: DecorationSet.create(newState.doc, next), timers: prev.timers };
                        }
                        if (meta?.type === 'remove') {
                            // 移除指定高亮
                            const next = [];
                            prev.decorations.find(0, newState.doc.content.size).forEach(deco => {
                                if (deco.spec?.highlightId !== meta.id) {
                                    next.push(deco);
                                }
                            });
                            return { decorations: DecorationSet.create(newState.doc, next), timers: prev.timers };
                        }
                        // 普通 transaction，映射已有 decorations
                        const decorations = prev.decorations.map(tr.mapping, tr.doc);
                        return { ...prev, decorations };
                    },
                },
                props: {
                    decorations(state) {
                        return this.getState(state)?.decorations || DecorationSet.empty;
                    },
                },
            }),
        ];
    },
});

let highlightIdCounter = 0;

/**
 * 在编辑器中高亮指定范围，自动 2s 后渐隐消失
 * @param {import('@tiptap/core').Editor} editor - TipTap 编辑器实例
 * @param {number} from - 起始位置
 * @param {number} to - 结束位置
 */
export function addEditHighlight(editor, from, to) {
    if (!editor?.view || from >= to) return;

    const id = `hl-${++highlightIdCounter}`;

    // 添加高亮
    editor.view.dispatch(
        editor.state.tr.setMeta(aiHighlightKey, { type: 'add', from, to, id })
    );

    // 2s 后开始 fade
    setTimeout(() => {
        if (!editor?.view) return;
        editor.view.dispatch(
            editor.state.tr.setMeta(aiHighlightKey, { type: 'fade', id })
        );
        // fade 动画结束后移除
        setTimeout(() => {
            if (!editor?.view) return;
            editor.view.dispatch(
                editor.state.tr.setMeta(aiHighlightKey, { type: 'remove', id })
            );
        }, FADE_DURATION);
    }, HIGHLIGHT_DURATION);
}
