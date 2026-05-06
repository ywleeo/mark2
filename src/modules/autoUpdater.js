/**
 * 自动更新模块。
 * 启动时静默检查并下载；下载完成后显示浮层提示,用户点击"重启"才真正替换并重启。
 */
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';
import { addClickHandler } from '../utils/PointerHelper.js';
import { createStore } from '../services/storage.js';
import { isMac } from '../utils/platform.js';

const store = createStore('autoUpdater');
store.migrateFrom('autoUpdater:lastCheckAt', 'lastCheckAt', { parse: (raw) => Number(raw) });

const CHECK_DELAY_MS = 5000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h
// 退避间隔：2s / 5s / 10s，给 DNS 重建、连接恢复留够时间
const CHECK_RETRY_DELAYS_MS = [2000, 5000, 10000];
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAY_MS = 2000;

let toastEl = null;
let pendingUpdate = null;        // 已下载、待安装的 Update 对象
let pendingUpdateVersion = null; // 待安装的版本号

export function setupAutoUpdater() {
    setTimeout(() => {
        if (pendingUpdate) return;
        checkAndDownload(false).catch(err => {
            console.warn('[AutoUpdater] 启动检查更新失败:', err);
        });
    }, CHECK_DELAY_MS);

    // 窗口重新激活时基于时间戳补检查，规避休眠导致定时器失效
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            runScheduledCheck();
        }
    });
}

function runScheduledCheck() {
    if (pendingUpdate) return; // 已有待安装更新，等用户重启
    const last = Number(store.get('lastCheckAt', 0)) || 0;
    if (Date.now() - last < CHECK_INTERVAL_MS) return;
    checkAndDownload(false).catch(err => {
        console.warn('[AutoUpdater] 检查更新失败:', err);
    });
}

/**
 * 手动检查更新（菜单触发）。
 * - 检查中：loading toast
 * - 无新版本：短暂提示后自动消失
 * - 发现新版本：loading toast 变成下载中，下载完成后变成就绪浮层
 * - 出错：静默重试已在 checkWithRetry 内处理；最终失败时静默关掉 toast，不打扰用户
 */
export async function manualCheckUpdate() {
    if (pendingUpdate) {
        showUpdateReadyToast(pendingUpdateVersion);
        return;
    }
    showInfoToast({ title: '正在检查更新…', variant: 'loading' });
    try {
        const hasUpdate = await checkAndDownload(true);
        if (!hasUpdate) {
            showInfoToast({ title: '当前已是最新版本', variant: 'info', autoHideMs: 2500 });
        }
    } catch (err) {
        console.warn('[AutoUpdater] 手动检查更新失败（已静默）:', err);
        replaceToast();
    }
}

/**
 * 包一层重试：网络瞬时抖动不抛错给上层。
 * 共 4 次尝试，失败后退避 2s / 5s / 10s 再重试。
 */
async function checkWithRetry() {
    const delays = CHECK_RETRY_DELAYS_MS;
    const total = delays.length + 1;
    let lastErr;
    for (let attempt = 0; attempt < total; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, delays[attempt - 1]));
        }
        try {
            return await check();
        } catch (err) {
            lastErr = err;
            console.warn(`[AutoUpdater] check 失败(第${attempt + 1}/${total}次):`, err);
        }
    }
    throw lastErr;
}

async function checkAndDownload(manual) {
    const update = await checkWithRetry();
    store.set('lastCheckAt', Date.now());
    if (!update) {
        console.log('[AutoUpdater] 当前已是最新版本');
        return false;
    }

    console.log(`[AutoUpdater] 发现新版本: ${update.version},开始后台下载`);
    if (manual) {
        showInfoToast({ title: `正在下载新版本 ${update.version}…`, variant: 'loading' });
    }

    await downloadWithRetry(update);

    console.log('[AutoUpdater] 已下载,等待用户点击重启');
    pendingUpdate = update;
    pendingUpdateVersion = update.version;
    showUpdateReadyToast(update.version);
    return true;
}

