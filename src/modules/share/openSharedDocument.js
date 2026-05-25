/**
 * 处理 `mark2://open?share=<uuid>` deep link:从 mark2 cloud 取分享内容,
 * 在桌面打开为一个新的 untitled tab(本地副本,用户可编辑保存)。
 *
 * 不跟 oauthFlow.js 冲突:两边都监听同一个 `cloud-deep-link` 事件,
 * 各自只处理自己认识的 URL 形态,不认就跳过,互不打扰。
 *
 * URL 协议(给服务端伙伴的契约):
 *   mark2://open?share=<uuid>[&password=<pw>]
 *
 * 错误分类:
 *   - 410 → 分享已过期(toast)
 *   - 401 → 需要密码(toast 提示;桌面侧 MVP 不弹密码框)
 *   - 其它 → 通用打开失败 + 后端 detail
 */

import { listen } from '@tauri-apps/api/event';

import { api, ServerError } from '../cloud-account/serverApi.js';
import { t } from '../../i18n/index.js';
import { showShareToast } from './shareToast.js';

const DEEP_LINK_EVENT = 'cloud-deep-link';
const DEEP_LINK_SCHEME = 'mark2:';
const OPEN_HOST = 'open';

let unlisten = null;
// 由 setup 注入,签名: ({ content, filename }) => Promise<void>
let openAsUntitledImpl = null;

/**
 * 解析 deep link URL,只接受 `mark2://open?share=<uuid>` 这一种。
 * 不匹配的(包括 `mark2://auth?...`)直接返回 null,让其它 listener 处理。
 */
function parseOpenUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== DEEP_LINK_SCHEME) return null;
        if (u.host !== OPEN_HOST) return null;
        const shareUuid = u.searchParams.get('share');
        const password = u.searchParams.get('password');
        if (shareUuid) return { kind: 'share', uuid: shareUuid, password };
        return null;
    } catch (_) {
        return null;
    }
}

async function handleOpenShare({ uuid, password }) {
    try {
        // 先拉元信息,顺便检测是否需要密码 / 已过期
        const info = await api.getShareInfo({ uuid, password });
        if (info && info.requires_password === true) {
            showShareToast({
                title: t('share.openPasswordRequired'),
                variant: 'error',
            });
            return;
        }

        // 取原文
        const raw = await api.getShareRaw({ uuid, password });
        const content = (raw && typeof raw.content === 'string') ? raw.content : '';
        const filename = (info && info.filename) || `shared-${uuid}.md`;

        if (typeof openAsUntitledImpl !== 'function') {
            console.warn('[share/open] openAsUntitled 未注入,无法打开');
            return;
        }
        await openAsUntitledImpl({ content, filename });
        showShareToast({ title: t('share.opened'), hint: filename });
    } catch (e) {
        if (e instanceof ServerError && e.status === 410) {
            showShareToast({ title: t('share.openExpired'), variant: 'error' });
            return;
        }
        if (e instanceof ServerError && e.status === 401) {
            showShareToast({ title: t('share.openPasswordRequired'), variant: 'error' });
            return;
        }
        const detail = (e && (e.body?.detail || e.message)) || '';
        showShareToast({ title: t('share.openFailed'), hint: detail, variant: 'error' });
    }
}

/**
 * 挂载 deep-link listener。重复调用安全。
 * @param {Object} deps
 * @param {(args: { content: string, filename: string }) => Promise<void>} deps.openAsUntitled
 *   把内容打开为 untitled tab 的回调。一般注入 untitledController.handleImportAsUntitled
 *   的包装(只取需要的两个参数)。
 */
export async function setupOpenSharedDocumentListener({ openAsUntitled } = {}) {
    openAsUntitledImpl = openAsUntitled;
    if (unlisten) return;
    unlisten = await listen(DEEP_LINK_EVENT, async (event) => {
        const urls = Array.isArray(event.payload) ? event.payload : [event.payload];
        for (const url of urls) {
            const req = parseOpenUrl(url);
            if (!req) continue;
            if (req.kind === 'share') {
                await handleOpenShare({ uuid: req.uuid, password: req.password });
            }
        }
    });
}

export function disposeOpenSharedDocumentListener() {
    if (unlisten) {
        try { unlisten(); } catch (_) { /* ignore */ }
        unlisten = null;
    }
    openAsUntitledImpl = null;
}
