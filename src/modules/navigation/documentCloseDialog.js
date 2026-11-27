/** 主栏与副栏共用的原生关闭确认。选择不明确时保留文档。 */
import { message } from '@tauri-apps/plugin-dialog';
import { t } from '../../i18n/index.js';

/** 返回保存、放弃或取消，实际保存和关闭由调用方负责。 */
export async function askDocumentClose(name, { conflict = false, showMessage = message } = {}) {
    const save = t(conflict ? 'fileConflict.closeOverwrite' : 'tabClose.dirty.save');
    const discard = t('tabClose.dirty.discard');
    const choice = await showMessage(t(conflict ? 'fileConflict.closeMessage' : 'tabClose.dirty.message', { name }), {
        title: t(conflict ? 'fileConflict.title' : 'tabClose.dirty.title'),
        kind: 'warning',
        buttons: { yes: save, no: discard, cancel: t('common.cancel') },
    });
    if (choice === save) return 'save';
    if (choice === discard) return 'discard';
    return 'cancel';
}

/** 保存失败时，允许用户明确放弃并关闭，或留在编辑器重试。 */
export async function confirmDiscardAfterSaveFailure(name, confirm) {
    return confirm(t('tabClose.saveFailed.message', { name }), {
        title: t('tabClose.saveFailed.title'),
        kind: 'warning',
        okLabel: t('tabClose.dirty.discard'),
        cancelLabel: t('common.cancel'),
    });
}
