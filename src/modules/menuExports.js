import { invoke } from '@tauri-apps/api/core';
import { save, message } from '@tauri-apps/plugin-dialog';
import {
    buildDefaultPdfPath,
    buildDefaultScreenshotPath,
    captureViewContent,
    collectContentForPdf,
} from '../utils/exportUtils.js';

export async function exportCurrentViewToImage({ ensureToPng, statusBarController }) {
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

        const dataUrl = await captureViewContent(ensureToPng);
        await invoke('capture_screenshot', {
            destination: targetPath,
            imageData: dataUrl,
        });

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

export async function exportCurrentViewToPdf({ activeViewMode, statusBarController }) {
    let progressShown = false;
    try {
        const defaultPath = await buildDefaultPdfPath();
        const targetPath = await save({
            title: '导出 PDF',
            filters: [
                {
                    name: 'PDF 文件',
                    extensions: ['pdf'],
                },
            ],
            defaultPath,
        });

        if (!targetPath) {
            return;
        }

        statusBarController?.showProgress?.('正在导出 PDF…');
        progressShown = true;

        const { htmlContent, cssContent, pageWidth } = await collectContentForPdf(activeViewMode);
        await invoke('export_to_pdf', {
            destination: targetPath,
            htmlContent,
            cssContent,
            pageWidth,
        });

        statusBarController?.showProgress?.('PDF 已保存：' + targetPath, { state: 'success' });
        statusBarController?.hideProgress?.({ delay: 2200 });
        progressShown = false;
    } catch (error) {
        console.error('导出 PDF 失败', error);
        if (progressShown) {
            statusBarController?.hideProgress?.();
            progressShown = false;
        }
        const reason = error?.message || String(error);
        await message('导出 PDF 失败: ' + reason, {
            title: '导出失败',
            kind: 'error',
        });
    } finally {
        if (progressShown) {
            statusBarController?.hideProgress?.();
        }
    }
}
