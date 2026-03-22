/**
 * 空闲时内存清理模块
 *
 * 利用 requestIdleCallback 在浏览器空闲期执行清理任务，
 * 减少 GC 压力，避免在用户操作时出现卡顿。
 */

const IDLE_TIMEOUT = 10_000;    // 等待空闲的最大时间
const IDLE_INTERVAL = 30_000;   // 两次清理之间的最小间隔
const STALE_TAB_AGE = 5 * 60_000; // 非活跃 tab 状态超过 5 分钟视为可裁剪

const rIC = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 200);
const cIC = typeof cancelIdleCallback === 'function'
    ? cancelIdleCallback
    : clearTimeout;

let scheduled = null;
const cleanupTasks = [];

/**
 * 注册一个清理任务，空闲时会被调用
 */
export function registerIdleCleanup(task) {
    if (typeof task === 'function') {
        cleanupTasks.push(task);
    }
}

/**
 * 启动空闲清理调度（应用初始化时调用一次）
 */
export function startIdleGC() {
    scheduleNext();
}

/**
 * 停止空闲清理
 */
export function stopIdleGC() {
    if (scheduled !== null) {
        cIC(scheduled);
        scheduled = null;
    }
}

function scheduleNext() {
    if (scheduled !== null) return;
    scheduled = rIC(() => {
        scheduled = null;
        runCleanup();
        setTimeout(scheduleNext, IDLE_INTERVAL);
    }, { timeout: IDLE_TIMEOUT });
}

function runCleanup() {
    for (const task of cleanupTasks) {
        try {
            task();
        } catch (err) {
            console.warn('[idleGC] 清理任务出错', err);
        }
    }
}

/**
 * 裁剪 MarkdownEditor 非活跃 tab 的 EditorState（含 undo 历史）
 * snapshot 中的 markdown 快照保留，下次切回时会通过 setContent 重建
 */
export function createTabStateTrimmer(getMarkdownEditor) {
    return {
        trim() {
            const editor = getMarkdownEditor();
            if (!editor?.tabViewStates) return;

            const now = Date.now();
            const currentTab = editor.currentTabId;

            for (const [tabId, snapshot] of editor.tabViewStates) {
                if (tabId === currentTab) continue;
                if (!snapshot.editorState) continue;

                const lastActive = snapshot.lastActive ?? 0;
                if (now - lastActive < STALE_TAB_AGE) continue;

                snapshot.editorState = null;
            }
        },
    };
}
