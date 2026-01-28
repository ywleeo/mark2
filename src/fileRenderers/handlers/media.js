export function createMediaRenderer() {
    return {
        id: 'media',
        extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'],
        getViewMode() {
            return 'media';
        },
        async load(ctx) {
            const {
                filePath,
                editorRegistry,
                mediaViewer,
                activateMediaView,
            } = ctx;

            activateMediaView?.();
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.clear?.();
            await mediaViewer?.loadMedia?.(filePath);
            return true;
        },
    };
}
