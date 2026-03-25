import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

export function createDocxRenderer() {
    return {
        id: 'docx',
        extensions: ['docx'],
        getViewMode() {
            return 'docx';
        },
        async load(ctx) {
            const { filePath, fileData, importAsUntitled } = ctx;

            const base64 = fileData?.content;
            if (!base64) return false;

            const arrayBuffer = base64ToArrayBuffer(base64);
            let result;
            try {
                result = await mammoth.convertToHtml({ arrayBuffer });
            } catch {
                throw new Error('无法解析此文件，请确认它是有效的 .docx 格式（不支持旧版 .doc 格式）');
            }

            const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            td.use(gfm);
            const markdown = td.turndown(result.value);

            const suggestedName = filePath.split(/[/\\]/).pop()?.replace(/\.docx$/i, '.md') || 'document.md';
            await importAsUntitled(markdown, suggestedName);
            return true;
        },
    };
}
