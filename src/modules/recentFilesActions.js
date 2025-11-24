/**
 * 处理最近打开文件菜单的操作
 */

import { invoke } from '@tauri-apps/api/core';

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
            console.error('[recentFilesActions] 更新最近菜单失败:', error);
        }
    }

    /**
     * 处理点击最近项菜单
     */
    async function handleRecentItemClick(index) {
        console.log('[recentFilesActions] 点击菜单项:', index);
        console.log('[recentFilesActions] 当前映射:', recentPathsMap);

        const path = recentPathsMap.get(index);
        if (!path) {
            console.warn('[recentFilesActions] 未找到路径映射:', index);
            return;
        }

        console.log('[recentFilesActions] 将要打开:', path);

        try {
            console.log('[recentFilesActions] 开始标准化路径...');
            const normalizedPath = normalizeFsPath(path);
            console.log('[recentFilesActions] 标准化路径结果:', normalizedPath);
            if (!normalizedPath) {
                console.warn('[recentFilesActions] 路径标准化失败');
                return;
            }

            console.log('[recentFilesActions] 检查文件是否存在...');
            const exists = await fileService.exists(normalizedPath);
            console.log('[recentFilesActions] 文件存在性:', exists);
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

            console.log('[recentFilesActions] 检查是否为目录...');
            const isDir = await fileService.isDirectory(normalizedPath);
            console.log('[recentFilesActions] 是否为目录:', isDir);

            const fileTree = getFileTree();
            console.log('[recentFilesActions] fileTree:', fileTree);

            if (isDir) {
                // 打开文件夹
                console.log('[recentFilesActions] 尝试打开文件夹...');
                if (fileTree && typeof fileTree.loadFolder === 'function') {
                    console.log('[recentFilesActions] 调用 loadFolder');
                    await fileTree.loadFolder(normalizedPath);
                    console.log('[recentFilesActions] loadFolder 完成');
                } else {
                    console.warn('[recentFilesActions] fileTree 未初始化或无 loadFolder 方法');
                }
            } else {
                // 打开文件
                console.log('[recentFilesActions] 尝试打开文件...');
                if (fileTree) {
                    console.log('[recentFilesActions] 调用 addToOpenFiles 和 selectFile');
                    fileTree.addToOpenFiles(normalizedPath);
                    fileTree.selectFile(normalizedPath);
                    console.log('[recentFilesActions] 文件打开完成');
                } else {
                    console.warn('[recentFilesActions] fileTree 未初始化');
                }
            }
        } catch (error) {
            console.error('[recentFilesActions] 打开最近项失败:', error);
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

    return {
        updateRecentMenu,
        handleRecentItemClick,
        clearRecent,
    };
}
