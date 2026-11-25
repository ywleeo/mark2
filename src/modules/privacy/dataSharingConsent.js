/** 第三方 AI 与 Gist 的共享说明和明确授权，MAS / GitHub 使用同一套隐私行为。 */
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { createStore } from '../../services/storage.js';
import { t } from '../../i18n/index.js';
import { createConsentGate } from './consentGate.js';

const store = createStore('data-sharing', { version: 1 });
const consentMessages = { ai: 'privacy.aiMessage', 'ai-image': 'privacy.aiImageMessage', gist: 'privacy.gistMessage' };
const gate = createConsentGate({
    load: () => store.get('grants', {}),
    save: grants => store.set('grants', grants),
    prompt: (kind, recipient) => confirm(t(consentMessages[kind], { recipient }), {
        title: t('privacy.title'), kind: 'warning', okLabel: t('privacy.allow'), cancelLabel: t('common.cancel'),
    }),
});

/** 在请求发出前授权实际第三方服务 origin；替换模型服务商会重新询问。 */
export async function ensureAiSharingConsent(url, { containsImage = false } = {}) {
    try { await gate.ensure(containsImage ? 'ai-image' : 'ai', url); }
    catch (error) {
        if (error.code === 'sharing-consent-required') error.message = t('privacy.permissionRequired');
        throw error;
    }
}

/** 分享完整文稿及其嵌入图片前，说明 GitHub Secret Gist 的链接可访问性。 */
export async function ensureGistSharingConsent() {
    try { await gate.ensure('gist', 'https://api.github.com'); }
    catch (error) {
        if (error.code === 'sharing-consent-required') error.message = t('privacy.permissionRequired');
        throw error;
    }
}

/** 设置中允许撤回此前同意；不删除用户正文、配置或第三方已有的数据。 */
export async function revokeSharingConsents() {
    gate.revoke();
    await message(t('privacy.revoked'), { title: t('privacy.title') });
}

/** 无需离开应用即可阅读数据共享说明；公开政策链接由构建配置另行提供。 */
export async function showPrivacyInformation() {
    await message(t('privacy.summary'), { title: t('privacy.title') });
}
