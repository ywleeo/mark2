/** 编译时注入的发行渠道；开发与 Node 测试默认沿用 GitHub 的能力。 */
export const DISTRIBUTION = typeof __MARK2_DISTRIBUTION__ === 'undefined'
    ? 'github' : __MARK2_DISTRIBUTION__;
export const SUPPORTS_DESKTOP_UPDATER = DISTRIBUTION === 'github';
export const PRIVACY_POLICY_URL = typeof __MARK2_PRIVACY_POLICY_URL__ === 'undefined'
    ? '' : __MARK2_PRIVACY_POLICY_URL__;
