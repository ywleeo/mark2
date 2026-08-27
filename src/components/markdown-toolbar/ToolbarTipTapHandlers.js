/**
 * 工具栏的 TipTap 处理器。
 * 负责识别 TipTap 编辑器、派发 TipTap 命令(bold/italic/heading/...),
 * 以及处理与 TipTap schema 相关的块级格式清除(lift + resetTextblock)。
 *
 * 通过构造函数接收 toolbar 引用,从中读取 editor 并在需要时回调 toolbar(如 emoji)。
 */
import { liftTarget } from '@tiptap/pm/transform';
import { TextSelection } from '@tiptap/pm/state';

export class ToolbarTipTapHandlers {
    constructor(toolbar) {
        this.toolbar = toolbar;
    }

    get editor() {
        return this.toolbar.editor;
    }

    isEditor() {
        const editor = this.editor;
        return Boolean(
            editor &&
            typeof editor.chain === 'function' &&
            editor.state &&
            editor.view
        );
    }

    runCommand(callback, options = {}) {
        if (!this.isEditor()) {
            return false;
        }
        const blockedNodes = Array.isArray(options?.blockedNodes) ? options.blockedNodes : null;
        if (blockedNodes && this.isSelectionInsideNode(blockedNodes)) {
            return 'blocked';
        }
        const chain = this.editor.chain().focus();
        const result = callback(chain);
        if (result === false) {
            return false;
        }
        return chain.run();
    }

    handleAction(action) {
        switch (action) {
            case 'bold':
                return this.toggleBoldWithSpacing();
            case 'italic':
                return this.runCommand(chain => chain.toggleItalic());
            case 'underline':
                return this.runCommand(chain => chain.toggleMark('htmlInline', { tag: 'u' }));
            case 'strikethrough':
                return this.runCommand(chain => chain.toggleStrike());
            case 'code':
                return this.runCommand(chain => chain.toggleCode());
            case 'heading1':
                return this.runCommand(chain => chain.toggleHeading({ level: 1 }), { blockedNodes: ['mermaidBlock'] });
            case 'heading2':
                return this.runCommand(chain => chain.toggleHeading({ level: 2 }), { blockedNodes: ['mermaidBlock'] });
            case 'heading3':
                return this.runCommand(chain => chain.toggleHeading({ level: 3 }), { blockedNodes: ['mermaidBlock'] });
            case 'heading4':
                return this.runCommand(chain => chain.toggleHeading({ level: 4 }), { blockedNodes: ['mermaidBlock'] });
            case 'heading5':
                return this.runCommand(chain => chain.toggleHeading({ level: 5 }), { blockedNodes: ['mermaidBlock'] });
            case 'heading6':
                return this.runCommand(chain => chain.toggleHeading({ level: 6 }), { blockedNodes: ['mermaidBlock'] });
            case 'increaseHeading':
                return this.adjustHeadingLevel('increase');
            case 'decreaseHeading':
                return this.adjustHeadingLevel('decrease');
            case 'quote':
                return this.runCommand(chain => chain.toggleBlockquote(), { blockedNodes: ['mermaidBlock'] });
            case 'unorderedList':
                return this.runCommand(chain => chain.toggleBulletList(), { blockedNodes: ['mermaidBlock'] });
            case 'orderedList':
                return this.runCommand(chain => chain.toggleOrderedList(), { blockedNodes: ['mermaidBlock'] });
            case 'indent':
                return this.adjustListIndent('indent');
            case 'outdent':
                return this.adjustListIndent('outdent');
            case 'taskList':
                if (typeof this.editor.commands?.toggleTaskList === 'function') {
                    return this.runCommand(chain => chain.toggleTaskList(), { blockedNodes: ['mermaidBlock'] });
                }
                return false;
            case 'link':
                return this.handleLink();
            case 'image':
                return this.handleImage();
            case 'table':
                return this.handleTable();
            case 'horizontalRule':
                return this.runCommand(chain => chain.setHorizontalRule(), { blockedNodes: ['mermaidBlock'] });
            case 'codeBlock':
                return this.handleCodeAsBlock();
            case 'mathBlock':
                return this.handleMathBlock();
            case 'clearFormatting':
                return this.clearFormatting();
            case 'emoji':
                return this.toolbar.handleEmojiPicker();
            case 'video':
                return this.handleVideo();
            default:
                return false;
        }
    }

