/**
 * 平台检测工具。
 * 集中管理平台判断，避免各处重复检测 navigator.userAgent。
 */

const ua = typeof navigator?.userAgent === 'string' ? navigator.userAgent : '';

export const isWindows = ua.includes('Windows');
export const isMac = ua.includes('Macintosh');
