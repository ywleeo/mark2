import { t } from '../../i18n/index.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { extractFrontmatter } from '../../components/markdown-editor/MarkdownPreprocessor.js';
import { beautifyMarkdown } from '../../modules/markdown-beautify/markdownBeautifier.js';
import { showBeautifyProgressOverlay } from '../../modules/markdown-beautify/BeautifyProgressOverlay.js';

const logger = createLogger('document-beautify');

/**
 * 全篇 Markdown 格式美化执行器。
 * 仅把正文交给模型，frontmatter 保持原样并由 ContentLoader 继续管理。
 */
export class DocumentBeautifyManager {
    constructor({ markdownEditor, getMarkdown, replaceDocumentWithMarkdown }) {
        this.markdownEditor = markdownEditor;
        this.getMarkdown = getMarkdown;
        this.replaceDocumentWithMarkdown = replaceDocumentWithMarkdown;
        this.requestSeq = 0;
        this.unlock = null;
    }

    /** 执行整篇排版，并在编辑区展示可取消的明确进度。 */
    async execute() {
        const editor = this.markdownEditor?.editor;
        if (!editor?.state) return false;
        const markdown = this.getMarkdown?.() || '';
        const { body } = extractFrontmatter(markdown);
        if (!body.trim()) return false;

        const requestId = ++this.requestSeq;
        const sourceDoc = editor.state.doc;
        const cancel = () => this.cancel();
        this.unlock?.();
        this.unlock = showBeautifyProgressOverlay(this.markdownEditor, cancel);
        logger.info('request:start', { inputLength: body.length });

        try {
            // toolbar 的语义是“全篇”，不沿用右键局部排版的 300 行保护阈值。
            const result = await beautifyMarkdown(body, { maxLines: null });
            if (requestId !== this.requestSeq) return false;
            if (!editor.state.doc.eq(sourceDoc)) {
                throw new Error(t('aiWriting.error.documentChanged'));
            }
            this.replaceDocumentWithMarkdown?.(result);
            logger.info('request:success', { outputLength: result.length });
            return true;
        } catch (error) {
            if (requestId !== this.requestSeq) return false;
            logger.warn('request:failed', { error });
            alert(error?.message || t('beautify.error.generic'));
            return false;
        } finally {
            if (requestId === this.requestSeq) {
                this.unlock?.();
                this.unlock = null;
            }
        }
    }

    /** 取消当前结果写回并立即恢复编辑器交互。 */
    cancel() {
        this.requestSeq += 1;
        this.unlock?.();
        this.unlock = null;
        logger.info('request:cancelled');
    }

    /** 销毁执行器并释放可能存在的进度层。 */
    destroy() {
        this.cancel();
        this.markdownEditor = null;
    }
}
