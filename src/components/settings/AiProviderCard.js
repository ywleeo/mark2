/** 自定义 AI 网关卡片：带标签的字段、遮罩密钥与模型发现入口。 */
import { addClickHandler } from '../../utils/PointerHelper.js';

/** 创建显式标签的输入字段，密钥类型必须由调用者指定为 password。 */
export function createProviderField({ label, type = 'text', value = '', placeholder = '', className = 'ai-provider-card__input', field }) {
    const wrapper = document.createElement('label');
    wrapper.className = 'ai-provider-card__field';
    const caption = document.createElement('span');
    caption.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.className = className;
    input.value = value;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (field) input.dataset.field = field;
    wrapper.append(caption, input);
    return { wrapper, input };
}

/** 构造卡片并将输入写回原配置对象，删除/获取动作交由设置控制器处理。 */
export function buildAiProviderCard({ provider, index, translate, onChange, onRemove, onFetch, addCleanup }) {
    const card = document.createElement('div');
    card.className = 'ai-provider-card ai-provider-card--custom';
    const header = document.createElement('div');
    header.className = 'ai-provider-card__header';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'ai-provider-card__name-input';
    name.value = provider.name || '';
    name.placeholder = translate('settings.providerNamePlaceholder');
    name.setAttribute('aria-label', translate('settings.providerName'));
    name.addEventListener('input', () => { provider.name = name.value; });
    const badge = document.createElement('span');
    badge.className = 'ai-provider-card__badge';
    badge.textContent = translate('settings.customProvider');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ai-provider-card__remove';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', translate('settings.delete'));
    addCleanup(addClickHandler(remove, onRemove));
    header.append(name, badge, remove);
    card.appendChild(header);
    for (const [field, labelKey, placeholderKey, type] of [
        ['baseUrl', 'settings.baseUrl', 'settings.baseUrlPlaceholder', 'text'],
        ['apiKey', 'settings.apiKey', 'settings.apiKey', 'password'],
        ['models', 'settings.models', 'settings.modelsPlaceholder', 'text'],
    ]) {
        const { wrapper, input } = createProviderField({
            label: translate(labelKey), type, field,
            value: field === 'models' ? (provider.models || []).join(', ') : provider[field] || '',
            placeholder: translate(placeholderKey),
        });
        input.addEventListener('input', () => {
            provider[field] = field === 'models' ? input.value.split(',').map(value => value.trim()).filter(Boolean) : input.value.trim();
            onChange();
        });
        card.appendChild(wrapper);
    }
    const footer = document.createElement('div');
    footer.className = 'ai-provider-card__footer';
    const fetch = document.createElement('button');
    fetch.type = 'button';
    fetch.className = 'ai-provider-card__fetch';
    fetch.dataset.fetchIndex = String(index);
    fetch.textContent = '↻ ' + translate('settings.fetchList');
    addCleanup(addClickHandler(fetch, () => { if (!fetch.disabled) void onFetch(); }));
    const status = document.createElement('span');
    status.className = 'ai-provider-card__status';
    status.dataset.fetchStatus = String(index);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    footer.append(fetch, status);
    card.appendChild(footer);
    return card;
}
