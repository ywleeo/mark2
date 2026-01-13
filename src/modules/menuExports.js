import { save, message } from '@tauri-apps/plugin-dialog';
import {
    buildDefaultPdfPath,
    buildDefaultScreenshotPath,
    captureViewContent,
    collectContentForPdf,
} from '../utils/exportUtils.js';
import { captureScreenshot, exportToPdf } from '../api/native.js';

const PDF_PAGINATION_DEBUG = 'verbose';

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

async function exportPdfWithMode({
    activeViewMode,
    statusBarController,
    mode,
    pageFormat,
    dialogTitle,
    progressLabel,
    successLabel,
}) {
    let progressShown = false;
    try {
        const defaultPath = await buildDefaultPdfPath();
        const targetPath = await save({
            title: dialogTitle,
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

        statusBarController?.showProgress?.(progressLabel);
        progressShown = true;

        const { htmlContent, cssContent, pageWidth, htmlAttributes } = await collectContentForPdf(
            activeViewMode,
            {
                pageFormat,
                contentBottomPadding: 10, // 内容区底部到 footer 的距离（mm），可调整
                debugPagination: PDF_PAGINATION_DEBUG,
            }
        );
        await exportToPdf({
            destination: targetPath,
            htmlContent,
            cssContent,
            htmlAttributes,
            pageWidth,
            mode,
        });

        statusBarController?.showProgress?.(successLabel + targetPath, { state: 'success' });
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

export function exportCurrentViewToPdf({ activeViewMode, statusBarController }) {
    return exportPdfWithMode({
        activeViewMode,
        statusBarController,
        mode: undefined,
        pageFormat: undefined,
        dialogTitle: '导出 PDF',
        progressLabel: '正在导出 PDF…',
        successLabel: 'PDF 已保存：',
    });
}

export function exportCurrentViewToPdfA4({ activeViewMode, statusBarController }) {
    return exportPdfWithMode({
        activeViewMode,
        statusBarController,
        mode: 'a4',
        pageFormat: 'a4',
        dialogTitle: '导出 A4 PDF',
        progressLabel: '正在生成 A4 PDF…',
        successLabel: 'A4 PDF 已保存：',
    });
}
