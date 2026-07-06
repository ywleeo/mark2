/**
 * 处理最近打开文件菜单的操作
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createLogger } from '../core/diagnostics/Logger.js';

const logger = createLogger('recent-files');

export function createRecentFilesActions(options = {}) {
    const {
        recentFilesService,
        fileService,
        normalizeFsPath,
        getFileTree,
        workspaceController,
    } = options;

    if (!recentFilesService) {
        throw new Error('createRecentFilesActions 需要提供 recentFilesService');
    }
    if (!fileService) {
        throw new Error('createRecentFilesActions 需要提供 fileService');
    }
    if (typeof normalizeFsPath !== 'function') {
        throw new Error('createRecentFilesActions 需要提供 normalizeFsPath 函数');
    }
    if (typeof getFileTree !== 'function') {
        throw new Error('createRecentFilesActions 需要提供 getFileTree 函数');
    }

    // 存储菜单索引到路径的映射
    const recentPathsMap = new Map();

    /**
     * 更新 Open Recent 菜单
     */
    async function updateRecentMenu() {
        try {
            const recentItems = recentFilesService.getRecentItems(10);

            // 清空映射
            recentPathsMap.clear();

            // 构建菜单项数据
            const menuItems = [];
            for (let i = 0; i < recentItems.length; i++) {
                const item = recentItems[i];
                // 存储索引到路径的映射
                recentPathsMap.set(i, item.path);

                // 显示完整路径，文件夹加斜杠后缀
                const label = item.type === 'folder' ? `${item.path}/` : item.path;

                menuItems.push({ label });
            }

            // 调用 Rust command 更新菜单（只更新实际存在的项）
            await invoke('update_recent_menu', { items: menuItems });
        } catch (error) {
            logger.error('更新最近菜单失败', error);
        }
    }

    /**
     * 处理点击最近项菜单
     */
    async function handleRecentItemClick(index) {
        logger.debug('点击最近菜单项', { index, mappedCount: recentPathsMap.size });

        const path = recentPathsMap.get(index);
        if (!path) {
            logger.warn('未找到最近菜单路径映射', { index });
            return;
        }

        logger.debug('准备打开最近项', { path });

        try {
            const normalizedPath = normalizeFsPath(path);
            logger.debug('最近项路径已标准化', { path, normalizedPath });
            if (!normalizedPath) {
                logger.warn('最近项路径标准化失败', { path });
                return;
            }

            const exists = await fileService.exists(normalizedPath);
            logger.debug('最近项存在性检查完成', { normalizedPath, exists });
            if (!exists) {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`文件或文件夹不存在：\n${normalizedPath}`, {
                    title: 'Open Recent',
                    kind: 'warning',
                });
                // 从列表中移除
                recentFilesService.removeItem(normalizedPath);
                // 更新菜单
                await updateRecentMenu();
                return;
            }

            const isDir = await fileService.isDirectory(normalizedPath);
            logger.debug('最近项类型检查完成', { normalizedPath, isDir });

            const fileTree = getFileTree();

            if (isDir) {
                // 打开文件夹
                if (fileTree && typeof fileTree.loadFolder === 'function') {
                    await fileTree.loadFolder(normalizedPath);
                    logger.info('已打开最近文件夹', { normalizedPath });
                } else {
                    logger.warn('fileTree 未初始化或无 loadFolder 方法');
                }
            } else {
                // 打开文件
                if (fileTree) {
                    fileTree.addToOpenFiles(normalizedPath);
                    fileTree.selectFile(normalizedPath);
                    logger.info('已打开最近文件', { normalizedPath });
                } else {
                    logger.warn('fileTree 未初始化');
                }
            }
        } catch (error) {
            logger.error('打开最近项失败', error);
            const { message } = await import('@tauri-apps/plugin-dialog');
            await message(`打开失败: ${error?.message || error}`, {
                title: 'Open Recent',
                kind: 'error',
            });
        }
    }

    /**
     * 清除所有最近打开的记录
     */
    async function clearRecent() {
        const { ask } = await import('@tauri-apps/plugin-dialog');
        const shouldClear = await ask('确认清除所有最近打开的文件和文件夹记录？', {
            title: 'Clear Recent',
            kind: 'warning',
            okLabel: '清除',
            cancelLabel: '取消',
        });

        if (shouldClear) {
            recentFilesService.clearAll();
            recentPathsMap.clear();
            // 更新菜单
            await updateRecentMenu();
            const { message } = await import('@tauri-apps/plugin-dialog');
            await message('已清除所有最近打开的记录', {
                title: 'Clear Recent',
                kind: 'info',
            });
        }
    }

    // 菜单重建后自动刷新最近文件列表
    listen('menu-rebuilt', () => {
        void updateRecentMenu();
    });

    return {
        updateRecentMenu,
        handleRecentItemClick,
        clearRecent,
    };
}
