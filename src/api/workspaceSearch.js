import { invoke } from '@tauri-apps/api/core';

/**
 * 在后台搜索一个或多个文件夹或单文件目标。
 * @param {{roots: string[], query: string, options: Object}} request - 搜索请求，roots 可同时包含目录和文件。
 * @returns {Promise<Object>} 搜索响应。
 */
export async function searchWorkspace(request) {
    return await invoke('search_workspace', { request });
}

/**
 * 取消当前仍在后台遍历的工作区搜索。
 * @returns {Promise<void>}
 */
export async function cancelWorkspaceSearch() {
    await invoke('cancel_workspace_search');
}
