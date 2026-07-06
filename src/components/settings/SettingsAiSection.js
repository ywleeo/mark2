/**
 * Settings AI section markup.
 * Keeps AI-specific layout out of the top-level SettingsDialog template.
 */

/**
 * Render the AI settings section.
 * @param {(key: string) => string} translate - i18n lookup function.
 * @returns {string}
 */
export function renderSettingsAiSection(translate) {
    return `
        <!-- AI 场景设置 -->
        <section class="settings-body hidden" data-tab-content="ai">
            <div data-ref="cloudAccountSlot"></div>

            <div class="settings-section-label">${translate('settings.apiKeys')}</div>
            <div class="ai-keys-list" data-ref="aiKeysList"></div>

            <div class="settings-rows">
                <label class="settings-row">
                    <span class="settings-row__label">${translate('settings.translationModel')}</span>
                    <select data-ref="translationModelSelect" class="settings-row__control"></select>
                </label>
                <label class="settings-row">
                    <span class="settings-row__label">${translate('settings.beautifyModel')}</span>
                    <select data-ref="beautifyModelSelect" class="settings-row__control"></select>
                </label>
                <label class="settings-row">
                    <span class="settings-row__label">${translate('settings.completionModel')}</span>
                    <select data-ref="completionModelSelect" class="settings-row__control"></select>
                </label>
                <label class="settings-row settings-row--sub">
                    <span class="settings-row__label">${translate('settings.completionCreativity')}</span>
                    <select name="aiCreativity" class="settings-row__control">
                        <option value="low">${translate('settings.creativityLow')}</option>
                        <option value="medium">${translate('settings.creativityMedium')}</option>
                        <option value="high">${translate('settings.creativityHigh')}</option>
                    </select>
                </label>
                <label class="settings-row settings-row--sub">
                    <span class="settings-row__label">${translate('settings.completionLength')}</span>
                    <select name="aiCompletionLength" class="settings-row__control">
                        <option value="short">${translate('settings.completionLengthShort')}</option>
                        <option value="medium">${translate('settings.completionLengthMedium')}</option>
                        <option value="long">${translate('settings.completionLengthLong')}</option>
                    </select>
                </label>
            </div>
        </section>
    `;
}
