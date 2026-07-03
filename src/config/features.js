/**
 * 功能开关配置
 */

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
    // mark2 Cloud 账户：默认关闭，由隐藏的 localStorage 开关启用（见上方说明）
    cloudAccount: readCloudAccountOverride(),
};
