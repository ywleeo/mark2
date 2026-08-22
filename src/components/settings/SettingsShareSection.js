/**
 * Settings 中的 GitHub Gist 分享配置区。
 * 仅负责静态结构，加载、保存及外链事件由 SettingsDialog 编排。
 */

/**
 * 渲染分享设置页。
 * @param {(key:string)=>string} translate - i18n 翻译函数。
 * @returns {string}
 */
export function renderSettingsShareSection(translate) {
    return `
        <section class="settings-body hidden" data-tab-content="share">
            <div class="settings-section-label">${translate('settings.gistSharing')}</div>
            <p class="settings-section-desc">${translate('settings.gistDescription')}</p>
            <div class="settings-rows">
                <label class="settings-row settings-row--stacked">
                    <span class="settings-row__label">${translate('settings.gistApiKey')}</span>
                    <input
                        type="password"
                        name="gistApiKey"
                        class="settings-row__control settings-row__control--wide"
                        placeholder="github_pat_… / ghp_…"
                        autocomplete="off"
                        spellcheck="false"
                    />
                </label>
            </div>
            <button type="button" class="settings-link-button" data-action="createGistToken">
                ${translate('settings.createGistToken')}
            </button>
            <p class="settings-section-desc settings-section-desc--compact">
                ${translate('settings.gistTokenPermission')}
            </p>
        </section>
    `;
}
