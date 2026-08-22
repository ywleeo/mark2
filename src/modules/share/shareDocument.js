/**
 * 当前 Markdown 文档的 GitHub Gist 分享编排。
 * 模块只依赖注入的内容 getter，不直接持有编辑器或全局状态。
 */

import { invoke } from '@tauri-apps/api/core';
import { basename } from '../../utils/pathUtils.js';
import { t } from '../../i18n/index.js';
import { loadGistShareSettings } from './gistSettings.js';
import { showShareToast } from './shareToast.js';

/**
 * 根据当前文件生成可读且稳定的 HTML 文件名。
 * @param {string|null} currentFile - 当前文件路径或 untitled URI。
 * @returns {string}
 */
export function buildGistFilename(currentFile) {
    if (currentFile && !String(currentFile).startsWith('untitled://')) {
        const name = basename(currentFile);
        if (name) return `${name.replace(/\.[^.]+$/, '') || 'document'}.html`;
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return `untitled-${stamp}.html`;
}

/**
 * 将当前 Markdown 上传为 Secret Gist，并把访问链接复制到剪贴板。
 * @param {Object} deps - 由命令层注入的文档依赖。
 * @param {() => string} deps.getMarkdown - 返回当前 Markdown 原文。
 * @param {() => string|null} deps.getCurrentFile - 返回当前文件路径。
 * @returns {Promise<{id: string, url: string}|null>}
 */
export async function shareCurrentDocument({ getMarkdown, getCurrentFile } = {}) {
    const { apiKey } = loadGistShareSettings();
    if (!apiKey) {
        showShareToast({
            title: t('share.apiKeyMissing'),
            hint: t('share.apiKeyMissingHint'),
            variant: 'error',
        });
        return null;
    }

    const markdown = typeof getMarkdown === 'function' ? getMarkdown() : '';
    if (!markdown || !markdown.trim()) {
        showShareToast({ title: t('share.empty'), variant: 'error' });
        return null;
    }

    const currentFile = typeof getCurrentFile === 'function' ? getCurrentFile() : null;
    const filename = buildGistFilename(currentFile);
    showShareToast({ title: t('share.uploading') });

    try {
        // 分享页渲染器依赖 Markdown 与 Mermaid，仅在用户实际分享时按需加载。
        const { buildSharePageHtml } = await import('./sharePageBuilder.js');
        const pageHtml = await buildSharePageHtml({
            markdown,
            currentFile,
            title: filename.replace(/\.html$/i, ''),
        });
        const result = await invoke('create_gist_share', {
            request: {
                apiKey,
                filename,
                content: pageHtml,
                description: `Shared from Mark2: ${filename}`,
            },
        });

        try {
            await navigator.clipboard.writeText(result.url);
        } catch (error) {
            console.warn('[gist-share] 分享成功，但写入剪贴板失败', error);
        }

        showShareToast({ title: t('share.copied'), linkUrl: result.url });
        return result;
    } catch (error) {
        const message = String(error || '');
        const isAuthError = message.includes('gist_auth:');
        showShareToast({
            title: t(isAuthError ? 'share.apiKeyInvalid' : 'share.failed'),
            hint: isAuthError ? t('share.apiKeyInvalidHint') : stripErrorPrefix(message),
            variant: 'error',
        });
        return null;
    }
}

/**
 * 去掉内部错误分类前缀，只向用户展示可读详情。
 * @param {string} message - Tauri 命令返回的错误字符串。
 * @returns {string}
 */
function stripErrorPrefix(message) {
    return message.replace(/^gist_[a-z]+:\s*/i, '').trim();
}
