import { CardExportFlow } from './CardExportFlow.js';
import { EditorContextMenu } from './EditorContextMenu.js';
import { beautifyMarkdown } from '../markdown-beautify/markdownBeautifier.js';
import { t } from '../../i18n/index.js';

function lockWithMask(markdownEditor, onCancel) {
    const viewElement = markdownEditor?.viewElement;
    let mask = null;
    if (viewElement) {
        const rect = viewElement.getBoundingClientRect();
        mask = document.createElement('div');
        mask.className = 'beautify-mask';
        mask.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
        mask.innerHTML = `
            <div class="beautify-mask__inner">
                <div class="beautify-mask__spinner"></div>
                <span>${t('beautify.loading')}</span>
                <button type="button" class="beautify-mask__cancel">${t('common.cancel')}</button>
            </div>`;
        document.body.appendChild(mask);
        requestAnimationFrame(() => mask.classList.add('is-visible'));
        mask.querySelector('.beautify-mask__cancel').addEventListener('click', () => onCancel?.());
    }

    // 透明全屏层阻止点击编辑器外的区域（tab 栏等），mask 在其上方可正常交互
    const blocker = document.createElement('div');
    blocker.style.cssText = 'position:fixed;inset:0;z-index:99;cursor:wait;';
    document.body.appendChild(blocker);

    markdownEditor?.editor?.setEditable(false);

    return () => {
        markdownEditor?.editor?.setEditable(true);
        blocker.remove();
        if (mask) {
            mask.classList.remove('is-visible');
            setTimeout(() => mask.remove(), 200);
        }
    };
}

export function initCardExport({ getMarkdownEditor } = {}) {
    const flow = new CardExportFlow();
    flow.mount();

    const contextMenu = new EditorContextMenu({
        getEditor: () => getMarkdownEditor?.()?.editor ?? null,
        onGenerateCard: ({ text, html }) => flow.open({ text, html }),
        onBeautifyMarkdown: async ({ text, from, to }) => {
            const markdownEditor = getMarkdownEditor?.();
            let cancelled = false;
            let unlock = null;

            unlock = lockWithMask(markdownEditor, () => {
                cancelled = true;
                unlock?.();
            });

            try {
                const result = await beautifyMarkdown(text);
                if (!cancelled) {
                    markdownEditor?.replaceRangeWithMarkdown(from, to, result);
                }
            } catch (error) {
                if (!cancelled) {
                    alert(error?.message || t('beautify.error.generic'));
                }
            } finally {
                if (!cancelled) {
                    unlock();
                }
            }
        },
    });

    return {
        open: ({ text, html }) => flow.open({ text, html }),
        hide: () => flow.hide(),
        destroy: () => {
            flow.destroy();
            contextMenu.destroy();
        },
    };
}
