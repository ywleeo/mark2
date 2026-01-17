/**
 * AI Sidebar 存储工具
 * 使用本地文件系统存储对话历史
 */

import { readFile, writeFile } from '../../../api/filesystem.js';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_FILES = {
    CONVERSATIONS: 'ai-conversations.json',
    SETTINGS: 'ai-settings.json',
};

const DEFAULTS = {
    SIDEBAR_WIDTH: 380,
    MAX_CONVERSATIONS: 50,
};

/**
 * 获取对话文件路径
 */
async function getConversationsPath() {
    const { appCacheDir, join } = await import('@tauri-apps/api/path');
    const cache = await appCacheDir();
    return await join(cache, STORAGE_FILES.CONVERSATIONS);
}

/**
 * 获取设置文件路径
 */
async function getSettingsPath() {
    const { appCacheDir, join } = await import('@tauri-apps/api/path');
    const cache = await appCacheDir();
    return await join(cache, STORAGE_FILES.SETTINGS);
}

/**
 * 检查文件是否存在
 */
async function fileExists(path) {
    try {
        await invoke('get_file_metadata', { path });
        return true;
    } catch {
        return false;
    }
}

/**
 * 确保目录存在
 */
async function ensureDirExists(filePath) {
    try {
        const { dirname } = await import('@tauri-apps/api/path');
        const dir = await dirname(filePath);
        await invoke('ensure_dir_exists', { path: dir });
    } catch {
        // 静默处理，目录可能已存在
    }
}

/**
 * 保存对话历史
 */
export async function saveConversations(conversations) {
    try {
        const limited = conversations.slice(-DEFAULTS.MAX_CONVERSATIONS);
        const path = await getConversationsPath();
        await ensureDirExists(path);
        await writeFile(path, JSON.stringify(limited, null, 2));
    } catch {
        // 静默处理保存失败，不影响用户体验
    }
}

/**
 * 加载对话历史
 */
export async function loadConversations() {
    try {
        const path = await getConversationsPath();

        if (!(await fileExists(path))) {
            return [];
        }

        const content = await readFile(path);
        return JSON.parse(content);
    } catch (error) {
        console.error('[SidebarStorage] 加载对话失败:', error);
        return [];
    }
}

/**
 * 加载设置
 */
async function loadSettings() {
    try {
        const path = await getSettingsPath();

        if (!(await fileExists(path))) {
            return {};
        }

        const content = await readFile(path);
        return JSON.parse(content);
    } catch (error) {
        console.error('[SidebarStorage] 加载设置失败:', error);
        return {};
    }
}

/**
 * 保存设置
 */
async function saveSettings(settings) {
    try {
        const path = await getSettingsPath();
        await ensureDirExists(path);
        await writeFile(path, JSON.stringify(settings, null, 2));
    } catch {
        // 静默处理保存失败
    }
}

/**
 * 保存 sidebar 宽度
 */
export async function saveSidebarWidth(width) {
    try {
        const settings = await loadSettings();
        settings.sidebarWidth = width;
        await saveSettings(settings);
    } catch (error) {
        console.error('[SidebarStorage] 保存宽度失败:', error);
    }
}

/**
 * 加载 sidebar 宽度
 */
export async function loadSidebarWidth() {
    try {
        const settings = await loadSettings();
        return settings.sidebarWidth ?? DEFAULTS.SIDEBAR_WIDTH;
    } catch (error) {
        console.error('[SidebarStorage] 加载宽度失败:', error);
        return DEFAULTS.SIDEBAR_WIDTH;
    }
}

/**
 * 保存 sidebar 可见状态
 */
export async function saveSidebarVisible(visible) {
    try {
        const settings = await loadSettings();
        settings.sidebarVisible = visible;
        await saveSettings(settings);
    } catch (error) {
        console.error('[SidebarStorage] 保存可见状态失败:', error);
    }
}

/**
 * 加载 sidebar 可见状态
 */
export async function loadSidebarVisible() {
    try {
        const settings = await loadSettings();
        return settings.sidebarVisible ?? false;
    } catch (error) {
        console.error('[SidebarStorage] 加载可见状态失败:', error);
        return false;
    }
}
