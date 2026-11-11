/** 全局文件排除设置页；编辑只修改草稿，提交后由配置服务统一生效。 */
import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';
import { fileExclusionService } from '../../modules/file-exclusions/fileExclusionService.js';
import { defaultFileExclusionSettings } from '../../modules/file-exclusions/fileExclusionSettings.js';

/** 生成设置页的固定结构，用户输入始终通过 DOM 属性赋值。 */
export function renderSettingsFileExclusionsSection() {
    return `<section class="settings-body hidden" data-tab-content="files">
        <div class="file-exclusions" data-ref="fileExclusions">
            <p class="settings-section-desc">${t('fileExclusions.description')}</p>
            <label class="settings-row">
                <span class="settings-row__label">${t('fileExclusions.enabled')}</span>
                <input type="checkbox" data-ref="exclusionsEnabled" class="settings-row__control settings-row__control--toggle">
            </label>
            <label class="settings-row">
                <span class="settings-row__label">${t('fileExclusions.applyToSearch')}</span>
                <input type="checkbox" data-ref="exclusionsSearch" class="settings-row__control settings-row__control--toggle">
            </label>
            <p class="settings-section-desc settings-section-desc--compact">${t('fileExclusions.searchHint')}</p>
            <div class="file-exclusions__heading">
                <h3>${t('fileExclusions.rules')}</h3>
                <button type="button" class="file-exclusions__add" data-exclusion-action="add">${t('fileExclusions.add')}</button>
            </div>
            <p class="settings-section-desc">${t('fileExclusions.examples')}</p>
            <div class="file-exclusions__rules" data-ref="exclusionsRules"></div>
            <p class="file-exclusions__error" data-ref="exclusionsError" role="alert" hidden></p>
            <p class="settings-section-desc settings-section-desc--compact">${t('fileExclusions.syntaxHint')}</p>
            <button type="button" class="settings-link-button" data-exclusion-action="reset">${t('fileExclusions.reset')}</button>
        </div>
    </section>`;
}

/** 管理规则行、校验错误和异步提交期间的取消，生命周期由 SettingsDialog 管理。 */
export class SettingsFileExclusionsSection {
    /** 持有独立 UI 草稿，不订阅全局配置变化以免覆盖用户正在编辑的内容。 */
    constructor(root, service = fileExclusionService) {
        this.root = root;
        this.service = service;
        this.epoch = 0;
        this.rows = root.querySelector('[data-ref="exclusionsRules"]');
        this.enabled = root.querySelector('[data-ref="exclusionsEnabled"]');
        this.search = root.querySelector('[data-ref="exclusionsSearch"]');
        this.error = root.querySelector('[data-ref="exclusionsError"]');
        this.cleanup = addClickHandler(root, event => {
            const button = event.target.closest('[data-exclusion-action]');
            if (button.dataset.exclusionAction === 'add') this.addRule('', true, true);
            if (button.dataset.exclusionAction === 'reset') this.setSettings(defaultFileExclusionSettings());
            if (button.dataset.exclusionAction === 'remove') {
                button.closest('.file-exclusions__rule').remove();
                this.clearErrors();
            }
        }, { shouldHandle: event => Boolean(event.target.closest('[data-exclusion-action]')), preventDefault: true });
    }

    /** 每次打开或恢复推荐值时重建草稿，之前尚未完成的保存随之失效。 */
    setSettings(settings = this.service.getSettings()) {
        this.cancel();
        this.enabled.checked = settings.enabled;
        this.search.checked = settings.applyToSearch;
        this.rows.replaceChildren();
        for (const rule of settings.rules) this.addRule(rule.pattern, rule.enabled);
        this.clearErrors();
    }

    /** 添加可键盘操作的规则行，复用父容器的点击代理避免逐行监听器泄漏。 */
    addRule(pattern, enabled, focus = false) {
        const row = document.createElement('div');
        row.className = 'file-exclusions__rule';
        const controls = document.createElement('div');
        controls.className = 'file-exclusions__controls';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = enabled;
        toggle.dataset.ruleEnabled = '';
        toggle.setAttribute('aria-label', t('fileExclusions.enableRule'));
        const input = document.createElement('input');
        input.type = 'text';
        input.value = pattern;
        input.dataset.rulePattern = '';
        input.className = 'file-exclusions__pattern';
        input.placeholder = '*.log';
        input.spellcheck = false;
        input.setAttribute('aria-label', t('fileExclusions.pattern'));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.exclusionAction = 'remove';
        remove.className = 'file-exclusions__remove';
        remove.textContent = t('fileExclusions.remove');
        controls.append(toggle, input, remove);
        const error = document.createElement('p');
        error.className = 'file-exclusions__error';
        error.hidden = true;
        error.setAttribute('role', 'alert');
        row.append(controls, error);
        this.rows.appendChild(row);
        if (focus) input.focus();
    }

    /** 清空上次提交的提示，不改变用户输入。 */
    clearErrors() {
        this.error.hidden = true;
        for (const row of this.rows.children) {
            row.querySelector('.file-exclusions__error').hidden = true;
            row.querySelector('[data-rule-pattern]').removeAttribute('aria-invalid');
        }
    }

    /** 读取当前草稿；空行也交给后端校验，避免悄悄丢弃用户输入。 */
    getSettings() {
        return {
            enabled: this.enabled.checked,
            applyToSearch: this.search.checked,
            rules: Array.from(this.rows.children, row => ({
                pattern: row.querySelector('[data-rule-pattern]').value,
                enabled: row.querySelector('[data-rule-enabled]').checked,
            })),
        };
    }

    /** 验证并保存整份草稿；失败时逐行展示错误并保持设置对话框打开。 */
    async save() {
        const epoch = this.epoch;
        this.clearErrors();
        try {
            return await this.service.save(this.getSettings(), () => epoch === this.epoch);
        } catch (error) {
            if (epoch !== this.epoch) return false;
            this.error.textContent = t(error.ruleErrors ? 'fileExclusions.invalidRules' : 'fileExclusions.saveFailed');
            this.error.hidden = false;
            for (const issue of error.ruleErrors || []) {
                const row = this.rows.children[issue.index];
                const message = t(`fileExclusions.errors.${issue.code}`);
                if (!row) { this.error.textContent = message; continue; }
                row.querySelector('.file-exclusions__error').textContent = message;
                row.querySelector('.file-exclusions__error').hidden = false;
                row.querySelector('[data-rule-pattern]').setAttribute('aria-invalid', 'true');
            }
            return false;
        }
    }

    /** 关闭、取消或销毁设置页时，使仍在等待校验的提交失效。 */
    cancel() { this.epoch += 1; }

    /** 切回本页后定位第一处错误，长规则列表也能直接看到需要修正的位置。 */
    focusFirstError() {
        const field = this.rows.querySelector('[aria-invalid="true"]');
        field?.focus();
        (field || this.error).scrollIntoView({ block: 'nearest' });
    }

    /** 释放事件代理及未完成提交。 */
    dispose() { this.cancel(); this.cleanup?.(); }
}
