/**
 * 工具栏的 TipTap 处理器。
 * 负责识别 TipTap 编辑器、派发 TipTap 命令(bold/italic/heading/...),
 * 以及处理与 TipTap schema 相关的块级格式清除(lift + resetTextblock)。
 *
 * 通过构造函数接收 toolbar 引用,从中读取 editor 并在需要时回调 toolbar(如 emoji)。
 */
import { liftTarget } from '@tiptap/pm/transform';

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
                return this.runCommand(chain => chain.toggleBold());
            case 'italic':
                return this.runCommand(chain => chain.toggleItalic());
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
            case 'quote':
                return this.runCommand(chain => chain.toggleBlockquote(), { blockedNodes: ['mermaidBlock'] });
            case 'unorderedList':
                return this.runCommand(chain => chain.toggleBulletList(), { blockedNodes: ['mermaidBlock'] });
            case 'orderedList':
                return this.runCommand(chain => chain.toggleOrderedList(), { blockedNodes: ['mermaidBlock'] });
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
            case 'clearFormatting':
                return this.clearFormatting();
            case 'emoji':
                return this.toolbar.handleEmojiPicker();
            default:
                return false;
        }
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
        const currentHref = this.editor.getAttributes?.('link')?.href || '';
        const url = window.prompt('请输入链接地址', currentHref || 'https://');
        if (url === null) {
            return false;
        }
        const trimmed = url.trim();
        if (!trimmed) {
            this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return true;
        }
        this.editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
        return true;
    }

    handleImage() {
        if (!this.isEditor() || typeof this.editor.commands?.setImage !== 'function') {
            return false;
        }
        const src = window.prompt('请输入图片地址', 'https://');
        if (!src) {
            return false;
        }
        const alt = window.prompt('请输入图片描述', '图片描述') || '';
        this.editor.chain().focus().setImage({
            src: src.trim(),
            alt: alt.trim(),
            title: alt.trim(),
        }).run();
        return true;
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
