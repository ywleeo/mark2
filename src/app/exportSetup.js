/**
 * 导出装配模块。
 * 将现有图片/PDF 导出实现注册到 ExportManager。
 */

import { exportCurrentViewToImage, exportCurrentViewToMobileImage, exportCurrentViewToPdf } from '../modules/menuExports.js';

/**
 * 导出能力 ID 常量。
 */
export const EXPORT_IDS = Object.freeze({
    CURRENT_VIEW_IMAGE: 'currentView.image',
    CURRENT_VIEW_IMAGE_MOBILE: 'currentView.image.mobile',
    CURRENT_VIEW_PDF: 'currentView.pdf',
});

/**
 * 注册当前应用的核心导出能力。
 * @param {{exportManager: Object, context: Object}} options - 导出装配参数
 * @returns {Function}
 */
export function registerCoreExports(options = {}) {
    const { exportManager, context = {} } = options;
    if (!exportManager || typeof exportManager.registerExport !== 'function') {
        throw new Error('registerCoreExports 需要 exportManager');
    }

    const disposers = [];
    const register = (id, handler, title) => {
        disposers.push(exportManager.registerExport({ id, handler, title }));
    };

    register(
        EXPORT_IDS.CURRENT_VIEW_IMAGE,
        () => exportCurrentViewToImage({
            statusBarController: context.getStatusBarController?.(),
        }),
        '导出当前视图为图片'
    );
    register(
        EXPORT_IDS.CURRENT_VIEW_IMAGE_MOBILE,
        () => exportCurrentViewToMobileImage({
            statusBarController: context.getStatusBarController?.(),
        }),
        '导出为手机图片'
    );
    register(
        EXPORT_IDS.CURRENT_VIEW_PDF,
        () => exportCurrentViewToPdf({
            activeViewMode: context.getActiveViewMode?.(),
            statusBarController: context.getStatusBarController?.(),
        }),
        '导出当前视图为 PDF'
    );

    return () => {
        while (disposers.length > 0) {
            const dispose = disposers.pop();
            try {
                dispose?.();
            } catch (error) {
                console.warn('移除导出注册失败', error);
            }
        }
    };
}
