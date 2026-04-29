import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Link from '@tiptap/extension-link';
import { SearchExtension } from '../../extensions/SearchExtension.js';
import { HtmlSpan, HtmlDiv, HtmlInline } from '../../extensions/HtmlSupport.js';
import { CustomTaskItem } from '../../extensions/CustomTaskItem.js';
import { MarkdownImage } from '../../utils/markdownPlugins.js';
import { MermaidBlock } from '../../extensions/MermaidBlock.js';
import { CsvTableNode } from '../../extensions/CsvTableNode.js';
import { MathBlock, MathInline } from '../../extensions/MathBlock.js';
import { DisableInlineCodeShortcut } from '../../extensions/DisableInlineCodeShortcut.js';
import { SourcePos } from '../../extensions/SourcePos.js';
import { AiEditHighlight } from '../../modules/ai-assistant/tools/highlightPlugin.js';

/**
 * 返回 MarkdownEditor 所需的 TipTap 扩展列表。
 * undo/redo 由 StarterKit 内置 History 扩展处理，按 tab 维护各自历史。
 * @param {object} lowlight - createConfiguredLowlight() 实例
 */
export function createEditorExtensions(lowlight) {
    /**
     * 判断编辑器当前是否处于输入法组合输入中。
     * 组合态下应尽量让原生 IME 处理按键，避免自定义快捷键污染候选确认流程。
     * @param {import('@tiptap/core').Editor} editor - TipTap 编辑器实例
     * @returns {boolean}
     */
    function isEditorComposing(editor) {
        return Boolean(editor?.view?.composing);
    }

    return [
        StarterKit.configure({
            heading: { levels: [1, 2, 3, 4, 5, 6] },
            codeBlock: false,
            link: false,
            trailingNode: false,
            hardBreak: { keepMarks: true },
            // 字符切分（historyGroupSplitter）+ 时间切分（newGroupDelay）双重兜底，
            // 避免一长串无标点输入变成单一 group。值取默认 500ms
            history: { newGroupDelay: 500 },
        }),
        Link.configure({
            openOnClick: false,
            HTMLAttributes: { class: 'markdown-link' },
        }),
        TaskList,
        CustomTaskItem.configure({ nested: true }),
        MermaidBlock,
        CsvTableNode,
        MathBlock,
        MathInline,
        SourcePos,
        CodeBlockLowlight.configure({
            lowlight,
            HTMLAttributes: { class: 'code-block hljs' },
        }),
        DisableInlineCodeShortcut,
        Table.configure({
            resizable: false,
            renderWrapper: true,
            allowTableNodeSelection: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
        MarkdownImage,
        SearchExtension,
        HtmlSpan,
        HtmlDiv,
        HtmlInline,
        AiEditHighlight,
        // Cmd+B：选中文本加粗时自动补空格，避免中文场景粘连
        // 注意：undo/redo 快捷键统一交给全局 KeybindingManager 处理，
        // 不在此扩展注册 Mod-z/Mod-Shift-z/Mod-y，否则会与 document 层 handler 双触发
        Extension.create({
            name: 'boldAutoSpace',
            addKeyboardShortcuts() {
                return {
                    'Mod-b': () => {
                        if (isEditorComposing(this.editor)) return false;
                        const { state } = this.editor;
                        const { from, to, empty } = state.selection;
                        if (empty || this.editor.isActive('bold')) {
                            return this.editor.commands.toggleBold();
                        }
                        const doc = state.doc;
                        const $from = state.selection.$from;
                        const isAtBlockStart = $from.parentOffset === 0;
                        const charBefore = from > 0 ? doc.textBetween(from - 1, from) : '';
                        const charAfter = to < doc.content.size
                            ? doc.textBetween(to, Math.min(to + 1, doc.content.size))
                            : '';
                        const needSpaceBefore = !isAtBlockStart && charBefore !== '' && charBefore !== ' ' && charBefore !== '\n';
                        const needSpaceAfter = charAfter !== '' && charAfter !== ' ' && charAfter !== '\n';
                        if (!needSpaceBefore && !needSpaceAfter) {
                            return this.editor.commands.toggleBold();
                        }
                        const { tr } = state;
                        let offset = 0;
                        if (needSpaceAfter) tr.insertText(' ', to);
                        if (needSpaceBefore) { tr.insertText(' ', from); offset = 1; }
                        tr.setSelection(TextSelection.create(tr.doc, from + offset, to + offset));
                        this.editor.view.dispatch(tr);
                        return this.editor.commands.toggleBold();
                    },
                };
            },
        }),
        // Ctrl-a/e → code block 内行首/行尾（macOS emacs 风格）
        Extension.create({
            name: 'codeBlockLineNavigation',
            addKeyboardShortcuts() {
                return {
                    'Ctrl-a': ({ editor }) => {
                        const { state, view } = editor;
                        const { $from } = state.selection;
                        if ($from.parent.type.name !== 'codeBlock') return false;
                        const text = $from.parent.textContent;
                        const lineStart = text.lastIndexOf('\n', $from.parentOffset - 1) + 1;
                        view.dispatch(state.tr.setSelection(
                            TextSelection.create(state.doc, $from.start() + lineStart)
                        ));
                        return true;
                    },
                    'Ctrl-e': ({ editor }) => {
                        const { state, view } = editor;
                        const { $from } = state.selection;
                        if ($from.parent.type.name !== 'codeBlock') return false;
                        const text = $from.parent.textContent;
                        const next = text.indexOf('\n', $from.parentOffset);
                        const lineEnd = next === -1 ? text.length : next;
                        view.dispatch(state.tr.setSelection(
                            TextSelection.create(state.doc, $from.start() + lineEnd)
                        ));
                        return true;
                    },
                };
            },
        }),
        // Shift+Enter → 段落内硬换行；Enter 走 TipTap 默认（分段 / 列表项拆分）
        Extension.create({
            name: 'customEnterBehavior',
            addKeyboardShortcuts() {
                return {
                    'Shift-Enter': () => {
                        if (isEditorComposing(this.editor)) return false;
                        const { $from } = this.editor.state.selection;
                        if ($from.parent.type.name !== 'paragraph') return false;
                        for (let d = $from.depth; d > 0; d--) {
                            const node = $from.node(d);
                            if (node.type.name === 'listItem' || node.type.name === 'taskItem') return false;
                        }
                        return this.editor.commands.setHardBreak();
                    },
                };
            },
        }),
        // Sublime 风格 undo 切分：插入了换行/空格/标点的 transaction 之后关闭当前 history group。
        // 注意：prosemirror-history 会忽略带 appendedTransaction meta 的 tr（plugin appendTransaction 返回的 tr 自带此 meta），
        // 所以 closeHistory 必须从 view 层手动 dispatch（不走 appendTransaction 钩子）。
        Extension.create({
            name: 'historyGroupSplitter',
            addProseMirrorPlugins() {
                const SPLIT_CHAR = /[\s\p{P}]/u;
                const splitterKey = new PluginKey('historyGroupSplitter');
                return [
                    new Plugin({
                        key: splitterKey,
                        state: {
                            init: () => ({ pendingClose: false }),
                            apply(tr, value) {
                                // 我们手动 dispatch 的 close tr 上携带这个 meta，借此重置 pendingClose
                                const reset = tr.getMeta(splitterKey);
                                if (reset) return reset;
                                if (!tr.docChanged) return value;
                                if (tr.getMeta('addToHistory') === false) return value;
                                for (const step of tr.steps) {
                                    const slice = step.slice;
                                    if (!slice || slice.size === 0) continue;
                                    const text = slice.content.textBetween(0, slice.content.size, '\n', '');
                                    if (text && SPLIT_CHAR.test(text)) return { pendingClose: true };
                                    if (slice.openStart > 0 || slice.openEnd > 0) return { pendingClose: true };
                                }
                                return value;
                            },
                        },
                        view(editorView) {
                            let imeGuardUntil = 0;
                            const onCompEnd = () => { imeGuardUntil = Date.now() + 50; };
                            editorView.dom.addEventListener('compositionend', onCompEnd);
                            return {
                                update(view) {
                                    const { pendingClose } = splitterKey.getState(view.state);
                                    if (!pendingClose) return;
                                    if (view.composing || Date.now() < imeGuardUntil) return;
                                    queueMicrotask(() => {
                                        if (view.isDestroyed) return;
                                        const cur = splitterKey.getState(view.state);
                                        if (!cur.pendingClose) return;
                                        const tr = closeHistory(view.state.tr).setMeta(splitterKey, { pendingClose: false });
                                        view.dispatch(tr);
                                    });
                                },
                                destroy() {
                                    editorView.dom.removeEventListener('compositionend', onCompEnd);
                                },
                            };
                        },
                    }),
                ];
            },
        }),
        // 空 code block 的 IME 拼音双插 bug 修复
        // 用 appendTransaction 拦截每个事务：一旦 selection 落在空 codeBlock（含 input rule 刚创建的那一瞬），
        // 立即追加一个 \u200B 占位，让 ProseMirror 在 composition 开始前就有文本节点可替换。
        // \u200B 在序列化时由 MarkdownPreprocessor.serializeMarkdown 统一清除，不会写入 .md。
        // 只处理 codeBlock：paragraph/heading 会破坏 markdown input rules。
        Extension.create({
            name: 'imeEmptyCodeBlockFix',
            addProseMirrorPlugins() {
                return [
                    new Plugin({
                        appendTransaction(transactions, oldState, newState) {
                            const docChanged = transactions.some(tr => tr.docChanged);
                            const selChanged = !oldState.selection.eq(newState.selection);
                            if (!docChanged && !selChanged) return null;
                            const { $from, empty } = newState.selection;
                            if (!empty) return null;
                            if ($from.parent.type.name !== 'codeBlock') return null;
                            if ($from.parent.content.size !== 0) return null;
                            return newState.tr
                                .insert($from.pos, newState.schema.text('\u200B'))
                                .setMeta('addToHistory', false);
                        },
                    }),
                ];
            },
        }),
        // Tab → 缩进列表项，或插入 4 个空格
        Extension.create({
            name: 'tabIndent',
            addKeyboardShortcuts() {
                return {
                    Tab: () => {
                        if (isEditorComposing(this.editor)) return false;
                        if (this.editor.commands.sinkListItem('listItem')) return true;
                        if (this.editor.commands.sinkListItem('taskItem')) return true;
                        return this.editor.commands.insertContent('    ');
                    },
                };
            },
        }),
    ];
}
