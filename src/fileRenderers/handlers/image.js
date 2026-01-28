export function createImageRenderer() {
    return {
        id: 'image',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'],
        getViewMode() {
            return 'image';
        },
        async load(ctx) {
            const {
                filePath,
                editorRegistry,
                imageViewer,
                activateImageView,
            } = ctx;

            activateImageView?.();
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.clear?.();
            await imageViewer?.loadImage?.(filePath);
            return true;
        },
    };
}
