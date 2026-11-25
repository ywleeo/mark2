/** 从已验证的 profile 生成实际签名权限，不将允许列表中的通配符写入签名。 */

/** 沙盒与应用身份保持确定；钥匙串仅声明应用自己的完整 access group。 */
export function createMasEntitlements(base, { profile, team }, bundleId) {
    if (base['com.apple.security.app-sandbox'] !== true) throw new Error('MAS 基础权限必须启用 App Sandbox');
    const appId = `${team}.${bundleId}`;
    const entitlements = { ...base, 'com.apple.application-identifier': appId,
        'com.apple.developer.team-identifier': team };
    const groups = profile.entitlements['keychain-access-groups'];
    if (groups) {
        if (!groups.includes(appId) && !groups.includes(`${team}.*`)) throw new Error('描述文件未允许应用默认的钥匙串 access group');
        entitlements['keychain-access-groups'] = [appId];
    }
    return entitlements;
}
