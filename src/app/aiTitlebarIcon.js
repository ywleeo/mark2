/**
 * Titlebar 的 AI 入口图标(#titlebar-ai)。
 *
 * - 仅在登录 mark2 Cloud 后显示;点击唤起 AI 助手侧边栏。
 * - 与账户图标分工不同:账户图标 features.cloudAccount 开启即常显,
 *   本图标按登录态显隐(未登录隐藏)。
 * - 单例,跟应用同生命周期,不返回 cleanup。
 */

import { addClickHandler } from '../utils/PointerHelper.js';
import { subscribe, getCloudCredentials } from '../modules/cloud-account/index.js';

const BUTTON_ID = 'titlebar-ai';

let isSetup = false;

export function setupAiTitlebarIcon({ onToggle } = {}) {
    if (isSetup) return;

    const btn = document.getElementById(BUTTON_ID);
    if (!btn) {
        console.warn('[ai-titlebar] button #titlebar-ai not found');
        return;
    }
    isSetup = true;

    addClickHandler(btn, () => { onToggle?.(); });

    // 登录态 → 显隐
    const apply = () => { btn.hidden = !getCloudCredentials().loggedIn; };
    apply();
    subscribe(apply);
}