    /**
     * 加粗选区并在中文等紧邻文本场景自动补空格。
     * 该逻辑由统一命令与工具栏共用，避免只在 TipTap 固定 Mod+B 键位生效。
     * @returns {boolean|string}
     */
    toggleBoldWithSpacing() {
        if (!this.isEditor()) return false;
        if (this.isSelectionInsideNode(['mermaidBlock'])) return 'blocked';

        const { state } = this.editor;
        const { from, to, empty } = state.selection;
        const boldType = state.schema.marks.bold;
        const isBold = Boolean(boldType?.isInSet(state.selection.$from.marks()));
        if (empty || isBold) {
            return this.runCommand(chain => chain.toggleBold());
        }

        const { doc, tr } = state;
        const $from = state.selection.$from;
        const isAtBlockStart = $from.parentOffset === 0;
        const charBefore = from > 0 ? doc.textBetween(from - 1, from) : '';
        const charAfter = to < doc.content.size
            ? doc.textBetween(to, Math.min(to + 1, doc.content.size))
            : '';
        const needSpaceBefore = !isAtBlockStart && charBefore !== '' && charBefore !== ' ' && charBefore !== '\n';
        const needSpaceAfter = charAfter !== '' && charAfter !== ' ' && charAfter !== '\n';

        if (!needSpaceBefore && !needSpaceAfter) {
            return this.runCommand(chain => chain.toggleBold());
        }

        let offset = 0;
        if (needSpaceAfter) tr.insertText(' ', to);
        if (needSpaceBefore) {
            tr.insertText(' ', from);
            offset = 1;
        }
        tr.setSelection(TextSelection.create(tr.doc, from + offset, to + offset));
        this.editor.view.dispatch(tr);
        return this.runCommand(chain => chain.toggleBold());
    }

    /**
     * 按“标题层级”调整当前块：正文 → H6 → … → H1，反向则回到正文。
     * @param {'increase'|'decrease'} direction - 调整方向
     * @returns {boolean|string}
     */
    adjustHeadingLevel(direction) {
        if (!this.isEditor()) return false;
        if (this.isSelectionInsideNode(['mermaidBlock'])) return 'blocked';

        const { $from } = this.editor.state.selection;
        let currentLevel = 0;
        for (let depth = $from.depth; depth >= 0; depth -= 1) {
            const node = $from.node(depth);
            if (node.type.name === 'heading') {
                currentLevel = Number(node.attrs.level) || 1;
                break;
            }
        }

        if (direction === 'increase') {
            const nextLevel = currentLevel === 0 ? 6 : Math.max(1, currentLevel - 1);
            return this.runCommand(
                chain => chain.setHeading({ level: nextLevel }),
                { blockedNodes: ['mermaidBlock'] }
            ) || 'blocked';
        }

        if (currentLevel === 0) return 'blocked';
        if (currentLevel >= 6) {
            return this.runCommand(
                chain => chain.setParagraph(),
                { blockedNodes: ['mermaidBlock'] }
            ) || 'blocked';
        }
        return this.runCommand(
            chain => chain.setHeading({ level: currentLevel + 1 }),
            { blockedNodes: ['mermaidBlock'] }
        ) || 'blocked';
    }

    /**
     * 调整当前列表项层级，支持普通列表与任务列表。
     * @param {'indent'|'outdent'} direction - 调整方向
     * @returns {boolean|string}
     */
    adjustListIndent(direction) {
        if (!this.isEditor()) return false;
        const { $from } = this.editor.state.selection;
        let itemType = null;
        for (let depth = $from.depth; depth >= 0; depth -= 1) {
            const nodeName = $from.node(depth).type.name;
            if (nodeName === 'taskItem' || nodeName === 'listItem') {
                itemType = nodeName;
                break;
            }
        }
        if (!itemType) return 'blocked';
        return direction === 'indent'
            ? this.runCommand(chain => chain.sinkListItem(itemType))
            : this.runCommand(chain => chain.liftListItem(itemType));
    }

