let documentIORef = null;

function ensureDocumentIO() {
    if (!documentIORef) {
        throw new Error('[document] DocumentIO 尚未初始化');
    }
    return documentIORef;
}

export function registerDocumentIO(instance) {
    if (!instance) {
        throw new Error('registerDocumentIO 需要有效的 DocumentIO 实例');
    }
    documentIORef = instance;
}

export function getCapabilities() {
    return ensureDocumentIO().getCapabilities();
}

export function read(options) {
    return ensureDocumentIO().readDocument(options);
}

export function readRange(options) {
    return ensureDocumentIO().readRange(options);
}

export async function append(options) {
    return await ensureDocumentIO().appendToDocument(options);
}

export async function insertAfter(options) {
    return await ensureDocumentIO().insertAfterRange(options);
}

export async function replaceRange(options) {
    return await ensureDocumentIO().replaceRange(options);
}

export function getDocumentApi() {
    return {
        getCapabilities,
        read,
        readRange,
        append,
        insertAfter,
        replaceRange,
    };
}
