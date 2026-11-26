/** 将本地音视频路由到主栏或副栏的流式播放器。 */
export function createMediaRenderer() {
    return {
        id: 'media',
        extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'],
        /** 返回音视频共用视图。 */
        getViewMode() {
            return 'media';
        },
        /** 激活播放器，并在设置媒体源前检查文件是否可读。 */
        async load(ctx) {
            const {
                filePath,
                editorRegistry,
                mediaViewer,
                fileService,
                view,
            } = ctx;

            view?.activate?.('media');
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.clear?.();
            await mediaViewer?.loadMedia?.(filePath, {
                ensureReadable: fileService.ensureReadable,
            });
            return true;
        },
    };
}
