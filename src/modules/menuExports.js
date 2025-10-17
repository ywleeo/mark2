import { invoke } from '@tauri-apps/api/core';
import { save, message } from '@tauri-apps/plugin-dialog';
import {
    buildDefaultPdfPath,
    buildDefaultScreenshotPath,
    captureViewContent,
    collectContentForPdf,
} from '../utils/exportUtils.js';

export async function exportCurrentViewToImage({ ensureToPng }) {
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

        const dataUrl = await captureViewContent(ensureToPng);
        await invoke('capture_screenshot', {
            destination: targetPath,
            imageData: dataUrl,
        });
        await message('截图已保存至: ' + targetPath, {
            title: '截图完成',
            kind: 'info',
        });
    } catch (error) {
        console.error('生成截图失败', error);
        const reason = error?.message || String(error);
        await message('生成截图失败: ' + reason, {
            title: '截图失败',
            kind: 'error',
        });
    }
}

export async function exportCurrentViewToPdf({ activeViewMode }) {
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

        const { htmlContent, cssContent, pageWidth } = await collectContentForPdf(activeViewMode);
        await invoke('export_to_pdf', {
            destination: targetPath,
            htmlContent,
            cssContent,
            pageWidth,
        });

        await message('PDF 已保存至: ' + targetPath, {
            title: '导出完成',
            kind: 'info',
        });
    } catch (error) {
        console.error('导出 PDF 失败', error);
        const reason = error?.message || String(error);
        await message('导出 PDF 失败: ' + reason, {
            title: '导出失败',
            kind: 'error',
        });
    }
}

