/**
 * PTY 服务
 * 负责与 Rust 后端通信，管理终端进程
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * 生成唯一的任务 ID
 */
function generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 创建任务执行器（用于 Workflow 执行命令）
 * 关键：先设置好事件监听器，再启动进程，避免竞态条件
 *
 * @param {Object} options
 * @param {string} options.command - 要执行的命令
 * @param {string} [options.cwd] - 工作目录
 * @param {number} [options.cols] - 终端列数
 * @param {number} [options.rows] - 终端行数
 * @param {Function} options.onData - 数据回调
 * @param {Function} options.onExit - 退出回调
 * @returns {Promise<{ ptyId: string, kill: Function }>}
 */
export async function createTaskRunner({
    command,
    cwd = null,
    cols = 120,
    rows = 30,
    onData,
    onExit,
}) {
    const taskId = generateTaskId();
    let ptyId = null;
    let dataUnlisten = null;
    let exitUnlisten = null;
    let exited = false;

    // 1. 先设置好事件监听器（使用 taskId 作为事件名）
    dataUnlisten = await listen(`pty-data:${taskId}`, (event) => {
        onData?.(event.payload);
    });

    exitUnlisten = await listen(`pty-exit:${taskId}`, (event) => {
        exited = true;
        cleanup();
        onExit?.(event?.payload || null);
    });

    function cleanup() {
        if (dataUnlisten) {
            dataUnlisten();
            dataUnlisten = null;
        }
        if (exitUnlisten) {
            exitUnlisten();
            exitUnlisten = null;
        }
    }

    try {
        // 2. 再启动进程，传入 taskId 作为 event_id
        ptyId = await invoke('pty_spawn', {
            cols,
            rows,
            cwd,
            command,
            eventId: taskId,
        });
    } catch (error) {
        cleanup();
        console.error('[TaskRunner] Spawn failed:', error);
        throw error;
    }

    return {
        ptyId,
        taskId,
        isExited: () => exited,
        kill: async () => {
            if (!ptyId) return;
            try {
                await invoke('pty_kill', { ptyId });
            } catch (error) {
                console.warn('[TaskRunner] Kill failed:', error);
            }
            cleanup();
        },
    };
}

/**
 * 创建 PTY 服务（用于交互式终端）
 */
export function createPtyService() {
    let ptyId = null;
    let dataUnlisten = null;
    let exitUnlisten = null;
    let onDataCallback = null;
    let onExitCallback = null;

    /**
     * 启动终端进程
     * @param {Object} options
     * @param {number} options.cols - 列数
     * @param {number} options.rows - 行数
     * @param {string} [options.cwd] - 工作目录
     */
    async function spawn({ cols = 80, rows = 24, cwd = null, command = null } = {}) {
        if (ptyId) {
            console.warn('[PTY Service] PTY already spawned');
            return ptyId;
        }

        try {
            ptyId = await invoke('pty_spawn', { cols, rows, cwd, command });
            console.log('[PTY Service] Spawned:', ptyId);

            // 监听数据事件
            dataUnlisten = await listen(`pty-data:${ptyId}`, (event) => {
                if (onDataCallback) {
                    onDataCallback(event.payload);
                }
            });

            // 监听退出事件
            exitUnlisten = await listen(`pty-exit:${ptyId}`, (event) => {
                console.log('[PTY Service] Exit:', ptyId);
                cleanup();
                if (onExitCallback) {
                    onExitCallback(event?.payload || null);
                }
            });

            return ptyId;
        } catch (error) {
            console.error('[PTY Service] Spawn failed:', error);
            throw error;
        }
    }

    /**
     * 向终端写入数据
     * @param {string} data - 要写入的数据
     */
    async function write(data) {
        if (!ptyId) {
            console.warn('[PTY Service] No PTY to write to');
            return;
        }

        try {
            await invoke('pty_write', { ptyId, data });
        } catch (error) {
            console.error('[PTY Service] Write failed:', error);
        }
    }

    /**
     * 调整终端大小
     * @param {number} cols - 列数
     * @param {number} rows - 行数
     */
    async function resize(cols, rows) {
        if (!ptyId) {
            return;
        }

        try {
            await invoke('pty_resize', { ptyId, cols, rows });
        } catch (error) {
            console.error('[PTY Service] Resize failed:', error);
        }
    }

    /**
     * 关闭终端
     */
    async function kill() {
        if (!ptyId) {
            return;
        }

        try {
            await invoke('pty_kill', { ptyId });
        } catch (error) {
            console.error('[PTY Service] Kill failed:', error);
        }

        cleanup();
    }

    /**
     * 清理资源
     */
    function cleanup() {
        if (dataUnlisten) {
            dataUnlisten();
            dataUnlisten = null;
        }
        if (exitUnlisten) {
            exitUnlisten();
            exitUnlisten = null;
        }
        ptyId = null;
    }

    /**
     * 设置数据回调
     * @param {Function} callback - 接收终端输出的回调
     */
    function onData(callback) {
        onDataCallback = callback;
    }

    /**
     * 设置退出回调
     * @param {Function} callback - 终端退出时的回调
     */
    function onExit(callback) {
        onExitCallback = callback;
    }

    /**
     * 检查 PTY 是否已启动
     */
    function isSpawned() {
        return ptyId !== null;
    }

    return {
        spawn,
        write,
        resize,
        kill,
        onData,
        onExit,
        isSpawned,
    };
}
