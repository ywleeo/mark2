/**
 * 功能开关配置
 *
 * MAS (Mac App Store) 版本由于沙盒限制，部分功能不可用：
 * - 无法调用系统终端执行脚本
 * - 无法访问 Homebrew 等第三方工具和环境
 *
 * 构建 MAS 版本时，mas-release.sh 脚本会自动将 MAS_BUILD 设为 true
 */

// MAS 构建标记 - 发布 MAS 版本时由脚本自动设为 true
export const MAS_BUILD = false;

/**
 * mark2 Cloud 账户的隐藏开关。
 *
 * 默认关闭（Settings 不显示账户行，model 下拉无 mark2 Cloud 选项，启动也不读 keyring）。
 * 未正式上线，但联调 / 正式版灰度都可在 devtools console 里手动开启，无需改代码或重新打包：
 *   localStorage.setItem('cloudAccountEnabled', '1')   // 开启，刷新生效
 *   localStorage.removeItem('cloudAccountEnabled')     // 恢复关闭
 * （devtools feature 在 release 版也启用，所以正式版同样可用此开关。）
 */
function readCloudAccountOverride() {
    try {
        return localStorage.getItem('cloudAccountEnabled') === '1';
    } catch (_) {
        // localStorage 不可用时保持关闭
        return false;
    }
}

// 功能开关
export const features = {
    // 右键 Run 执行脚本 - MAS 版本禁用（无法调用系统终端）
    runScript: !MAS_BUILD,

    // 内置终端 - MAS 版本禁用（沙盒无法执行 PTY）
    terminal: !MAS_BUILD,

    // mark2 Cloud 账户：默认关闭，由隐藏的 localStorage 开关启用（见上方说明）
    cloudAccount: readCloudAccountOverride(),
};

// 获取功能是否可用
export function isFeatureEnabled(featureName) {
    return features[featureName] ?? true;
}

// 获取 MAS 版本功能限制提示
export function getMASLimitationMessage(featureName) {
    const messages = {
        runScript: 'App Store 版本无法执行脚本。如需此功能，请使用官网下载的完整版本。',
        terminal: 'App Store 版本不支持内置终端。如需此功能，请使用官网下载的完整版本。',
    };
    return messages[featureName] || 'App Store 版本不支持此功能。';
}
