/**
 * 把当前 markdown 文档上传到 mark2 cloud 并生成公开分享链接。
 *
 * 流程:
 * 1. 检查 cloud 登录态(没登录 → toast 提示去 Settings 登录)
 * 2. 取当前文档 markdown 原文(空内容 → toast 提示)
 * 3. multipart 上传到 /api/storage/upload → 拿 file_id
 * 4. POST /api/shares 创建无密码、无过期的公开链接
 * 5. 把链接复制到剪贴板,toast 反馈(成功 / 配额超 / 失败)
 *
 * 调用方负责注入 getMarkdown / getCurrentFile 两个 getter,
 * 这里只做编排,不直接依赖 editorRegistry / appState 实例。
 */

import { basename } from '../../utils/pathUtils.js';
import { api, ServerError } from '../cloud-account/serverApi.js';
import { getState } from '../cloud-account/accountState.js';
import { t } from '../../i18n/index.js';
import { showShareToast } from './shareToast.js';

function buildFilename(currentFile) {
    if (currentFile && !String(currentFile).startsWith('untitled://')) {
        const name = basename(currentFile);
        if (name) return /\.md$/i.test(name) ? name : `${name}.md`;
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return `untitled-${stamp}.md`;
}

/**
 * @param {Object} deps
 * @param {() => string} deps.getMarkdown - 返回当前 markdown 原文
 * @param {() => string|null} deps.getCurrentFile - 返回当前文档路径(用来推文件名)
 * @returns {Promise<{ uuid:string, url:string } | null>}
 */
export async function shareCurrentDocument({ getMarkdown, getCurrentFile } = {}) {
    const { token, status } = getState();
    if (!token || status !== 'logged-in') {
        showShareToast({ title: t('share.notLoggedIn'), variant: 'error' });
        return null;
    }

    const markdown = typeof getMarkdown === 'function' ? getMarkdown() : '';
    if (!markdown || !markdown.trim()) {
        showShareToast({ title: t('share.empty'), variant: 'error' });
        return null;
    }

    const currentFile = typeof getCurrentFile === 'function' ? getCurrentFile() : null;
    const filename = buildFilename(currentFile);

    // toast 现在默认常驻,等成功 / 失败 toast 自然替换
    showShareToast({ title: t('share.uploading') });

    try {
        // 一步:直传内容生成分享。内容进 share_files(独立配额),不会出现在云文件夹列表里
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const share = await api.shareUpload({ blob, filename, token });

        try {
            await navigator.clipboard.writeText(share.url);
        } catch (e) {
            console.warn('[share] clipboard 写入失败,链接仍然可用:', e);
        }

        showShareToast({ title: t('share.copied'), hint: share.url });
        return share;
    } catch (e) {
        const detail = (e && (e.body?.detail || e.message)) || '';
        if (e instanceof ServerError && e.status === 401) {
            showShareToast({ title: t('share.notLoggedIn'), variant: 'error' });
        } else if (e instanceof ServerError && (e.status === 402 || e.status === 403)) {
            showShareToast({ title: t('share.quotaExceeded'), variant: 'error' });
        } else {
            showShareToast({ title: t('share.failed'), hint: detail, variant: 'error' });
        }
        return null;
    }
}
