import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const selectionRewritePluginKey = new PluginKey('selectionRewrite');

/**
 * 创建选区改写状态提示，避免异步请求期间原文看起来毫无反应。
 * @param {{onCancel?:Function}} handlers - 交互回调
 * @returns {Plugin} ProseMirror 插件
 */
export function createSelectionRewritePlugin({ onCancel } = {}) {
    return new Plugin({
        key: selectionRewritePluginKey,
        state: {
            init: () => ({ status: 'idle', from: null, to: null, message: '' }),
            apply(tr, value) {
                const meta = tr.getMeta(selectionRewritePluginKey);
                if (meta?.type === 'clear') {
                    return { status: 'idle', from: null, to: null, message: '' };
                }
                if (['loading', 'success', 'error'].includes(meta?.type)) {
                    return {
                        status: meta.type,
                        from: meta.from,
                        to: meta.to,
                        message: meta.message || '',
                    };
                }
                if (value.status !== 'idle' && value.from != null && value.to != null) {
                    return {
                        ...value,
                        from: tr.mapping.map(value.from, 1),
                        to: tr.mapping.map(value.to, -1),
                    };
                }
                return value;
            },
        },
        props: {
            decorations(state) {
                const value = selectionRewritePluginKey.getState(state);
                if (!value || value.status === 'idle' || value.from == null || value.to == null) {
                    return DecorationSet.empty;
                }

                const from = Math.max(0, Math.min(value.from, state.doc.content.size));
                const to = Math.max(from, Math.min(value.to, state.doc.content.size));
                const decorations = [];
                if (from < to) {
                    decorations.push(Decoration.inline(from, to, {
                        class: `selection-rewrite-range selection-rewrite-range--${value.status}`,
                    }));
                }
                decorations.push(Decoration.widget(to, () => createSelectionRewriteStatus(value), {
                    side: 1,
                    ignoreSelection: true,
                }));
                return DecorationSet.create(state.doc, decorations);
            },
            handleKeyDown(view, event) {
                const value = selectionRewritePluginKey.getState(view.state);
                if (value?.status === 'loading' && event.key === 'Escape') {
                    event.preventDefault();
                    onCancel?.();
                    return true;
                }
                return false;
            },
        },
    });
}

/**
 * 创建紧邻改写选区的状态胶囊。
 * @param {{status:string,message:string}} value - 当前改写状态
 * @returns {HTMLElement} 状态节点
 */
function createSelectionRewriteStatus(value) {
    const status = document.createElement('span');
    status.className = `selection-rewrite-status selection-rewrite-status--${value.status}`;
    status.setAttribute('contenteditable', 'false');
    status.setAttribute('data-selection-rewrite-widget', 'true');
    status.setAttribute('role', 'status');

    const indicator = document.createElement('span');
    indicator.className = 'selection-rewrite-status__indicator';
    indicator.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = value.message;
    status.append(indicator, label);
    return status;
}
