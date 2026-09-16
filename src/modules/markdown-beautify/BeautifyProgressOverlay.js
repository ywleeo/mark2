import { t } from '../../i18n/index.js';
import { addClickHandler } from '../../utils/PointerHelper.js';

/**
 * 锁定 Markdown 编辑区并显示可取消的排版进度层。
 * @param {object|null} markdownEditor - MarkdownEditor 实例。
 * @param {Function|null} onCancel - 用户取消回调。
 * @returns {Function} 幂等的解锁函数。
 */
export function showBeautifyProgressOverlay(markdownEditor, onCancel = null) {
    const viewElement = markdownEditor?.viewElement;
    let mask = null;
    let clickCleanup = null;
    let unlocked = false;

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
            </div>
        `;
        document.body.appendChild(mask);
        clickCleanup = addClickHandler(mask.querySelector('.beautify-mask__cancel'), () => onCancel?.(), {
            preventDefault: true,
        });
        requestAnimationFrame(() => mask?.classList.add('is-visible'));
    }

    // 阻止进度期间切换标签或修改外围状态；mask 的 z-index 更高，因此取消按钮仍可用。
    const blocker = document.createElement('div');
    blocker.className = 'beautify-global-blocker';
    blocker.style.cssText = 'position:fixed;inset:0;z-index:99;cursor:wait;';
    document.body.appendChild(blocker);
    markdownEditor?.editor?.setEditable(false);

    return () => {
        if (unlocked) return;
        unlocked = true;
        clickCleanup?.();
        markdownEditor?.editor?.setEditable(true);
        blocker.remove();
        if (mask) {
            mask.classList.remove('is-visible');
            setTimeout(() => mask?.remove(), 200);
        }
    };
}
