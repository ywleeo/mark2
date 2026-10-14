/** Editorial 的文档列表视图，只呈现文档操作，导航与存储由控制器注入。 */
import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';

/** 文档目录的 DOM 与交互，列表刷新不重建搜索框或改变输入焦点。 */
export class DocumentLibraryView {
    /** @param {HTMLElement} host - 侧栏宿主。 @param {object} actions - 新建、打开、搜索、移除和关闭回调。 */
    constructor(host, actions) {
        this.host = host;
        this.actions = actions;
        this.activePath = null;
        host.innerHTML = `
            <section class="document-library">
                <div class="skin-masthead">
                    <span class="skin-masthead__name" role="img" aria-label="Mark2"><span class="skin-masthead__word" aria-hidden="true">Mark</span><span class="skin-masthead__edition" aria-hidden="true">2</span></span>
                    <button type="button" class="skin-masthead__action" data-action="full-search" aria-label="${t('workspaceSearch.title')}" title="${t('workspaceSearch.title')}">⌕</button>
                </div>
                <header class="document-library__header">
                    <h2>${t('documentLibrary.title')}</h2>
                    <div class="document-library__actions">
                        <button type="button" data-action="new" title="${t('documentLibrary.new')}" aria-label="${t('documentLibrary.new')}">＋</button>
                        <button type="button" data-action="open">${t('documentLibrary.open')}</button>
                    </div>
                </header>
                <input class="document-library__search" type="search" spellcheck="false" placeholder="${t('documentLibrary.search')}" aria-label="${t('documentLibrary.search')}">
                <div class="document-library__status" role="status" aria-live="polite" hidden></div>
                <nav class="document-library__list" aria-label="${t('documentLibrary.title')}"></nav>
            </section>`;
        this.list = host.querySelector('.document-library__list');
        this.input = host.querySelector('input');
        this.status = host.querySelector('[role="status"]');
        this.onInput = () => actions.filter(this.input.value);
        this.input.addEventListener('input', this.onInput);
        this.clickCleanup = addClickHandler(host, event => {
            const button = event.target.closest('button[data-action]');
            if (!button || button.disabled) return;
            const action = button.dataset.action;
            const entry = button.closest('[data-path]');
            if (action === 'new') void actions.new();
            if (action === 'open') void actions.open();
            if (action === 'full-search') void actions.fullSearch();
            if (action === 'select') void actions.select(entry.dataset.path);
            if (action === 'remove') void actions.remove(entry.dataset.path);
            if (action === 'close') void actions.close(entry.dataset.path);
        }, { shouldHandle: event => Boolean(event.target.closest('button[data-action]')), preventDefault: true });
    }

    /** 使用 textContent 渲染正文标题，避免文档内容被当作 HTML。 */
    render(entries, query = '') {
        const fragment = document.createDocumentFragment();
        for (const entry of entries) {
            const row = document.createElement('div');
            row.className = 'document-library__row';
            row.classList.toggle('is-active', entry.active);
            row.dataset.path = entry.path;
            const select = document.createElement('button');
            select.type = 'button';
            select.className = 'document-library__entry';
            select.dataset.action = 'select';
            select.title = entry.label;
            if (entry.active) select.setAttribute('aria-current', 'page');
            const name = document.createElement('span');
            name.className = 'document-library__name';
            name.textContent = entry.label;
            select.append(name);
            if (entry.dirty) {
                const dirty = document.createElement('span');
                dirty.className = 'document-library__dirty';
                dirty.textContent = '●';
                dirty.title = t('documentLibrary.unsaved');
                dirty.setAttribute('aria-label', dirty.title);
                select.append(dirty);
            }
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'document-library__remove';
            remove.dataset.action = entry.temporary ? 'close' : 'remove';
            remove.textContent = entry.temporary ? '×' : '−';
            remove.title = entry.temporary ? t('documentLibrary.close') : t('documentLibrary.remove');
            remove.setAttribute('aria-label', remove.title);
            row.append(select, remove);
            fragment.append(row);
        }
        if (!entries.length) {
            const empty = document.createElement('p');
            empty.className = 'document-library__empty';
            empty.textContent = t(query ? 'documentLibrary.noResults' : 'documentLibrary.empty');
            fragment.append(empty);
        }
        this.list.replaceChildren(fragment);
        // 仅在切换或保存导致活动条目换位时跟随该条目；标题后台更新不抢阅读位置。
        const activePath = entries.find(entry => entry.active)?.path || null;
        const activeIndex = entries.findIndex(entry => entry.active);
        if (activePath && (activePath !== this.activePath || activeIndex !== this.activeIndex)) {
            Array.from(this.list.children).find(row => row.dataset.path === activePath)
                ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        this.activePath = activePath;
        this.activeIndex = activeIndex;
    }

    /** 显示打开失败或存储失败等当前操作反馈。 */
    setStatus(message = '') { this.status.textContent = message; this.status.hidden = !message; }

    /** 文件名重命名使用独立对话框，正文标题仍取自文章，不改变当前活动文档。 */
    requestName(filename) {
        this.cancelRename?.();
        return new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.className = 'document-library__rename-dialog';
            const form = document.createElement('form');
            const label = document.createElement('label');
            label.textContent = t('documentLibrary.renameFile');
            const input = document.createElement('input');
            input.type = 'text';
            input.value = filename;
            input.required = true;
            label.append(input);
            const buttons = document.createElement('div');
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.textContent = t('common.cancel');
            const confirm = document.createElement('button');
            confirm.type = 'submit';
            confirm.textContent = t('toolbar.dialogOk');
            buttons.append(cancel, confirm);
            form.append(label, buttons);
            dialog.append(form);
            document.body.append(dialog);
            const previousFocus = document.activeElement;
            /** 所有退出路径都卸载监听，并兑现正在等待的重命名动作。 */
            const done = value => {
                cleanupClick?.();
                cleanupConfirm?.();
                dialog.removeEventListener('cancel', onCancel);
                form.removeEventListener('submit', onSubmit);
                input.removeEventListener('input', onInput);
                dialog.close();
                dialog.remove();
                this.cancelRename = null;
                if (previousFocus?.isConnected) previousFocus.focus();
                resolve(value);
            };
            /** 空名称、路径分隔符及特殊目录名不会提交到文件服务。 */
            const onSubmit = event => {
                event.preventDefault();
                const name = input.value.trim();
                if (!name || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name)) {
                    input.setCustomValidity(t('documentLibrary.invalidFilename'));
                    input.reportValidity();
                    return;
                }
                done(name);
            };
            const onCancel = event => { event.preventDefault(); done(null); };
            const onInput = () => input.setCustomValidity('');
            const cleanupClick = addClickHandler(cancel, () => done(null));
            const cleanupConfirm = addClickHandler(confirm, onSubmit, { preventDefault: true });
            form.addEventListener('submit', onSubmit);
            dialog.addEventListener('cancel', onCancel);
            input.addEventListener('input', onInput);
            this.cancelRename = () => done(null);
            dialog.showModal();
            input.focus();
            const extension = filename.lastIndexOf('.');
            input.setSelectionRange(0, extension > 0 ? extension : filename.length);
        });
    }

    /** 卸载全部监听与视图。 */
    destroy() {
        this.cancelRename?.();
        this.clickCleanup?.();
        this.input.removeEventListener('input', this.onInput);
        this.host.replaceChildren();
    }
}
