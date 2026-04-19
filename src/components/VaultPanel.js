import { addClickHandler } from '../utils/PointerHelper.js';
import { t } from '../i18n/index.js';
import { Dropdown } from './Dropdown.js';
import {
    vaultList,
    vaultGetValue,
    vaultAdd,
    vaultUpdate,
    vaultDelete,
    vaultCopyToClipboard,
    vaultGeneratePassword,
} from '../api/vault.js';

// 规范标签（存储与 Rust 端交互使用英文），UI 显示时再翻译
const LABEL_KEY = 'Key';
const LABEL_USERNAME = 'Username';
const LABEL_PASSWORD = 'Password';
const LABEL_URL = 'URL';

const KINDS = ['api-key', 'account'];

const LABEL_I18N = {
    [LABEL_KEY]: 'vault.field.key',
    [LABEL_USERNAME]: 'vault.field.account',
    [LABEL_PASSWORD]: 'vault.field.password',
    [LABEL_URL]: 'vault.field.url',
};

// 图标（全部走 currentColor，跟随按钮文字色；与 CardExportFlow 等处风格一致）
const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5l3 3-8 8H2.5v-3l8-8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg>';
const ICON_EYE_OFF = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.4"/><path d="M3 3l10 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

function displayLabel(rawLabel) {
    const key = LABEL_I18N[rawLabel];
    return key ? t(key) : rawLabel;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

function matchSearch(entry, q) {
    if (!q) return true;
    const needle = q.toLowerCase();
    if (entry.name.toLowerCase().includes(needle)) return true;
    if ((entry.fields || []).some((f) => !f.secret && f.value && f.value.toLowerCase().includes(needle))) return true;
    return false;
}

// 把后端 fields 还原为前端编辑用的扁平结构
function entryToForm(entry, plaintextByLabel = {}) {
    const form = { id: entry.id, kind: entry.kind, name: entry.name, key: '', username: '', password: '', url: '' };
    for (const f of entry.fields || []) {
        const val = plaintextByLabel[f.label] ?? (f.secret ? '' : f.value);
        if (f.label === LABEL_KEY) form.key = val;
        else if (f.label === LABEL_USERNAME) form.username = val;
        else if (f.label === LABEL_PASSWORD) form.password = val;
        else if (f.label === LABEL_URL) form.url = val;
    }
    return form;
}

// 把扁平表单转回 VaultEntryInput
function formToInput(form) {
    const fields = [];
    if (form.kind === 'api-key') {
        fields.push({ label: LABEL_KEY, value: form.key, secret: true });
    } else if (form.kind === 'account') {
        fields.push({ label: LABEL_USERNAME, value: form.username, secret: false });
        fields.push({ label: LABEL_PASSWORD, value: form.password, secret: true });
        fields.push({ label: LABEL_URL, value: form.url, secret: false });
    }
    return { name: form.name.trim(), kind: form.kind, fields, tags: [], notes: '' };
}

export class VaultPanel {
    constructor() {
        this.isOpen = false;
        this.entries = [];
        this.search = '';
        this.mode = 'list'; // 'list' | 'edit'
        this.editing = null;
        this._editReveal = new Set();
        this._dynamicCleanups = [];
        this._kindDropdown = null;
        this.cleanupFns = [];
        this.toastTimer = null;

        this.root = document.createElement('div');
        this.root.className = 'vault-modal hidden';
        this.root.innerHTML = `
            <div class="vault-backdrop" data-ref="backdrop"></div>
            <div class="vault-panel" role="dialog" aria-modal="true" aria-labelledby="vaultTitle">
                <div class="vault-body" data-ref="body"></div>
                <div class="vault-toast hidden" data-ref="toast"></div>
            </div>
        `;
        this.backdropEl = this.root.querySelector('[data-ref="backdrop"]');
        this.bodyEl = this.root.querySelector('[data-ref="body"]');
        this.toastEl = this.root.querySelector('[data-ref="toast"]');

        this._onKeydown = this._onKeydown.bind(this);
        this.cleanupFns.push(addClickHandler(this.backdropEl, () => this.close()));

        document.body.appendChild(this.root);
    }

    async open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.mode = 'list';
        this.search = '';
        document.addEventListener('keydown', this._onKeydown);
        this.root.classList.remove('hidden');
        await this._reload();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        // 退出时主动清空编辑态中的明文，避免驻留内存
        this.editing = null;
        this._editReveal = new Set();
        document.removeEventListener('keydown', this._onKeydown);
        this.root.classList.add('hidden');
        this._clearToast();
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    destroy() {
        this.close();
        this.cleanupFns.forEach((fn) => fn?.());
        this.cleanupFns = [];
        this._disposeDynamic();
        this.root.remove();
    }

    _onKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.mode === 'edit') this._cancelEdit();
            else this.close();
        }
    }

    async _reload() {
        try {
            this.entries = await vaultList();
        } catch (err) {
            console.warn('[Vault] list failed', err);
            this.entries = [];
        }
        this._render();
    }

    _render() {
        if (this.mode === 'list') this._renderList();
        else this._renderEditor();
    }

    _disposeDynamic() {
        this._dynamicCleanups.forEach((fn) => fn?.());
        this._dynamicCleanups = [];
        if (this._kindDropdown) {
            this._kindDropdown.destroy();
            this._kindDropdown = null;
        }
    }

    _bind(fn) { this._dynamicCleanups.push(fn); }

    // ── 列表 ──
    _renderList() {
        this._disposeDynamic();
        const filtered = this.entries
            .filter((e) => matchSearch(e, this.search))
            .sort((a, b) => (b.lastUsedAt || b.updatedAt) - (a.lastUsedAt || a.updatedAt));

        this.bodyEl.innerHTML = `
            <header class="vault-head">
                <h2 id="vaultTitle" class="vault-title">${t('vault.title')}</h2>
                <button type="button" class="vault-btn vault-btn--primary" data-ref="newBtn">+ ${t('vault.new')}</button>
            </header>
            <div class="vault-search-row">
                <input type="text" class="vault-search" data-ref="search" placeholder="${t('vault.searchPlaceholder')}" value="${escapeHtml(this.search)}" />
            </div>
            <div class="vault-list">
                ${filtered.length === 0
                    ? `<div class="vault-empty">${escapeHtml(t('vault.empty'))}</div>`
                    : filtered.map((e) => this._entryCardHtml(e)).join('')}
            </div>
        `;

        const searchEl = this.bodyEl.querySelector('[data-ref="search"]');
        if (searchEl) {
            const onInput = (e) => { this.search = e.target.value; this._renderList(); };
            searchEl.addEventListener('input', onInput);
            this._bind(() => searchEl.removeEventListener('input', onInput));
            searchEl.focus();
        }

        const newBtn = this.bodyEl.querySelector('[data-ref="newBtn"]');
        if (newBtn) this._bind(addClickHandler(newBtn, () => this._startCreate()));

        this.bodyEl.querySelectorAll('[data-role="entry"]').forEach((card) => {
            const id = card.dataset.id;
            const entry = this.entries.find((e) => e.id === id);
            if (!entry) return;

            card.querySelectorAll('[data-action="copy"]').forEach((row) => {
                this._bind(addClickHandler(row, (ev) => {
                    ev.stopPropagation();
                    this._copyField(entry.id, row.dataset.label);
                }));
            });
            card.querySelectorAll('[data-action="edit"]').forEach((btn) => {
                this._bind(addClickHandler(btn, (ev) => {
                    ev.stopPropagation();
                    this._startEdit(entry);
                }));
            });
        });
    }

    _entryCardHtml(entry) {
        const kindKey = entry.kind === 'api-key' ? 'apiKey' : entry.kind;
        const kindLabel = t(`vault.kind.${kindKey}`);
        // 列表视图：空字段不显示，避免无用行占位
        const visibleFields = (entry.fields || []).filter((f) => (f.secret ? f.hasValue : !!f.value));
        const fieldsHtml = visibleFields.map((f) => this._fieldRowHtml(entry.id, f)).join('');
        return `
            <div class="vault-entry" data-role="entry" data-id="${escapeHtml(entry.id)}">
                <div class="vault-entry__head">
                    <div class="vault-entry__name">${escapeHtml(entry.name)}</div>
                    <span class="vault-entry__kind">${escapeHtml(kindLabel)}</span>
                    <div class="vault-entry__actions">
                        <button type="button" class="vault-btn vault-btn--icon" data-action="edit" title="${t('vault.edit')}">${ICON_EDIT}</button>
                    </div>
                </div>
                <div class="vault-entry__fields">${fieldsHtml}</div>
            </div>
        `;
    }

    _fieldRowHtml(entryId, field) {
        const hasValue = field.secret ? field.hasValue : !!field.value;
        let display;
        if (!hasValue) {
            display = '<span class="vault-field__empty">—</span>';
        } else if (field.secret) {
            display = '<span class="vault-field__value vault-field__value--masked">••••••••</span>';
        } else {
            display = `<span class="vault-field__value">${escapeHtml(field.value)}</span>`;
        }
        const clickAttrs = hasValue
            ? ` data-action="copy" data-label="${escapeHtml(field.label)}" title="${t('vault.clickToCopy')}" role="button" tabindex="0"`
            : '';
        const cls = `vault-field${hasValue ? ' is-clickable' : ''}`;
        return `
            <div class="${cls}"${clickAttrs}>
                <span class="vault-field__label">${escapeHtml(displayLabel(field.label))}</span>
                <span class="vault-field__cell">${display}</span>
            </div>
        `;
    }

    async _copyField(entryId, label) {
        try {
            await vaultCopyToClipboard(entryId, label);
            this._showToast(t('vault.copied'));
            // 不在当前会话内重排：lastUsedAt 已被后端更新，下次 open() 时会读取新顺序
        } catch (err) {
            console.warn('[Vault] copy failed', err);
        }
    }

    async _deleteEntry(entry) {
        const { confirm } = await import('@tauri-apps/plugin-dialog');
        const ok = await confirm(t('vault.confirmDelete', { name: entry.name }), {
            title: t('vault.confirmDeleteTitle'),
            kind: 'warning',
            okLabel: t('vault.delete'),
            cancelLabel: t('vault.cancel'),
        });
        if (!ok) return;
        try {
            await vaultDelete(entry.id);
            // 若正在编辑该条目，退出编辑态返回列表
            if (this.mode === 'edit' && this.editing?.id === entry.id) {
                this.editing = null;
                this._editReveal = new Set();
                this.mode = 'list';
            }
            await this._reload();
        } catch (err) {
            console.warn('[Vault] delete failed', err);
        }
    }

    // ── 编辑 ──
    _startCreate() {
        this.editing = { id: null, kind: 'api-key', name: '', key: '', username: '', password: '', url: '' };
        this._editReveal = new Set();
        this.mode = 'edit';
        this._render();
    }

    async _startEdit(entry) {
        // 拉取所有 secret 字段明文
        const plaintextByLabel = {};
        await Promise.all((entry.fields || [])
            .filter((f) => f.secret && f.hasValue)
            .map(async (f) => {
                try {
                    plaintextByLabel[f.label] = await vaultGetValue(entry.id, f.label);
                } catch {}
            })
        );
        this.editing = entryToForm(entry, plaintextByLabel);
        this._editReveal = new Set();
        this.mode = 'edit';
        this._render();
    }

    _cancelEdit() {
        this.editing = null;
        this._editReveal = new Set();
        this.mode = 'list';
        this._render();
    }

    _renderEditor() {
        this._disposeDynamic();
        const e = this.editing;
        const kindOptions = KINDS.map((k) => {
            const key = k === 'api-key' ? 'apiKey' : k;
            return `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${escapeHtml(t(`vault.kind.${key}`))}</option>`;
        }).join('');

        const fieldsHtml = e.kind === 'api-key'
            ? this._editRow(LABEL_KEY, 'key', e.key, { secret: true, generator: false })
            : [
                this._editRow(LABEL_USERNAME, 'username', e.username, { secret: false, generator: false }),
                this._editRow(LABEL_PASSWORD, 'password', e.password, { secret: true, generator: true }),
                this._editRow(LABEL_URL, 'url', e.url, { secret: false, generator: false }),
            ].join('');

        const deleteSection = e.id
            ? `<div class="vault-edit-footer">
                   <button type="button" class="vault-btn vault-btn--danger-ghost" data-ref="deleteBtn">${t('vault.delete')}</button>
               </div>`
            : '';

        this.bodyEl.innerHTML = `
            <header class="vault-head">
                <h2 class="vault-title">${e.id ? t('vault.edit') : t('vault.new')}</h2>
                <div class="vault-head__actions">
                    <button type="button" class="vault-btn" data-ref="cancelBtn">${t('vault.cancel')}</button>
                    <button type="button" class="vault-btn vault-btn--primary" data-ref="saveBtn">${t('vault.save')}</button>
                </div>
            </header>
            <div class="vault-edit">
                <label class="vault-edit-row">
                    <span class="vault-edit-row__label">${t('vault.name')}</span>
                    <input type="text" class="vault-input" data-ref="name" value="${escapeHtml(e.name)}" autofocus />
                </label>
                <label class="vault-edit-row">
                    <span class="vault-edit-row__label">${t('vault.kind')}</span>
                    <select class="vault-input" data-ref="kind">${kindOptions}</select>
                </label>
                ${fieldsHtml}
                ${deleteSection}
            </div>
        `;

        this._bindEditorEvents();
    }

    _editRow(canonicalLabel, formKey, value, { secret, generator }) {
        const revealed = this._editReveal.has(formKey);
        const eyeBtn = secret
            ? `<button type="button" class="vault-btn vault-btn--icon" data-action="toggle-reveal" data-form-key="${formKey}" title="${revealed ? t('vault.hide') : t('vault.reveal')}">${revealed ? ICON_EYE_OFF : ICON_EYE}</button>`
            : '';
        const genBtn = generator
            ? `<button type="button" class="vault-btn vault-btn--ghost" data-action="gen" data-form-key="${formKey}">${t('vault.generate')}</button>`
            : '';
        const inputType = secret && !revealed ? 'password' : 'text';
        return `
            <div class="vault-edit-row">
                <span class="vault-edit-row__label">${escapeHtml(displayLabel(canonicalLabel))}</span>
                <div class="vault-edit-inline">
                    <input type="${inputType}" class="vault-input vault-edit-inline__input" data-form-key="${formKey}" value="${escapeHtml(value)}" />
                    ${eyeBtn}${genBtn}
                </div>
            </div>
        `;
    }

    _bindEditorEvents() {
        const body = this.bodyEl;
        const nameEl = body.querySelector('[data-ref="name"]');
        const kindEl = body.querySelector('[data-ref="kind"]');
        const cancelBtn = body.querySelector('[data-ref="cancelBtn"]');
        const saveBtn = body.querySelector('[data-ref="saveBtn"]');

        const onNameInput = () => { this.editing.name = nameEl.value; };
        nameEl.addEventListener('input', onNameInput);
        this._bind(() => nameEl.removeEventListener('input', onNameInput));

        // 接管原生 <select>，和设置面板保持一致（规避 WebView2 原生下拉问题）
        this._kindDropdown = new Dropdown(kindEl);

        const onKindChange = () => {
            this.editing.kind = kindEl.value;
            this._renderEditor();
        };
        kindEl.addEventListener('change', onKindChange);
        this._bind(() => kindEl.removeEventListener('change', onKindChange));

        if (cancelBtn) this._bind(addClickHandler(cancelBtn, () => this._cancelEdit()));
        if (saveBtn) this._bind(addClickHandler(saveBtn, () => this._saveEdit()));

        const deleteBtn = body.querySelector('[data-ref="deleteBtn"]');
        if (deleteBtn) {
            this._bind(addClickHandler(deleteBtn, () => {
                if (!this.editing?.id) return;
                this._deleteEntry({ id: this.editing.id, name: this.editing.name });
            }));
        }

        body.querySelectorAll('[data-form-key]').forEach((el) => {
            if (el.tagName !== 'INPUT') return;
            const fk = el.dataset.formKey;
            const onInput = () => { this.editing[fk] = el.value; };
            el.addEventListener('input', onInput);
            this._bind(() => el.removeEventListener('input', onInput));
        });

        body.querySelectorAll('[data-action="toggle-reveal"]').forEach((btn) => {
            this._bind(addClickHandler(btn, () => {
                const fk = btn.dataset.formKey;
                const revealed = !this._editReveal.has(fk);
                if (revealed) this._editReveal.add(fk);
                else this._editReveal.delete(fk);
                this._applyRevealState(fk);
            }));
        });

        body.querySelectorAll('[data-action="gen"]').forEach((btn) => {
            this._bind(addClickHandler(btn, async () => {
                try {
                    const pw = await vaultGeneratePassword({
                        length: 20, lowercase: true, uppercase: true, digits: true, symbols: true,
                    });
                    const fk = btn.dataset.formKey;
                    this.editing[fk] = pw;
                    this._editReveal.add(fk);  // 生成后自动显示明文
                    const input = this.bodyEl.querySelector(`input[data-form-key="${fk}"]`);
                    if (input) input.value = pw;
                    this._applyRevealState(fk);
                } catch (err) {
                    console.warn('[Vault] generate failed', err);
                }
            }));
        });
    }

    _applyRevealState(formKey) {
        const revealed = this._editReveal.has(formKey);
        const input = this.bodyEl.querySelector(`input[data-form-key="${formKey}"]`);
        if (input) input.type = revealed ? 'text' : 'password';
        const eye = this.bodyEl.querySelector(`[data-action="toggle-reveal"][data-form-key="${formKey}"]`);
        if (eye) {
            eye.innerHTML = revealed ? ICON_EYE_OFF : ICON_EYE;
            eye.title = revealed ? t('vault.hide') : t('vault.reveal');
        }
    }

    async _saveEdit() {
        const e = this.editing;
        if (!e) return;
        if (!e.name.trim()) {
            this._showToast(t('vault.nameRequired'));
            return;
        }
        const input = formToInput(e);
        try {
            if (e.id) await vaultUpdate(e.id, input);
            else await vaultAdd(input);
            this.editing = null;
            this.mode = 'list';
            await this._reload();
        } catch (err) {
            console.warn('[Vault] save failed', err);
            this._showToast(String(err));
        }
    }

    // ── Toast ──
    _showToast(msg) {
        if (!this.toastEl) return;
        this.toastEl.textContent = msg;
        this.toastEl.classList.remove('hidden');
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this._clearToast(), 2000);
    }

    _clearToast() {
        if (this.toastTimer) {
            clearTimeout(this.toastTimer);
            this.toastTimer = null;
        }
        if (this.toastEl) this.toastEl.classList.add('hidden');
    }
}
