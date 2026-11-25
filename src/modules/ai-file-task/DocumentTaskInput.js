/** 将当前文档读成文本，或将当前图片准备为模型可直接读取的图像。 */
import { getViewModeForPath, isCsvFilePath } from '../../utils/fileTypeUtils.js';
import { getFileReadFailureKind } from '../../utils/fileAccessErrors.js';
import { detectMimeType } from '../../utils/imageResolver.js';
import { createDocumentTaskInterruption } from './DocumentTaskRecovery.js';

const TEXT_VIEWS = new Set(['markdown', 'code', 'embed']);
const DIRECT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const FILE_ERRORS = {
    permission: 'AI_FILE_PERMISSION',
    missing: 'AI_FILE_MISSING',
    format: 'AI_FILE_FORMAT',
    unreadable: 'AI_FILE_UNREADABLE',
};

/** 将需兼容转换的图片绘制为静态 PNG，保持原文件完整。 */
async function convertToPng(dataUrl) {
    const image = new Image();
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const output = canvas.toDataURL('image/png');
    if (!output.startsWith('data:image/png;base64,')) throw new Error('Image conversion failed');
    return output;
}

/** 读取文本使用编辑器快照；图片直接走二进制读取，二者都保留文件权限检查。 */
export async function readDocumentTaskInput(path, { fileService, getFileContent, convertImage = convertToPng }) {
    const view = getViewModeForPath(path);
    if (view === 'image') {
        let base64;
        try {
            base64 = await fileService.readImageBase64(path);
        } catch (error) {
            const kind = getFileReadFailureKind(error);
            throw createDocumentTaskInterruption(kind === 'unreadable' ? 'AI_IMAGE_UNREADABLE' : FILE_ERRORS[kind]);
        }
        try {
            if (!base64) throw new Error('Empty image');
            const mime = detectMimeType(path);
            const dataUrl = `data:${mime};base64,${base64}`;
            return { imageUrl: DIRECT_IMAGE_TYPES.has(mime) ? dataUrl : await convertImage(dataUrl) };
        } catch {
            throw createDocumentTaskInterruption('AI_IMAGE_UNREADABLE');
        }
    }

    if (!TEXT_VIEWS.has(view) && !isCsvFilePath(path)) {
        throw createDocumentTaskInterruption('AI_FILE_FORMAT');
    }
    try {
        const snapshot = await getFileContent?.(path);
        if (typeof snapshot?.content === 'string') return { fileContent: snapshot.content };
        if (snapshot?.error) throw snapshot.error;
        return { fileContent: await fileService.readText(path) };
    } catch (error) {
        throw createDocumentTaskInterruption(FILE_ERRORS[getFileReadFailureKind(error)]);
    }
}
