/**
 * PTY 服务
 * 负责与 Rust 后端通信，管理终端进程
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * 创建 PTY 服务
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
