/** 工作区排除规则的后端协议；通用文件读写继续使用 filesystem API。 */
import { invoke } from '@tauri-apps/api/core';

/** 用统一的 Rust 匹配器验证整份规则草稿。 */
export function validateFileExclusions(settings) {
    return invoke('validate_file_exclusions', { settings });
}

/** 读取某棵工作区树中的可见条目，根路径决定锚定规则的上下文。 */
export function listWorkspaceDirectory(path, rootPath, exclusions) {
    return invoke('list_workspace_directory', { path, rootPath, exclusions });
}
