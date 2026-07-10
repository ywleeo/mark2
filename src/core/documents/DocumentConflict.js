/** 外部文件修改冲突的稳定错误码。 */
export const EXTERNAL_MODIFICATION_CONFLICT = 'EXTERNAL_MODIFICATION_CONFLICT';

/**
 * 创建可被保存链识别的外部修改冲突错误。
 * @param {string} filePath - 冲突文件路径
 * @returns {Error & {code:string,filePath:string}}
 */
export function createExternalModificationConflict(filePath) {
    const error = new Error('文件已在外部修改，自动保存已暂停');
    error.code = EXTERNAL_MODIFICATION_CONFLICT;
    error.filePath = filePath || '';
    return error;
}

/**
 * 判断错误是否属于外部修改冲突。
 * @param {unknown} error - 待判断错误
 * @returns {boolean}
 */
export function isExternalModificationConflict(error) {
    return Boolean(error && typeof error === 'object' && error.code === EXTERNAL_MODIFICATION_CONFLICT);
}
