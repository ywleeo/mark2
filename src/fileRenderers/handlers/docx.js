import { renderAsync } from 'docx-preview';

/**
 * 将 Tauri 返回的 Base64 二进制转换为 docx-preview 可读取的 Uint8Array。
 * @param {string} base64 - DOCX 文件的 Base64 内容。
 * @returns {Uint8Array} DOCX 二进制数据。
 */
function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

/**
 * 为一次 DOCX 加载创建隔离的预览 DOM，避免文档样式污染通用 embed 面板。
 * @param {HTMLElement} host - 通用嵌入视图容器。
 * @returns {{root: HTMLElement, body: HTMLElement, styles: HTMLElement}}
 */
function createPreviewElements(host) {
    host.replaceChildren();

    const root = document.createElement('div');
    root.className = 'docx-preview';

    const styles = document.createElement('div');
    styles.className = 'docx-preview__styles';

    const body = document.createElement('div');
    body.className = 'docx-preview__body';

    root.append(styles, body);
    host.appendChild(root);
    return { root, body, styles };
}

/**
 * 创建只读 DOCX 原格式预览渲染器。
 * @returns {Object} RendererRegistry 可注册的 DOCX handler。
 */
export function createDocxRenderer() {
    return {
        id: 'docx',
        extensions: ['docx'],
        /**
         * 返回 DOCX 的文档数据模式；实际 DOM 复用通用 embed 视图承载。
         * @returns {string} DOCX 文档模式。
         */
        getViewMode() {
            return 'docx';
        },
        /**
         * 直接渲染 DOCX 的分页内容，不再生成临时 Markdown 文档。
         * @param {Object} ctx - 文件渲染上下文。
         * @returns {Promise<boolean>} 是否完成渲染。
         */
        async load(ctx) {
            const { fileData, embedHost, view } = ctx;
            const base64 = fileData?.content;
            if (!base64 || !embedHost) return false;

            view?.activate?.('embed');
            const preview = createPreviewElements(embedHost);

            try {
                await renderAsync(
                    base64ToUint8Array(base64),
                    preview.body,
                    preview.styles,
                    {
                        className: 'docx',
                        inWrapper: true,
                        breakPages: true,
                        ignoreLastRenderedPageBreak: false,
                        renderHeaders: true,
                        renderFooters: true,
                        renderFootnotes: true,
                        renderEndnotes: true,
                        // DOCX 内嵌的任意 HTML 不进入应用 DOM，预览只渲染受支持的 Word 结构。
                        renderAltChunks: false,
                        useBase64URL: true,
                    },
                );
            } catch (error) {
                preview.root.remove();
                console.error('[DocxRenderer] DOCX 原格式预览失败', error);
                throw new Error('无法预览此文件，请确认它是有效的 .docx 格式（不支持旧版 .doc 格式）');
            }

            return true;
        },
    };
}