    /**
     * 设置标题级别（幂等，供工具栏标题下拉使用）
     * @param {number} level - 0 表示正文，1-6 表示标题级别
     */
    applyHeading(level) {
        if (!level) {
            return this.runCommand(chain => chain.setParagraph(), { blockedNodes: ['mermaidBlock'] });
        }
        return this.runCommand(chain => chain.setHeading({ level }), { blockedNodes: ['mermaidBlock'] });
    }

    handleCodeAsBlock() {
        if (!this.isEditor()) {
            return false;
        }
        if (this.isSelectionInsideNode(['mermaidBlock'])) {
            return 'blocked';
        }

        const { state } = this.editor;
        const { from, to } = state.selection;

        const $from = state.doc.resolve(from);
        for (let depth = $from.depth; depth >= 0; depth--) {
            if ($from.node(depth).type.name === 'codeBlock') {
                return this.runCommand(chain => chain.toggleCodeBlock());
            }
        }

        if (from === to) {
            return this.runCommand(chain => chain.toggleCodeBlock());
        }

        const selectedText = state.doc.textBetween(from, to, '\n\n', '\n');
        if (!selectedText || selectedText.trim() === '') {
            return this.runCommand(chain => chain.toggleCodeBlock());
        }

        this.editor
            .chain()
            .focus()
            .command(({ tr, state: cmdState }) => {
                const { schema } = cmdState;
                const codeBlockNode = schema.nodes.codeBlock.create(
                    { language: 'plaintext' },
                    schema.text(selectedText)
                );
                tr.replaceSelectionWith(codeBlockNode);
                return true;
            })
            .run();

        return true;
    }

    /**
     * 打开公式输入框并插入可序列化为 `$$` 的数学块。
     * @returns {boolean|string}
     */
    handleMathBlock() {
        if (!this.isEditor()) return false;
        if (this.isSelectionInsideNode(['mermaidBlock'])) return 'blocked';
        void this._runMathBlockDialog();
        return true;
    }

    /** 执行数学块输入流程。 */
    async _runMathBlockDialog() {
        const { showMathBlockDialog } = await import('./InsertDialogs.js');
        const result = await showMathBlockDialog();
        if (!result?.latex) return;
        this.editor.chain().focus().insertContent({
            type: 'mathBlock',
            attrs: { latex: result.latex },
        }).run();
    }

    clearFormatting() {
        const blockedNodes = new Set(['mermaidBlock']);
        return this.runCommand(chain => {
            let next = chain.unsetAllMarks();
            next = next.command(({ state, tr }) => {
                this.clearBlockFormatting(state, tr, blockedNodes);
                return true;
            });
            return next;
        });
    }

    handleLink() {
        if (!this.isEditor()) {
            return false;
        }
        void this._runLinkDialog();
        return true;
    }

    async _runLinkDialog() {
        const [{ showLinkDialog }, { getCurrentDirectory }] = await Promise.all([
            import('./InsertDialogs.js'),
            import('../../utils/imageResolver.js'),
        ]);
        const currentFile = this.toolbar?.options?.getCurrentFilePath?.() || null;
        const currentDir = currentFile ? getCurrentDirectory(currentFile) : null;
        const { state } = this.editor;
        const { from, to, empty } = state.selection;
        const hasSelection = !empty;
        const selectedText = hasSelection ? state.doc.textBetween(from, to, ' ') : '';
        const currentHref = this.editor.getAttributes?.('link')?.href || '';

        const result = await showLinkDialog({ url: currentHref, text: selectedText, currentDir });
        if (!result) {
            return;
        }
        if (!result.url) {
            // 清空地址：若光标停在链接上则移除链接
            if (currentHref) {
                this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
            }
            return;
        }

        const { url, text } = result;
        if (hasSelection && (!text || text === selectedText)) {
            // 有选区且未改文字：直接给选中文字加链接
            this.editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        } else {
            // 无选区，或用户改了文字：插入一段带链接的文字
            this.editor.chain().focus()
                .insertContent({ type: 'text', text: text || url, marks: [{ type: 'link', attrs: { href: url } }] })
                .run();
        }
    }