async function downloadWithRetry(update) {
    let lastErr;
    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
        try {
            await update.download((progress) => {
                if (progress.event === 'Started') {
                    console.log(`[AutoUpdater] 开始下载(第${attempt}次),总大小: ${progress.data.contentLength} bytes`);
                } else if (progress.event === 'Finished') {
                    console.log('[AutoUpdater] 下载完成');
                }
            });
            return;
        } catch (err) {
            lastErr = err;
            console.warn(`[AutoUpdater] 下载失败(第${attempt}/${DOWNLOAD_MAX_ATTEMPTS}次):`, err);
            if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
                await new Promise(r => setTimeout(r, DOWNLOAD_RETRY_DELAY_MS));
            }
        }
    }
    throw lastErr;
}

async function applyPendingUpdate() {
    if (!pendingUpdate) return;
    try {
        console.log('[AutoUpdater] 开始 install()');
        await pendingUpdate.install();
        console.log('[AutoUpdater] install() 完成,开始 relaunch()');
        // macOS 上 plugin-process 的 relaunch() 直接 spawn 二进制，不走 LaunchServices，
        // 导致新进程窗口不前置、需手动点 dock。改走 Rust 侧 `open -n` 让系统正常登记前台 app。
        if (isMac) {
            await invoke('relaunch_via_open');
        } else {
            await relaunch();
        }
        console.log('[AutoUpdater] relaunch() 已调用');
    } catch (err) {
        console.warn('[AutoUpdater] 安装/重启失败:', err);
        showInfoToast({
            title: '更新安装失败',
            hint: err?.message || String(err),
            variant: 'error'
        });
    }
}

// ========== Toast 渲染 ==========

function dismissToast(el) {
    el.classList.remove('is-visible');
    setTimeout(() => {
        if (toastEl === el) {
            el.remove();
            toastEl = null;
        }
    }, 250);
}

function replaceToast() {
    if (toastEl) {
        toastEl.remove();
        toastEl = null;
    }
}

/**
 * 通用信息 toast（loading / info / error）。
 * - loading: 带 spinner，不可关闭
 * - info: 可指定 autoHideMs 自动消失
 * - error: 显示关闭按钮
 */
function showInfoToast({ title, hint = '', variant = 'info', autoHideMs = 0 }) {
    replaceToast();
    const el = document.createElement('div');
    el.className = `updater-toast updater-toast--${variant}`;
    const spinner = variant === 'loading' ? '<div class="updater-toast__spinner"></div>' : '';
    const closeBtn = variant === 'error' ? `
        <button type="button" class="updater-toast__close" data-action="dismiss" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M3 3 L11 11 M11 3 L3 11"/>
            </svg>
        </button>` : '';
    el.innerHTML = `
        ${spinner}
        <div class="updater-toast__body">
            <div class="updater-toast__title">${escapeHtml(title)}</div>
            ${hint ? `<div class="updater-toast__hint">${escapeHtml(hint)}</div>` : ''}
        </div>
        ${closeBtn}
    `;
    addClickHandler(el, (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'dismiss') dismissToast(el);
    });
    document.body.appendChild(el);
    toastEl = el;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    if (autoHideMs > 0) {
        setTimeout(() => dismissToast(el), autoHideMs);
    }
}

function showUpdateReadyToast(version) {
    replaceToast();
    const el = document.createElement('div');
    el.className = 'updater-toast updater-toast--ready';
    el.innerHTML = `
        <div class="updater-toast__body">
            <div class="updater-toast__title">新版本 ${escapeHtml(version)} 已就绪</div>
            <div class="updater-toast__hint">点击重启以完成更新</div>
        </div>
        <button type="button" class="updater-toast__btn" data-action="restart">立即重启</button>
        <button type="button" class="updater-toast__close" data-action="dismiss" aria-label="稍后">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M3 3 L11 11 M11 3 L3 11"/>
            </svg>
        </button>
    `;
    addClickHandler(el, async (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'restart') {
            await applyPendingUpdate();
        } else if (action === 'dismiss') {
            dismissToast(el);
        }
    });
    document.body.appendChild(el);
    toastEl = el;
    requestAnimationFrame(() => el.classList.add('is-visible'));
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
