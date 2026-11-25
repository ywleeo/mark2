/** 在文档对话输入区展示并切换文档任务模型。 */
import { Dropdown } from '../../components/Dropdown.js';
import { getConfiguredModelGroups } from '../ai-assistant/providerModels.js';

/** 管理模型候选、当前值及其与 AI 设置的同步。 */
export class DocumentTaskModelPicker {
    /** 从现有 AI 配置建立下拉框，并订阅后续变更。 */
    constructor(select, { aiService, translate }) {
        this.select = select;
        this.aiService = aiService;
        this.translate = translate;
        this.busy = false;
        this.options = new Map();
        this.dropdown = new Dropdown(select, { search: {
            placeholder: translate('settings.searchModels'),
            empty: translate('settings.noMatchingModels'),
        } });
        this.onChange = () => {
            const model = this.options.get(select.value);
            if (!model || this.busy) return;
            aiService.saveConfig({ ...aiService.getConfig(), documentTaskModel: model });
        };
        select.addEventListener('change', this.onChange);
        this.unsubscribe = aiService.subscribe(event => {
            if (event.type === 'config' && !this.busy) this.refresh();
        });
        this.refresh();
    }

    /** 保留有效的当前模型，即使服务商后来返回的模型列表省略了它。 */
    refresh() {
        const current = this.aiService.getModelSlot('documentTask');
        const groups = getConfiguredModelGroups(this.aiService.getConfig().providers);
        const fragment = document.createDocumentFragment();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = this.translate('settings.selectModel');
        placeholder.disabled = true;
        fragment.appendChild(placeholder);
        this.options.clear();
        let selectedValue = '';
        let selectedProvider = '';
        for (const group of groups) {
            const sameProvider = current?.providerId === group.id;
            const models = sameProvider ? [...new Set([...group.models, current.model])] : group.models;
            if (!models.length) continue;
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.name;
            for (const model of models) {
                const option = document.createElement('option');
                option.value = JSON.stringify([group.id, model]);
                option.textContent = model;
                this.options.set(option.value, { providerId: group.id, model });
                if (sameProvider && model === current.model) {
                    selectedValue = option.value;
                    selectedProvider = group.name;
                }
                optgroup.appendChild(option);
            }
            fragment.appendChild(optgroup);
        }
        if (!this.options.size) placeholder.textContent = this.translate('aiFileTask.noModelsConfigured');
        this.select.replaceChildren(fragment);
        this.select.value = selectedValue;
        this.dropdown.refresh();
        const modelLabel = this.translate('aiFileTask.model');
        const display = selectedValue ? `${current.model} · ${selectedProvider}` : placeholder.textContent;
        this.dropdown.trigger.title = display;
        this.dropdown.trigger.setAttribute('aria-label', `${modelLabel} · ${display}`);
        this.dropdown.trigger.disabled = this.busy || !this.options.size;
    }

    /** 生成中锁定选择，结束后显示最新的对话模型。 */
    setBusy(busy) {
        if (this.busy !== busy) {
            this.busy = busy;
            if (busy) this.close();
            else this.refresh();
        }
        this.dropdown.trigger.disabled = busy || !this.options.size;
    }

    /** 收起挂载在页面顶层的候选面板。 */
    close() {
        this.dropdown.close();
    }

    /** 解除配置订阅及原生选择事件。 */
    destroy() {
        this.unsubscribe();
        this.select.removeEventListener('change', this.onChange);
        this.dropdown.destroy();
    }
}