    handleImage() {
        if (!this.isEditor()) {
            return false;
        }
        void this._runImageDialog();
        return true;
    }

    async _runImageDialog() {
        const [{ showImageDialog }, imageResolver] = await Promise.all([
            import('./InsertDialogs.js'),
            import('../../utils/imageResolver.js'),
        ]);
        const {
            getCurrentDirectory, resolveImagePath, isExternalImageSrc,
            readBinaryFromFs, createImageObjectUrl, registerImageObjectUrl,
        } = imageResolver;
        const currentFile = this.toolbar?.options?.getCurrentFilePath?.() || null;
        const currentDir = currentFile ? getCurrentDirectory(currentFile) : null;

        const result = await showImageDialog({ currentDir });
        if (!result || !result.url) {
            return;
        }

        // 本地图片需读成 objectUrl 才能在所见即所得编辑器里即时显示；
        // dataOriginalSrc 保留原路径，供 Markdown 序列化与下次加载时解析。
        const { url, alt } = result;
        let displaySrc = url;
        if (!isExternalImageSrc(url)) {
            const absPath = resolveImagePath(url, currentFile);
            if (absPath) {
                try {
                    const binary = await readBinaryFromFs(absPath, { requestAccessOnError: true });
                    const objectUrl = createImageObjectUrl(binary, absPath);
                    if (objectUrl) {
                        registerImageObjectUrl(objectUrl);
                        displaySrc = objectUrl;
                    }
                } catch (error) {
                    console.error('读取本地图片失败:', error);
                }
            }
        }

        this.editor.chain().focus().insertContent({
            type: 'image',
            attrs: {
                src: displaySrc,
                alt: alt || null,
                title: alt || null,
                dataOriginalSrc: url,
            },
        }).run();
    }

    handleVideo() {
        if (!this.isEditor()) {
            return false;
        }
        void this._runVideoDialog();
        return true;
    }

    async _runVideoDialog() {
        const [{ showVideoDialog }, { getCurrentDirectory }] = await Promise.all([
            import('./InsertDialogs.js'),
            import('../../utils/imageResolver.js'),
        ]);
        const currentFile = this.toolbar?.options?.getCurrentFilePath?.() || null;
        const currentDir = currentFile ? getCurrentDirectory(currentFile) : null;

        const result = await showVideoDialog({ currentDir });
        if (!result || !result.url) {
            return;
        }
        // videoBlock 是块级节点，src 由 NodeView 自行解析（相对路径 / URL 均可）
        this.editor.chain().focus().insertContent({
            type: 'videoBlock',
            attrs: { src: result.url },
        }).run();
    }

    handleTable() {
        if (!this.isEditor()) {
            return false;
        }
        if (this.isSelectionInsideNode(['mermaidBlock'])) {
            return 'blocked';
        }

        if (typeof this.editor.commands?.insertContent === 'function') {
            const createCellNode = (type, text) => ({
                type,
                content: [
                    {
                        type: 'paragraph',
                        content: text
                            ? [{ type: 'text', text }]
                            : [],
                    },
                ],
            });
            const sampleContent = [
                ['', '', ''],
                ['', '', ''],
                ['', '', ''],
            ];
            const tableNode = {
                type: 'table',
                content: sampleContent.map((row, rowIndex) => ({
                    type: 'tableRow',
                    content: row.map(cellText => createCellNode(
                        rowIndex === 0 ? 'tableHeader' : 'tableCell',
                        cellText
                    )),
                })),
            };

            const inserted = this.editor
                .chain()
                .focus()
                .insertContent(tableNode)
                .run();

            if (inserted) return true;
        }

        if (typeof this.editor.commands?.insertTable === 'function') {
            const inserted = this.editor.chain().focus().insertTable({
                rows: 3,
                cols: 3,
                withHeaderRow: true,
            }).run();
            if (inserted) return true;
        }

        if (typeof this.editor.commands?.insertContent !== 'function') {
            return false;
        }

        // 退回到插入 Markdown 文本(例如旧编辑器或 table 扩展不可用时)
        const markdownTable = `|  |  |  |
| --- | --- | --- |
|  |  |  |
|  |  |  |

`;

        this.editor
            .chain()
            .focus()
            .insertContent(markdownTable)
            .run();

        return true;
    }

