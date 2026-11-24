/** 跨平台文件访问错误分类，供文稿和图片复用。 */

/**
 * 将文件系统异常转换为可稳定匹配的文本。
 * Tauri 在不同平台可能返回字符串、Error 或带 code/kind 的普通对象。
 */
function describeFsError(error) {
    if (!error) return '';
    if (typeof error === 'string') return error.toLowerCase();
    const parts = [error.code, error.kind, error.name, error.message];
    return parts.filter(value => typeof value === 'string').join(' ').toLowerCase();
}

/**
 * 只有明确的权限错误才允许弹出授权面板。
 * 文件不存在、路径错误等异常无法通过授权修复，不能误导用户反复授权。
 */
export function isFileAccessPermissionError(error) {
    const description = describeFsError(error);
    if (!description) return false;

    const missingPathPatterns = [
        'enoent',
        'notfound',
        'not found',
        'no such file or directory',
        'os error 2',
        'cannot find the file',
        'cannot find the path',
        '找不到指定的文件',
        '找不到指定的路径',
    ];
    if (missingPathPatterns.some(pattern => description.includes(pattern))) {
        return false;
    }

    const permissionPatterns = [
        'eacces',
        'eperm',
        'permissiondenied',
        'permission denied',
        'operation not permitted',
        'access denied',
        'not allowed',
        'forbidden',
        '权限不足',
        '拒绝访问',
    ];
    return /\bos error (?:1|13)\b/.test(description)
        || permissionPatterns.some(pattern => description.includes(pattern));
}
