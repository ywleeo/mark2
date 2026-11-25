/** 将文件与模型错误归类，保证界面不显示服务商响应、编码信息或内部路径。 */
import { createDocumentTaskInterruption } from './DocumentTaskRecovery.js';

const DISPLAY_KEYS = {
    AI_FILE_PERMISSION: 'aiFileTask.error.filePermission',
    AI_FILE_MISSING: 'aiFileTask.error.fileMissing',
    AI_FILE_FORMAT: 'aiFileTask.error.fileFormat',
    AI_FILE_UNREADABLE: 'aiFileTask.error.fileUnreadable',
    AI_IMAGE_UNREADABLE: 'aiFileTask.error.imageUnreadable',
    AI_IMAGE_TOO_LARGE: 'aiFileTask.error.imageTooLarge',
    AI_IMAGE_NOT_SUPPORTED: 'aiFileTask.error.imageNotSupported',
    AI_MODEL_NOT_CONFIGURED: 'aiFileTask.noModelsConfigured',
    AI_MODEL_UNAVAILABLE: 'ai.error.modelUnavailable',
    AI_PROVIDER_CREDENTIALS: 'aiFileTask.error.providerCredentials',
    AI_PROVIDER_LIMIT: 'aiFileTask.error.providerLimit',
    AI_PROVIDER_BALANCE: 'ai.error.insufficientBalance',
    AI_PROVIDER_UNAVAILABLE: 'aiFileTask.error.serviceUnavailable',
    AI_NETWORK_ERROR: 'ai.error.network',
    'sharing-consent-required': 'privacy.permissionRequired',
};

/** 为对话界面取得本地化文案键。未知错误也使用可读且可行动的提示。 */
export function getDocumentTaskErrorKey(error) {
    return DISPLAY_KEYS[error?.code] || 'aiFileTask.error.sendFailed';
}

/** 保留已分类的任务状态，并通过明确的响应证据区分模型能力、图片及网络问题。 */
export function classifyDocumentTaskRequestError(error, { status, hasImage = false } = {}) {
    const code = error?.code;
    if (code === 'sharing-consent-required' || /^AI_[A-Z_]+$/.test(code || '')) return error;
    const details = String(error?.message ?? error ?? '').toLowerCase();
    const httpStatus = status ?? Number(details.match(/(?:api 请求失败|http(?: status)?)\s*:?\s*(\d{3})\b/)?.[1]);
    let failure = 'AI_REQUEST_FAILED';
    if (httpStatus === 401 || httpStatus === 403 || /invalid[_ ]api[_ ]key|authentication_error|unauthorized/.test(details)) {
        failure = 'AI_PROVIDER_CREDENTIALS';
    } else if (httpStatus === 402 || /creditserror|insufficient[_ ](?:balance|funds|credits|quota)/.test(details)) {
        failure = 'AI_PROVIDER_BALANCE';
    } else if (httpStatus === 429 || /rate[_ ]limit/.test(details)) {
        failure = 'AI_PROVIDER_LIMIT';
    } else if (hasImage && (httpStatus === 413 || /image.{0,35}(?:too large|too big|size limit|exceeds)|payload too large|exceeds.{0,25}image/.test(details))) {
        failure = 'AI_IMAGE_TOO_LARGE';
    } else if (hasImage && /invalid_image|invalid image|unsupported image format|image.{0,28}(?:format|mime type).{0,20}(?:not supported|unsupported|invalid)|(?:decode|load|read|parse).{0,20}image/.test(details)) {
        failure = 'AI_IMAGE_UNREADABLE';
    } else if (hasImage && /image_input_not_supported|unsupported_image_input|unsupported_modality|text[ -]only|only (?:supports|accepts) text|(?:not support|not accept|unsupported|no support for).{0,48}(?:image(?:_url|s| input| content)?|vision|multimodal|modality)|(?:image(?:_url|s| input| content)?|vision|multimodal).{0,48}(?:not supported|not available|unsupported)|content.{0,40}expected.{0,12}string/.test(details)) {
        failure = 'AI_IMAGE_NOT_SUPPORTED';
    } else if (httpStatus === 404 || /model_not_found|model.{0,40}not found|unknown model|model.{0,30}does not exist/.test(details)) {
        failure = 'AI_MODEL_UNAVAILABLE';
    } else if (/timeout|timed out|超时/.test(details) || httpStatus === 408 || httpStatus === 504) {
        failure = 'AI_IDLE_TIMEOUT';
    } else if (httpStatus >= 500 || /overloaded|service unavailable/.test(details)) {
        failure = 'AI_PROVIDER_UNAVAILABLE';
    } else if (/network|connection|failed to fetch|error sending request|dns|socket/.test(details)) {
        failure = 'AI_NETWORK_ERROR';
    }
    return createDocumentTaskInterruption(failure);
}