    // --- ProseMirror 辅助:判断选区是否进入特定节点 ---
    isSelectionInsideNode(nodeNames = []) {
        if (!this.isEditor() || !nodeNames?.length) {
            return false;
        }
        const { state } = this.editor;
        if (!state) return false;

        const targetNames = new Set(nodeNames);

        const selectionNode = state.selection?.node;
        if (selectionNode && targetNames.has(selectionNode.type?.name)) {
            return true;
        }

        const checkPosition = ($pos) => {
            if (!$pos) return false;
            for (let depth = $pos.depth; depth >= 0; depth -= 1) {
                const node = $pos.node(depth);
                if (node && targetNames.has(node.type?.name)) {
                    return true;
                }
            }
            return false;
        };

        if (checkPosition(state.selection?.$from) || checkPosition(state.selection?.$to)) {
            return true;
        }

        let intersects = false;
        const { from, to } = state.selection || {};
        if (typeof from === 'number' && typeof to === 'number' && to > from) {
            state.doc.nodesBetween(from, to, (node) => {
                if (!node || intersects) {
                    return !intersects;
                }
                if (targetNames.has(node.type?.name)) {
                    intersects = true;
                    return false;
                }
                return true;
            });
        }

        return intersects;
    }

    // --- 块级清除格式辅助 ---
    clearBlockFormatting(state, tr, blockedNodes = new Set()) {
        if (!state || !tr || !state.selection) return;

        state.selection.ranges.forEach(range => {
            this.liftSelectionRange(range, tr, blockedNodes);
        });

        this.resetTextBlocksInSelection(state.selection, tr, state.schema, blockedNodes);
    }

    liftSelectionRange(range, tr, blockedNodes) {
        if (!range?.$from || !range.$to) return;
        const blockRange = range.$from.blockRange(range.$to);
        if (!blockRange) return;
        if (this.rangeContainsBlockedNodes(tr.doc, blockRange.start, blockRange.end, blockedNodes)) {
            return;
        }
        const target = liftTarget(blockRange);
        if (typeof target === 'number') {
            tr.lift(blockRange, target);
        }
    }

    resetTextBlocksInSelection(selection, tr, schema, blockedNodes) {
        if (!selection) return;
        const from = selection.from;
        const to = selection.to;
        tr.doc.nodesBetween(from, to, (node, pos) => {
            if (!node?.type?.isTextblock) return true;
            if (this.isBlockedNodeType(node.type, blockedNodes) || node.type.spec?.atom) {
                return false;
            }
            const safeType = this.getSafeBlockType(tr.doc.resolve(pos), node.type, schema, blockedNodes);
            if (safeType && safeType !== node.type) {
                tr.setNodeMarkup(pos, safeType, node.attrs);
            }
            return false;
        });
    }

    rangeContainsBlockedNodes(doc, from, to, blockedNodes) {
        if (!doc || !blockedNodes?.size) return false;
        let hasBlocked = false;
        doc.nodesBetween(from, to, (node) => {
            if (!node || hasBlocked) {
                return !hasBlocked;
            }
            if (this.isBlockedNodeType(node.type, blockedNodes)) {
                hasBlocked = true;
                return false;
            }
            if (node.type?.isTextblock) {
                return false;
            }
            return true;
        });
        return hasBlocked;
    }

    isBlockedNodeType(type, blockedNodes) {
        if (!type) return false;
        return Boolean(blockedNodes?.has(type.name));
    }

    getSafeBlockType($pos, currentType, schema, blockedNodes) {
        if (!$pos) return currentType;
        const parent = $pos.parent;
        const match = parent?.contentMatchAt($pos.index()) || null;
        let candidate = match?.defaultType || currentType;
        if (!candidate || this.isBlockedNodeType(candidate, blockedNodes) || candidate.spec?.atom) {
            const paragraph = schema?.nodes?.paragraph;
            candidate = (!this.isBlockedNodeType(paragraph, blockedNodes) && !paragraph?.spec?.atom)
                ? paragraph
                : currentType;
        }
        return candidate || currentType;
    }
}
