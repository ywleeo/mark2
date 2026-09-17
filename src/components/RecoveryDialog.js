import { addClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';
import { t } from '../i18n/index.js';

/** 将时间戳格式化为当前语言环境下的简短日期时间。 */
function formatCapturedAt(value) {
    const date = new Date(Number(value) || 0);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/** 创建恢复点列表中的单行 DOM。 */
function createEntryRow(entry, { selectable = false, selected = false } = {}) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'recovery-dialog__entry';
    row.dataset.snapshotId = entry.id;
    row.setAttribute('aria-pressed', selected ? 'true' : 'false');

    if (selectable) {
        const checkbox = document.createElement('span');
        checkbox.className = 'recovery-dialog__checkbox';
        checkbox.textContent = selected ? '✓' : '';
        checkbox.dataset.checked = selected ? 'true' : 'false';
        checkbox.setAttribute('aria-hidden', 'true');
        row.appendChild(checkbox);
    }

    const content = document.createElement('span');
    content.className = 'recovery-dialog__entry-content';
    const title = document.createElement('strong');
    title.textContent = basename(entry.filePath) || entry.filePath;
    const meta = document.createElement('span');
    meta.textContent = `${formatCapturedAt(entry.capturedAt)} · ${entry.byteLen ?? entry.content?.length ?? 0} B`;
    const path = document.createElement('span');
    path.className = 'recovery-dialog__entry-path';
    path.textContent = entry.filePath;
    content.append(title, meta, path);
    row.appendChild(content);
    return row;
}

/**
 * 恢复与版本历史对话框。
 * 所有正文都通过 textContent 展示，避免文档内容进入 HTML。
 */
export class RecoveryDialog {
    /** 创建公共对话框骨架。 */
    static createShell(titleText, descriptionText) {
        const overlay = document.createElement('div');
        overlay.className = 'recovery-dialog-overlay';
        const dialog = document.createElement('section');
        dialog.className = 'recovery-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        const header = document.createElement('header');
        header.className = 'recovery-dialog__header';
        const title = document.createElement('h2');
        title.id = `recovery-dialog-title-${Date.now()}`;
        title.textContent = titleText;
        dialog.setAttribute('aria-labelledby', title.id);
        const description = document.createElement('p');
        description.textContent = descriptionText;
        header.append(title, description);

        const body = document.createElement('div');
        body.className = 'recovery-dialog__body';
        const footer = document.createElement('footer');
        footer.className = 'recovery-dialog__footer';
        dialog.append(header, body, footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        return { overlay, dialog, body, footer };
    }

    /** 启动时让用户选择要恢复的未保存文稿。 */
    static showStartup(entries) {
        return new Promise((resolve) => {
            const shell = RecoveryDialog.createShell(
                t('recovery.startupTitle'),
                t('recovery.startupDescription'),
            );
            const selectedIds = new Set(entries.map(entry => entry.id));
            const list = document.createElement('div');
            list.className = 'recovery-dialog__list';
            for (const entry of entries) {
                const row = createEntryRow(entry, { selectable: true, selected: true });
                list.appendChild(row);
            }
            shell.body.appendChild(list);

            const later = document.createElement('button');
            later.type = 'button';
            later.className = 'recovery-dialog__button';
            later.textContent = t('recovery.later');
            const discard = document.createElement('button');
            discard.type = 'button';
            discard.className = 'recovery-dialog__button recovery-dialog__button--danger';
            discard.textContent = t('recovery.discardAll');
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'recovery-dialog__button recovery-dialog__button--primary';
            restore.textContent = t('recovery.restoreSelected');
            shell.footer.append(later, discard, restore);

            const cleanups = [];
            let settled = false;
            const finish = result => {
                if (settled) return;
                settled = true;
                while (cleanups.length > 0) cleanups.pop()?.();
                shell.overlay.remove();
                resolve(result);
            };
            cleanups.push(addClickHandler(list, (event) => {
                const row = event.target.closest('.recovery-dialog__entry');
                if (!row) return;
                const id = row.dataset.snapshotId;
                if (selectedIds.has(id)) selectedIds.delete(id);
                else selectedIds.add(id);
                const selected = selectedIds.has(id);
                row.setAttribute('aria-pressed', selected ? 'true' : 'false');
                const checkbox = row.querySelector('.recovery-dialog__checkbox');
                if (checkbox) {
                    checkbox.textContent = selected ? '✓' : '';
                    checkbox.dataset.checked = selected ? 'true' : 'false';
                }
                restore.disabled = selectedIds.size === 0;
            }, { shouldHandle: event => Boolean(event.target.closest('.recovery-dialog__entry')) }));
            cleanups.push(addClickHandler(later, () => finish({ action: 'later', selectedIds: [] })));
            cleanups.push(addClickHandler(discard, () => finish({ action: 'discard', selectedIds: entries.map(entry => entry.id) })));
            cleanups.push(addClickHandler(restore, () => finish({ action: 'restore', selectedIds: Array.from(selectedIds) })));
            const handleKeydown = event => {
                if (event.key === 'Escape') finish({ action: 'later', selectedIds: [] });
            };
            document.addEventListener('keydown', handleKeydown);
            cleanups.push(() => document.removeEventListener('keydown', handleKeydown));
            restore.focus();
        });
    }

    /** 显示当前文档最近版本，并返回用户选中的恢复点。 */
    static showHistory(entries) {
        return new Promise((resolve) => {
            const shell = RecoveryDialog.createShell(
                t('recovery.historyTitle'),
                t('recovery.historyDescription'),
            );
            let selected = entries[0] || null;
            const columns = document.createElement('div');
            columns.className = 'recovery-dialog__history';
            const list = document.createElement('div');
            list.className = 'recovery-dialog__list recovery-dialog__list--history';
            const preview = document.createElement('pre');
            preview.className = 'recovery-dialog__preview';
            preview.textContent = selected?.content || '';
            for (const [index, entry] of entries.entries()) {
                list.appendChild(createEntryRow(entry, { selected: index === 0 }));
            }
            columns.append(list, preview);
            shell.body.appendChild(columns);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'recovery-dialog__button';
            close.textContent = t('common.close');
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'recovery-dialog__button recovery-dialog__button--primary';
            restore.textContent = t('recovery.restoreVersion');
            shell.footer.append(close, restore);

            const cleanups = [];
            let settled = false;
            const finish = result => {
                if (settled) return;
                settled = true;
                while (cleanups.length > 0) cleanups.pop()?.();
                shell.overlay.remove();
                resolve(result);
            };
            cleanups.push(addClickHandler(list, (event) => {
                const row = event.target.closest('.recovery-dialog__entry');
                if (!row) return;
                selected = entries.find(entry => entry.id === row.dataset.snapshotId) || null;
                list.querySelectorAll('.recovery-dialog__entry').forEach(item => {
                    item.setAttribute('aria-pressed', item === row ? 'true' : 'false');
                });
                preview.textContent = selected?.content || '';
                restore.disabled = !selected;
            }, { shouldHandle: event => Boolean(event.target.closest('.recovery-dialog__entry')) }));
            cleanups.push(addClickHandler(close, () => finish(null)));
            cleanups.push(addClickHandler(restore, () => finish(selected)));
            const handleKeydown = event => {
                if (event.key === 'Escape') finish(null);
            };
            document.addEventListener('keydown', handleKeydown);
            cleanups.push(() => document.removeEventListener('keydown', handleKeydown));
            restore.focus();
        });
    }
}
