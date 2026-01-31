export class RendererRegistry {
    constructor() {
        this.handlers = new Map();
        this.handlersById = new Map();
        this.defaultHandler = null;
    }

    register(handler) {
        if (!handler || !handler.id) {
            throw new Error('[RendererRegistry] handler requires id');
        }
        this.handlersById.set(handler.id, handler);
        if (!Array.isArray(handler.extensions)) {
            throw new Error(`[RendererRegistry] handler ${handler.id} requires extensions`);
        }
        handler.extensions.forEach((ext) => {
            const normalized = String(ext || '').trim().toLowerCase();
            if (!normalized) {
                return;
            }
            this.handlers.set(normalized, handler);
        });
    }

    setDefaultHandler(handler) {
        if (!handler || !handler.id) {
            throw new Error('[RendererRegistry] default handler requires id');
        }
        this.defaultHandler = handler;
    }

    getHandlerForPath(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return null;
        }
        const match = filePath.toLowerCase().match(/\.([a-z0-9]+)$/);
        if (!match) {
            return this.defaultHandler;
        }
        return this.handlers.get(match[1]) || this.defaultHandler;
    }

    getHandlerById(id) {
        return this.handlersById.get(id) || null;
    }
}
