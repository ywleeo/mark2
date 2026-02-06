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

// 功能开关
export const features = {
    // 右键 Run 执行脚本 - MAS 版本禁用（无法调用系统终端）
    runScript: !MAS_BUILD,

    // Workflow 功能 - MAS 版本禁用（沙盒无法执行 PTY）
    workflow: !MAS_BUILD,

    // Workflow 执行 - MAS 版本禁用（无法访问用户开发环境）
    workflowExecution: !MAS_BUILD,

    // 内置终端 - MAS 版本禁用（沙盒无法执行 PTY）
    terminal: !MAS_BUILD,
};

// 获取功能是否可用
export function isFeatureEnabled(featureName) {
    return features[featureName] ?? true;
}

// 获取 MAS 版本功能限制提示
export function getMASLimitationMessage(featureName) {
    const messages = {
        runScript: 'App Store 版本无法执行脚本。如需此功能，请使用官网下载的完整版本。',
        workflow: 'App Store 版本不支持 Workflow 功能。如需此功能，请使用官网下载的完整版本。',
        workflowExecution: 'App Store 版本无法执行 Workflow。如需此功能，请使用官网下载的完整版本。',
        terminal: 'App Store 版本不支持内置终端。如需此功能，请使用官网下载的完整版本。',
    };
    return messages[featureName] || 'App Store 版本不支持此功能。';
}
