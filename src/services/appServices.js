import * as filesystem from '../api/filesystem.js';
import * as nativeCommands from '../api/native.js';
import { getDocumentApi } from '../api/document.js';
import { createFileService } from './fileService.js';
import { createWorkspaceService } from './workspaceService.js';

let cachedServices = null;

export function createAppServices(options = {}) {
    const document = options.documentApi || getDocumentApi();
    const file = options.fileService || createFileService();
    const workspace = createWorkspaceService({
        getCurrentFile: options.getCurrentFile,
        storageKey: options.workspaceStorageKey,
    });
    cachedServices = Object.freeze({
        filesystem,
        document,
        native: nativeCommands,
        file,
        workspace,
    });

    if (options.exposeToWindow !== false && typeof window !== 'undefined') {
        window.__MARK2_SERVICES__ = cachedServices;
    }

    return cachedServices;
}

export function getAppServices() {
    if (!cachedServices) {
        throw new Error('AppServices 尚未初始化');
    }
    return cachedServices;
}
