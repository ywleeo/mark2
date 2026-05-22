/**
 * 文档导航历史（浏览器式后退 / 前进）—— 按 tab 分车道。
 *
 * 每个 tab 各有独立的访问栈（车道）：shared 预览位用稳定 id `shared-preview`，
 * file tab 用文件路径做 id。后退 / 前进只在「当前 active tab」的车道里走，
 * tab 之间互不串扰。
 *
 * - toolbarController 在文档切换时调用 setActiveLane + record
 * - file tab 因跟链接跳转 / 重命名导致路径变化时，由 navigationController /
 *   fileMenuActions 调 rekeyLane 把车道随 tab 迁移
 * - 实际跳转交给 navigationController 注入的 navigator 执行，本模块不直接碰 fileTree
 */

const MAX_ENTRIES = 100;

function createNavigationHistory() {
    // laneId -> { stack: string[], index: number }
    const lanes = new Map();
    let activeLaneId = null;
    let navigator = null;
    const listeners = new Set();

    function notify() {
        for (const fn of listeners) {
            try {
                fn();
            } catch (error) {
                console.error('[navigationHistory] listener 出错:', error);
            }
        }
    }

    function getLane(laneId, { create = false } = {}) {
        if (!laneId) return null;
        let lane = lanes.get(laneId);
        if (!lane && create) {
            lane = { stack: [], index: -1 };
            lanes.set(laneId, lane);
        }
        return lane || null;
    }

    return {
        /**
         * 注入实际跳转实现（由 navigationController 提供）。
         * navigator(toPath) 负责在当前 active tab 内把文档切到 toPath。
         */
        setNavigator(fn) {
            navigator = typeof fn === 'function' ? fn : null;
        },

        /**
         * 切换当前 active 车道（tab 切换 / 文档切换时调用）。
         */
        setActiveLane(laneId) {
            const next = laneId || null;
            if (activeLaneId === next) return;
            activeLaneId = next;
            notify();
        },

        /**
         * 记录一次文档访问到当前车道。
         * 与车道指针一致的文档（后退 / 前进回到的、切 tab 切回来的）不重复记录；
         * 从车道中段发起新导航时，会截断 forward 部分。
         */
        record(path) {
            if (!path || path.startsWith('untitled://')) return;
            if (!activeLaneId) return;
            const lane = getLane(activeLaneId, { create: true });
            if (lane.stack[lane.index] === path) return;

            lane.stack = lane.stack.slice(0, lane.index + 1);
            lane.stack.push(path);
            if (lane.stack.length > MAX_ENTRIES) {
                lane.stack = lane.stack.slice(lane.stack.length - MAX_ENTRIES);
            }
            lane.index = lane.stack.length - 1;
            notify();
        },

        /**
         * 把一条车道改键。用于 file tab 路径变化（跟链接跳转 / 重命名），
         * 栈与指针原样保留，使导航历史随 tab 迁移。
         */
        rekeyLane(oldId, newId) {
            if (!oldId || !newId || oldId === newId) return;
            const lane = lanes.get(oldId);
            if (!lane) return;
            lanes.delete(oldId);
            lanes.set(newId, lane);
            if (activeLaneId === oldId) activeLaneId = newId;
        },

        /**
         * 丢弃一条车道（tab 关闭时调用）。
         */
        dropLane(laneId) {
            if (!laneId || !lanes.has(laneId)) return;
            lanes.delete(laneId);
            if (activeLaneId === laneId) activeLaneId = null;
            notify();
        },

        canGoBack() {
            const lane = getLane(activeLaneId);
            return Boolean(lane) && lane.index > 0;
        },

        canGoForward() {
            const lane = getLane(activeLaneId);
            return Boolean(lane) && lane.index < lane.stack.length - 1;
        },

        goBack() {
            const lane = getLane(activeLaneId);
            if (!lane || lane.index <= 0) return;
            lane.index -= 1;
            const target = lane.stack[lane.index];
            notify();
            navigator?.(target);
        },

        goForward() {
            const lane = getLane(activeLaneId);
            if (!lane || lane.index >= lane.stack.length - 1) return;
            lane.index += 1;
            const target = lane.stack[lane.index];
            notify();
            navigator?.(target);
        },

        /**
         * 订阅历史变化，返回取消订阅函数。
         */
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
}

export const navigationHistory = createNavigationHistory();
