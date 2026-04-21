import { save, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { desktopDir, join, tempDir } from '@tauri-apps/api/path';
import {
    buildDefaultScreenshotPath,
    captureViewContent,
    collectContentForPdf,
    formatTimestampForFilename,
} from '../utils/exportUtils.js';
import { captureScreenshot } from '../api/native.js';

export async function exportCurrentViewToImage({ statusBarController }) {
    let progressShown = false;
    try {
        const defaultPath = await buildDefaultScreenshotPath();
        const targetPath = await save({
            title: '保存截图',
            filters: [
                {
                    name: 'PNG 图片',
                    extensions: ['png'],
                },
            ],
            defaultPath,
        });

        if (!targetPath) {
            return;
        }

        statusBarController?.showProgress?.('正在导出 PNG…');
        progressShown = true;

        const dataUrl = await captureViewContent();
        await captureScreenshot(targetPath, dataUrl);

        statusBarController?.showProgress?.('PNG 已保存：' + targetPath, { state: 'success' });
        statusBarController?.hideProgress?.({ delay: 2200 });
        progressShown = false;
    } catch (error) {
        console.error('生成截图失败', error);
        if (progressShown) {
            statusBarController?.hideProgress?.();
            progressShown = false;
        }
        const reason = error?.message || String(error);
        await message('生成截图失败: ' + reason, {
            title: '截图失败',
            kind: 'error',
        });
    } finally {
        if (progressShown) {
            statusBarController?.hideProgress?.();
        }
    }
}

export async function exportCurrentViewToMobileImage({ statusBarController }) {
    let progressShown = false;
    try {
        const timestamp = formatTimestampForFilename(new Date());
        const fileName = `Mark2-Mobile-${timestamp}.png`;
        let defaultPath = fileName;
        try {
            const desktop = await desktopDir();
            if (desktop) defaultPath = await join(desktop, fileName);
        } catch (_) {}

        const targetPath = await save({
            title: '保存手机图片',
            filters: [{ name: 'PNG 图片', extensions: ['png'] }],
            defaultPath,
        });
        if (!targetPath) return;

        statusBarController?.showProgress?.('正在导出手机图片…');
        progressShown = true;

        const dataUrl = await captureViewContent({ mobile: true });
        await captureScreenshot(targetPath, dataUrl);

        statusBarController?.showProgress?.('手机图片已保存：' + targetPath, { state: 'success' });
        statusBarController?.hideProgress?.({ delay: 2200 });
        progressShown = false;
    } catch (error) {
        console.error('生成手机图片失败', error);
        if (progressShown) {
            statusBarController?.hideProgress?.();
            progressShown = false;
        }
        await message('生成手机图片失败: ' + (error?.message || String(error)), {
            title: '导出失败',
            kind: 'error',
        });
    } finally {
        if (progressShown) statusBarController?.hideProgress?.();
    }
}

export async function exportCurrentViewToPdf({ activeViewMode, statusBarController }) {
    try {
        statusBarController?.showProgress?.('正在准备打印…');

        const { htmlContent, cssContent, htmlAttributes } = await collectContentForPdf(
            activeViewMode,
            { pageFormat: 'a4' }
        );

        // 构建完整的 HTML 文档
        const attrString = Object.entries(htmlAttributes || {})
            .map(([key, value]) => `${key}="${value}"`)
            .join(' ');

        const fullHtml = `<!DOCTYPE html>
<html ${attrString}>
<head>
    <meta charset="UTF-8">
    <title>Mark2 PDF Export</title>
    <style>${cssContent}</style>
    <script>
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 800);
        };
    </script>
</head>
<body>
    ${htmlContent}
</body>
</html>`;

        // 保存为临时 HTML 文件
        const tempDirPath = await tempDir();
        const timestamp = Date.now();
        const tempFileName = `mark2-print-${timestamp}.html`;
        const tempFilePath = await join(tempDirPath, tempFileName);

        await writeTextFile(tempFilePath, fullHtml);

        statusBarController?.hideProgress?.();

        // 用系统浏览器打开临时文件
        await invoke('open_path_in_browser', { path: tempFilePath });

    } catch (error) {
        console.error('准备打印失败', error);
        statusBarController?.hideProgress?.();
        await message('准备打印失败: ' + (error?.message || String(error)), {
            title: '打印失败',
            kind: 'error',
        });
    }
}
